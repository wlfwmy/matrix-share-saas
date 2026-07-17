import express from 'express';
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import OSS from 'ali-oss';

import { getQueue } from './queues/publish.queue';
import { startWorker } from './queues/publish.worker';
import { getAuthUrl, handleCallback } from './controllers/oauth.router.controller';
import { handleWxEvents } from './controllers/wx.oauth.controller';
import { createPayment, handleAlipayNotify, queryOrderStatus } from './controllers/payment.controller';
import { createWxPayment, handleWxPayNotify } from './controllers/wx.payment.controller';
import { startTokenRefresher } from './services/tokenRefresher';

import { authenticate } from './middleware/auth';
import { errorHandler } from './utils/appError';

// ── 启动时清理临时文件（防 OOM 残留） ──
const TEMP_DIR = path.join(__dirname, '../temp');
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEMP_DIR, { recursive: true });

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Bull Board 队列可视化（仅生产环境需要 Redis） ──
if (process.env.NODE_ENV === 'production') {
  (async () => {
    try {
      const { createBullBoard } = await import('@bull-board/api');
      const { BullMQAdapter } = await import('@bull-board/api/bullMQAdapter');
      const { ExpressAdapter } = await import('@bull-board/express');
      const serverAdapter = new ExpressAdapter();
      serverAdapter.setBasePath('/admin/queues');
      const q = await getQueue();
      createBullBoard({ queues: [new BullMQAdapter(q as any)], serverAdapter });
      app.use('/admin/queues', serverAdapter.getRouter());
      console.log('[Bull Board] 已挂载 /admin/queues');
    } catch (e) {
      console.log('[Bull Board] 跳过 (开发模式)');
    }
  })();
} else {
  console.log('[Bull Board] 跳过 (开发模式, 需要 Redis + BullMQ)');
}

// ── OSS 客户端 ──
const store = new OSS({
  region: process.env.ALI_OSS_REGION,
  accessKeyId: process.env.ALI_ACCESS_KEY_ID!,
  accessKeySecret: process.env.ALI_ACCESS_KEY_SECRET!,
  bucket: process.env.ALI_OSS_BUCKET,
});

// ── 微信第三方平台事件（ticket 推送） ──
app.post('/v1/weixin/open/event/authorize', express.text({ type: '*/xml' }), handleWxEvents);

// ── 统一 OAuth 路由（需登录） ──
app.get('/api/oauth/:platform/auth-url', authenticate, getAuthUrl);
app.get('/api/oauth/:platform/callback', handleCallback);

// ── OAuth 回调中转（前端传 code → 后端完成激活） ──
app.post('/api/oauth/finalize', async (req, res) => {
  const { code, platform } = req.body;
  if (!code || !platform) return res.status(400).json({ error: '缺少 code 或 platform' });
  try {
    const { getAdapter } = await import('./controllers/oauth.router.controller');
    const { encrypt } = await import('./utils/crypto');
    const { prisma } = await import('./utils/prismaClient');

    const adapter = getAdapter(platform.toUpperCase());
    if (!adapter) return res.status(400).json({ error: `不支持的平台: ${platform}` });

    const result = await adapter.handleCallback({ code, state: req.body.state || '' });

    const encryptedAccess = encrypt(result.accessToken);
    const encryptedRefresh = encrypt(result.refreshToken);
    const expiresAt = new Date(Date.now() + result.expiresIn * 1000);

    await prisma.account.upsert({
      where: { openid: result.openid },
      update: { encryptedAccess, encryptedRefresh, expiresAt, nickname: result.nickname, avatar: result.avatar },
      create: {
        userId: result.userId || 'dev_user', platform: adapter.platform,
        openid: result.openid, nickname: result.nickname, avatar: result.avatar,
        encryptedAccess, encryptedRefresh, expiresAt,
      },
    });

    res.json({ success: true, nickname: result.nickname });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '授权激活失败' });
  }
});

// ── 支付路由 ──
app.post('/api/v1/payment/create', createPayment);
app.post('/v1/payment/alipay/notify', handleAlipayNotify);
app.post('/api/v1/payment/wechat/create', createWxPayment);
app.post('/v1/payment/wechat/notify', handleWxPayNotify);
app.get('/api/v1/payment/status', queryOrderStatus);

// ── OSS 签名直传 ──
app.get('/api/oss/upload-url', async (req, res) => {
  const { fileName, fileType } = req.query as { fileName: string; fileType: string };
  const uniqueName = `videos/${Date.now()}_${fileName}`;
  try {
    const uploadUrl = store.signatureUrl(uniqueName, {
      method: 'PUT', 'Content-Type': fileType, expires: 1800,
    });
    const filePublicUrl = `https://${process.env.ALI_OSS_BUCKET}.${process.env.ALI_OSS_REGION}.aliyuncs.com/${uniqueName}`;
    res.json({ uploadUrl, filePublicUrl });
  } catch (err) {
    res.status(500).json({ error: '直传通道申请失败' });
  }
});

// ── 矩阵分发任务提交 ──
app.post('/api/publish/matrix', async (req, res) => {
  const { title, description, videoUrl, accounts } = req.body;
  try {
    const queue = await getQueue();
    for (const acc of accounts) {
      const taskId = `task_${Math.random().toString(36).substring(2, 8)}`;
      await queue.add(`job_${taskId}`, {
        taskId,
        userId: (req as any).userId || 'dev_user',
        accountId: acc.id,
        platform: acc.platform,
        title,
        description,
        videoUrl,
        watermarkText: acc.watermarkText || `@${acc.nickname || ''}`,
      });
    }
    res.json({ success: true, message: '分发任务已进入队列' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 账号列表 & 解绑 ──
app.get('/api/accounts', authenticate, async (_req, res) => {
  try {
    const { prisma } = await import('./utils/prismaClient');
    const accounts = await prisma.account.findMany({
      select: { id: true, platform: true, nickname: true, avatar: true, expiresAt: true },
    });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: '查询失败' });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const { prisma } = await import('./utils/prismaClient');
    await prisma.account.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '解绑失败' });
  }
});

// ── 启动 Token 自动续期 ──
startTokenRefresher();

// ── 启动 Worker ──
startWorker().catch(err => console.error('[Worker] 启动失败:', err.message));

// ── 全局错误处理 ──
app.use(errorHandler);

// ── 启动服务 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Matrix-Share] 服务运行在端口 ${PORT}`);
});
