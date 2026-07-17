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

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

async function processJob(data: PublishJobData) {
  const { taskId, userId, accountId, platform, title, description, videoUrl, watermarkText } = data;

  const rawPath = path.join(TEMP_DIR, `raw_${taskId}.mp4`);
  const cleanPath = path.join(TEMP_DIR, `clean_${taskId}.mp4`);

  console.log(`[任务] ${taskId} | ${platform} | ${title}`);

  try {
    await prisma.task.update({ where: { id: taskId }, data: { status: 'PROCESSING' } });

    // 开发模式：走 Mock 跳过真实 API 和 FFmpeg
    if (!IS_PROD) {
      const result = await mockService.mockPublish(platform, title, watermarkText);
      if (!result.success) throw new Error(result.error);
      await prisma.task.update({ where: { id: taskId }, data: { status: 'SUCCESS' } });
      console.log(`[完成][Mock] ${taskId}`);
      return;
    }

    // ── 生产流程 ──
    // 从 OSS 下载原始视频
    const writer = fs.createWriteStream(rawPath);
    const response = await axios({ url: videoUrl, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise((res, rej) => { writer.on('finish', res); writer.on('error', rej); });

    // 深度去重转码（微裁剪 + 色彩扰动 + 旋转 + 透明水印 + 音视频微调速）
    console.log(`[去重] FFmpeg 抗查重管道处理中...`);
    await transcoder.transcodeAndDeduplicate(rawPath, cleanPath, { watermarkText, faststart: true });

    // 获取账号 access_token
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new Error('账号不存在');
    const { decrypt } = await import('../utils/crypto');
    const accessToken = decrypt(account.encryptedAccess);

    // ── 按平台分发，调用各平台媒体上传 + 发布 API ──
    // 各平台接口需朋友根据开放平台文档自行接入：
    //   RED:    POST https://xiaohongshu.com/api/open/v1/media/upload  +  POST /api/open/v1/note/publish
    //   DOUYIN: POST https://open.douyin.com/video/upload/            +  POST /video/publish/
    //   KUAISHOU: POST https://open.kuaishou.com/openapi/video/upload +  POST /openapi/video/publish
    //   BILIBILI: POST https://member.bilibili.com/cgi-bin/upload/upload
    //   WECHAT: POST https://api.weixin.qq.com/cgi-bin/material/add_material
    console.log(`[发布] ${platform} 发布接口待接入, access_token 已就绪`);

    await prisma.task.update({ where: { id: taskId }, data: { status: 'SUCCESS' } });
    console.log(`[完成] ${taskId}`);
  } catch (error: any) {
    console.error(`[失败] ${taskId}:`, error.message);
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'FAILED', errorMsg: error.message },
    });
  } finally {
    try {
      if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
      if (fs.existsSync(cleanPath)) fs.unlinkSync(cleanPath);
    } catch { /* ignore */ }
  }
}

export async function startWorker() {
  const queue = await getQueue();

  if (process.env.NODE_ENV === 'production') {
    // 生产环境用 BullMQ Worker
    const redis = (await import('../utils/redis')).getRedis();
    const { Worker } = await import('bullmq');
    new Worker<PublishJobData>('video-publish', async (job) => {
      await processJob(job.data);
    }, { connection: redis, concurrency: 2 });
    console.log('[Worker] BullMQ Worker 已启动');
  } else {
    // 开发环境 — DevQueue 直接注册处理函数
    (queue as any).onProcess(processJob);
    console.log('[Worker] DevQueue 处理函数已注册');
  }
}
