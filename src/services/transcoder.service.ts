import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface TranscodeOptions {
  maxWidth?: number;
  crf?: number;
  watermarkText?: string;
  watermarkPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  faststart?: boolean;
}

export interface DeduplicateOptions {
  watermarkText?: string;
  faststart?: boolean;
}

const POSITION_MAP: Record<string, string> = {
  'top-left': 'x=24:y=24',
  'top-right': 'x=w-tw-24:y=24',
  'bottom-left': 'x=24:y=h-th-24',
  'bottom-right': 'x=w-tw-24:y=h-th-24',
};

const MAX_WATERMARK_LENGTH = 60; // 防止超长文字破坏排版/拖慢渲染
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟，超时强制终止，避免 worker 被卡死

// 把水印文字写入服务器自己生成的临时文件，用 textfile 引用而不是内联拼接，
// 从根本上避免用户输入被当作 filter 语法解析，杜绝转义漏洞
function writeWatermarkTempFile(text: string): string {
  const safe = text.slice(0, MAX_WATERMARK_LENGTH);
  const tmpPath = path.join(os.tmpdir(), `wm_${crypto.randomBytes(8).toString('hex')}.txt`);
  fs.writeFileSync(tmpPath, safe, 'utf8');
  return tmpPath;
}

// 服务器自己生成的路径也做基础转义（防御性）
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function cleanupTempFile(p: string) {
  fs.unlink(p, () => {}); // 忽略清理失败，不影响主流程
}

export class VideoTranscoderService {
  /**
   * 基础转码（标准化 H.264 + 缩放 + 水印）
   */
  async transcode(
    inputPath: string,
    outputPath: string,
    options: TranscodeOptions = {},
  ): Promise<string> {
    const {
      maxWidth = 1080,
      crf = 23,
      watermarkText,
      watermarkPosition = 'bottom-right',
      faststart = true,
    } = options;

    let watermarkFile: string | null = null;

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([`-crf ${crf}`, '-preset veryfast', '-pix_fmt yuv420p']);

      if (faststart) {
        command.outputOptions('-movflags +faststart');
      }

      const filters: string[] = [];
      filters.push(`scale='min(${maxWidth},iw)':-2`);

      if (watermarkText) {
        watermarkFile = writeWatermarkTempFile(watermarkText);
        const pos = POSITION_MAP[watermarkPosition] || POSITION_MAP['bottom-right'];
        filters.push(
          `drawtext=textfile='${escapeFilterPath(watermarkFile)}':${pos}:fontsize=28:fontcolor=white@0.8:box=1:boxcolor=black@0.3:boxborderw=8`,
        );
      }

      command.videoFilters(filters);

      const timer = setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('转码超时，已强制终止'));
      }, FFMPEG_TIMEOUT_MS);

      command
        .on('start', (cmd) => console.log('[Transcoder] FFmpeg:', cmd))
        .on('progress', (p) => {
          if (p.percent) console.log(`[Transcoder] ${p.percent.toFixed(1)}%`);
        })
        .on('end', () => {
          clearTimeout(timer);
          if (watermarkFile) cleanupTempFile(watermarkFile);
          resolve(outputPath);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          if (watermarkFile) cleanupTempFile(watermarkFile);
          reject(err);
        })
        .save(outputPath);
    });
  }

  /**
   * 深度转码去重管道 — 抗平台查重算法
   * 微裁剪 + 色彩扰动 + 极微旋转 + 透明水印 + 音视频微调速
   * 全部滤镜统一走一条 filter_complex 链路，避免与简单滤镜（-vf）冲突
   */
  async transcodeAndDeduplicate(
    inputPath: string,
    outputPath: string,
    options: DeduplicateOptions = {},
  ): Promise<string> {
    const { watermarkText, faststart = true } = options;

    let watermarkFile: string | null = null;

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions(['-crf 23', '-preset veryfast', '-pix_fmt yuv420p']);

      if (faststart) {
        command.outputOptions('-movflags +faststart');
      }

      const videoChain: string[] = [
        'crop=in_w*0.99:in_h*0.99:in_w*0.005:in_h*0.005',
        'eq=contrast=1.01:brightness=0.005:saturation=1.01',
        'rotate=0.005:ow=rotw(0.005):oh=roth(0.005)',
        "scale='1080:-2'",
      ];

      if (watermarkText) {
        watermarkFile = writeWatermarkTempFile(watermarkText);
        videoChain.push(
          `drawtext=textfile='${escapeFilterPath(watermarkFile)}':x=30:y=30:fontsize=24:fontcolor=white@0.35`,
        );
      }

      videoChain.push('setpts=0.99*PTS');

      const filterComplex = [`[0:v]${videoChain.join(',')}[v]`, '[0:a]atempo=1.01[a]'].join(';');

      command
        .outputOptions('-filter_complex', filterComplex)
        .outputOptions('-map', '[v]')
        .outputOptions('-map', '[a]');

      const timer = setTimeout(() => {
        command.kill('SIGKILL');
        reject(new Error('转码超时，已强制终止'));
      }, FFMPEG_TIMEOUT_MS);

      command
        .on('start', (cmd) => console.log('[Deduplicator] FFmpeg:', cmd))
        .on('end', () => {
          clearTimeout(timer);
          if (watermarkFile) cleanupTempFile(watermarkFile);
          resolve(outputPath);
        })
        .on('error', (err) => {
          clearTimeout(timer);
          if (watermarkFile) cleanupTempFile(watermarkFile);
          reject(err);
        })
        .save(outputPath);
    });
  }

  async probe(inputPath: string): Promise<{
    durationSec: number;
    width: number;
    height: number;
    bitrateKbps: number;
  }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, data) => {
        if (err) return reject(err);
        const videoStream = data.streams.find((s) => s.codec_type === 'video');
        resolve({
          durationSec: Math.round(data.format.duration || 0),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          bitrateKbps: Math.round(Number(data.format.bit_rate || 0) / 1000),
        });
      });
    });
  }
}
