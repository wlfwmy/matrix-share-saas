import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getQueue, PublishJobData } from './publish.queue';
import { VideoTranscoderService } from '../services/transcoder.service';
import { MockSocialMediaService } from '../services/mock.service';
import { prisma } from '../utils/prismaClient';

const transcoder = new VideoTranscoderService();
const mockService = new MockSocialMediaService();
const IS_PROD = process.env.NODE_ENV === 'production';
const TEMP_DIR = path.join(__dirname, '../../temp');

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
const MAX_DOWNLOAD_BYTES = 500 * 1024 * 1024; // 500MB 上限，按业务需要调整

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 只允许下载配置好的 OSS bucket 域名下的资源，防止 SSRF：
// 攻击者传入 videoUrl 指向内网/云元数据接口时会在这里被拒绝。
// 建议在 /api/publish/matrix 路由层也做同样校验，双重防御。
function assertTrustedVideoUrl(videoUrl: string) {
  const allowedHost = `${process.env.ALI_OSS_BUCKET}.${process.env.ALI_OSS_REGION}.aliyuncs.com`;
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    throw new Error('videoUrl 格式非法');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== allowedHost) {
    throw new Error(`videoUrl 域名不受信任: ${parsed.hostname}`);
  }
}

async function downloadWithLimit(videoUrl: string, destPath: string) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({
    url: videoUrl,
    method: 'GET',
    responseType: 'stream',
    timeout: DOWNLOAD_TIMEOUT_MS,
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
  });

  let downloaded = 0;
  response.data.on('data', (chunk: Buffer) => {
    downloaded += chunk.length;
    if (downloaded > MAX_DOWNLOAD_BYTES) {
      response.data.destroy();
      writer.destroy();
      throw new Error('视频文件超出下载大小限制');
    }
  });

  response.data.pipe(writer);
  await new Promise<void>((res, rej) => {
    writer.on('finish', res);
    writer.on('error', rej);
    response.data.on('error', rej);
  });
}

async function processJob(data: PublishJobData) {
  const { taskId, userId, accountId, platform, title, description, videoUrl, watermarkText } = data;

  const rawPath = path.join(TEMP_DIR, `raw_${taskId}.mp4`);
  const cleanPath = path.join(TEMP_DIR, `clean_${taskId}.mp4`);

  console.log(`[任务] ${taskId} | ${platform} | ${title}`);

  try {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'PROCESSING' } });

    if (!IS_PROD) {
      const result = await mockService.mockPublish(platform, title, watermarkText);
      if (!result.success) throw new Error(result.error);
      await prisma.task.update({ where: { id: taskId }, data: { status: 'SUCCESS' } });
      console.log(`[完成][Mock] ${taskId}`);
      return;
    }

    // ── 生产流程 ──
    assertTrustedVideoUrl(videoUrl); // SSRF 防护：只允许下载自己 OSS bucket 的资源

    await downloadWithLimit(videoUrl, rawPath);

    console.log(`[去重] FFmpeg 抗查重管道处理中...`);
    await transcoder.transcodeAndDeduplicate(rawPath, cleanPath, { watermarkText, faststart: true });

    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('账号不存在');
    const { decrypt } = await import('../utils/crypto');
    const accessToken = decrypt(account.encryptedAccess);

    // ── TODO: 按平台分发，调用各平台媒体上传 + 发布 API ──
    // 尚未实现真实发布逻辑，上线前必须补全，否则用户会看到"发布成功"
    // 但内容实际并未出现在对应平台上。
    //   RED:      POST https://xiaohongshu.com/api/open/v1/media/upload + /note/publish
    //   DOUYIN:   POST https://open.douyin.com/video/upload/ + /video/publish/
    //   KUAISHOU: POST https://open.kuaishou.com/openapi/video/upload + /openapi/video/publish
    //   BILIBILI: POST https://member.bilibili.com/cgi-bin/upload/upload
    //   WECHAT:   POST https://api.weixin.qq.com/cgi-bin/material/add_material
    throw new Error(`${platform} 发布接口尚未接入，任务无法标记为成功`);

    // 接入完成后删掉上面这行 throw，恢复：
    // await prisma.task.update({ where: { id: taskId }, data: { status: 'SUCCESS' } });
    // console.log(`[完成] ${taskId}`);
  } catch (error: any) {
    console.error(`[失败] ${taskId}:`, error.message);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'FAILED', errorMsg: error.message },
    });
    // 重新抛出，让 BullMQ 感知失败，触发重试机制和 Bull Board 监控
    throw error;
  } finally {
    try {
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      if (fs.existsSync(cleanPath)) fs.unlinkSync(cleanPath);
    } catch {
      /* ignore */
    }
  }
}

export async function startWorker() {
  const queue = await getQueue();

  if (process.env.NODE_ENV === 'production') {
    const redis = (await import('../utils/redis')).getRedis();
    const { Worker } = await import('bullmq');
    const worker = new Worker<PublishJobData>(
      'video-publish',
      async (job) => {
        await processJob(job.data);
      },
      { connection: redis, concurrency: 2 },
    );

    worker.on('failed', (job, err) => {
      console.error(`[Worker] 任务失败 ${job?.id}:`, err.message);
    });

    console.log('[Worker] BullMQ Worker 已启动');
  } else {
    (queue as any).onProcess(processJob);
    console.log('[Worker] DevQueue 处理函数已注册');
  }
}
