import ffmpeg from 'fluent-ffmpeg';

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

export class VideoTranscoderService {
  /**
   * 基础转码（标准化 H.264 + 缩放 + 水印）
   */
  async transcode(
    inputPath: string,
    outputPath: string,
    options: TranscodeOptions = {}
  ): Promise<string> {
    const {
      maxWidth = 1080,
      crf = 23,
      watermarkText,
      watermarkPosition = 'bottom-right',
      faststart = true,
    } = options;

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
        const pos = POSITION_MAP[watermarkPosition] || POSITION_MAP['bottom-right'];
        const escaped = watermarkText.replace(/'/g, "\\'").replace(/:/g, '\\:');
        filters.push(
          `drawtext=text='${escaped}':${pos}:fontsize=28:fontcolor=white@0.8:box=1:boxcolor=black@0.3:boxborderw=8`
        );
      }

      command.videoFilters(filters);

      command
        .on('start', (cmd) => console.log('[Transcoder] FFmpeg:', cmd))
        .on('progress', (p) => {
          if (p.percent) console.log(`[Transcoder] ${p.percent.toFixed(1)}%`);
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err))
        .save(outputPath);
    });
  }

  /**
   * 深度转码去重管道 — 抗平台查重算法
   * 微裁剪 + 色彩扰动 + 极微旋转 + 透明水印 + 音视频微调速
   */
  async transcodeAndDeduplicate(
    inputPath: string,
    outputPath: string,
    options: DeduplicateOptions = {}
  ): Promise<string> {
    const { watermarkText, faststart = true } = options;

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .size('1080x?')
        .outputOptions(['-crf 23', '-preset veryfast', '-pix_fmt yuv420p']);

      if (faststart) {
        command.outputOptions('-movflags +faststart');
      }

      const filters: string[] = [];

      // 1. 微裁剪 1% — 消除边缘指纹
      filters.push('crop=in_w*0.99:in_h*0.99:in_w*0.005:in_h*0.005');

      // 2. 微调色彩 — 规避色彩直方图查重
      filters.push('eq=contrast=1.01:brightness=0.005:saturation=1.01');

      // 3. 极微旋转 0.28度 + 防黑边
      filters.push('rotate=0.005:ow=rotw(0.005):oh=roth(0.005)');

      // 4. 专属半透明水印
      if (watermarkText) {
        const escaped = watermarkText.replace(/'/g, "\\'").replace(/:/g, '\\:');
        filters.push(`drawtext=text='${escaped}':x=30:y=30:fontsize=24:fontcolor=white@0.35`);
      }

      command.videoFilters(filters);

      // 5. 音视频整体微调至 1.01 倍速 — 修改时间戳指纹
      command
        .outputOptions('-filter_complex', '[0:v]setpts=0.99*PTS[v];[0:a]atempo=1.01[a]')
        .outputOptions('-map [v]')
        .outputOptions('-map [a]');

      command
        .on('start', (cmd) => console.log('[Deduplicator] FFmpeg:', cmd))
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err))
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
