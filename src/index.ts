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
import { startDataCollector, collectPostsForUser, fetchCommentsForUser } from './services/dataCollector';

import { authenticate } from './middleware/auth';
import { errorHandler } from './utils/appError';
import { AnalyticsService } from './services/analytics.service';

const analyticsService = new AnalyticsService();

// ── 启动时清理临时文件（防 OOM 残留） ──
const TEMP_DIR = path.join(__dirname, '../temp');
if (fs.existsSync(TEMP_DIR)) {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEMP_DIR, { recursive: true });

const app = express();

// 通过 verify 回调保存原始请求体（微信支付回调验签需要原始 body 字符串）
app.use(express.json({
  verify: (req, _res, buf) => {
    (req as any).rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));

// 微信支付回调注册在 express.urlencoded 之后，
// 因为 verify 回调已在 express.json() 中捕获了 rawBody

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
      createBullBoard({ queues: [new BullMQAdapter(q as any) as any], serverAdapter });
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
      where: { platform_openid: { platform: adapter.platform, openid: result.openid } },
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

// ── 平台 Cookie 管理 ──
app.post('/api/platform/cookie', authenticate, async (req, res) => {
  const { platform, cookie } = req.body;
  if (!platform || !cookie) return res.status(400).json({ error: '缺少 platform 或 cookie' });
  if (!['RED', 'WECHAT'].includes(platform)) return res.status(400).json({ error: `不支持的平台: ${platform}` });
  try {
    const { encrypt } = await import('./utils/crypto');
    const { prisma } = await import('./utils/prismaClient');

    const encrypted = encrypt(cookie);
    await prisma.platformCookie.upsert({
      where: { userId_platform: { userId: (req as any).userId, platform } },
      update: { encryptedCookie: encrypted, lastError: null },
      create: { userId: (req as any).userId, platform, encryptedCookie: encrypted },
    });

    res.json({ success: true, message: 'Cookie 已保存' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '保存失败' });
  }
});

app.get('/api/platform/cookie/:platform', authenticate, async (req, res) => {
  try {
    const { prisma } = await import('./utils/prismaClient');
    const record = await prisma.platformCookie.findUnique({
      where: { userId_platform: { userId: (req as any).userId, platform: req.params.platform } },
      select: { lastTestedAt: true, lastError: true, createdAt: true, updatedAt: true },
    });
    res.json(record || { exists: false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/platform/cookie/:platform', authenticate, async (req, res) => {
  try {
    const { prisma } = await import('./utils/prismaClient');
    await prisma.platformCookie.delete({
      where: { userId_platform: { userId: (req as any).userId, platform: req.params.platform } },
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: '删除失败' });
  }
});

app.post('/api/platform/cookie/test', authenticate, async (req, res) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: '缺少 platform' });
  try {
    const { decrypt } = await import('./utils/crypto');
    const { prisma } = await import('./utils/prismaClient');

    const record = await prisma.platformCookie.findUnique({
      where: { userId_platform: { userId: (req as any).userId, platform } },
    });
    if (!record) return res.status(400).json({ error: 'Cookie 未配置' });

    const cookie = decrypt(record.encryptedCookie);
    const axios = (await import('axios')).default;

    // 用 Cookie 请求小红书创作者中心，验证有效性
    const resp = await axios.get('https://creator.xiaohongshu.com/api/author/data/overview', {
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://creator.xiaohongshu.com/',
      },
      timeout: 10000,
      validateStatus: () => true,
    });

    const valid = resp.status === 200 && resp.data?.code === 0;
    await prisma.platformCookie.update({
      where: { userId_platform: { userId: (req as any).userId, platform } },
      data: { lastTestedAt: new Date(), lastError: valid ? null : (resp.data?.msg || `HTTP ${resp.status}`) },
    });

    res.json({ success: valid, message: valid ? 'Cookie 有效' : 'Cookie 已过期或无效' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '测试失败' });
  }
});

// ── 小红书登录管理 ──
app.get('/api/platform/red/status', authenticate, async (_req, res) => {
  try {
    const { checkRedLoginStatus } = await import('./services/browserManager');
    const status = await checkRedLoginStatus();
    res.json({ platform: 'RED', loginStatus: status });
  } catch (err: any) {
    res.json({ platform: 'RED', loginStatus: 'unknown' });
  }
});

// 小红书登录：打开常驻浏览器等待用户登录
app.post('/api/platform/red/login', authenticate, async (_req, res) => {
  try {
    const { waitForRedLogin } = await import('./services/browserManager');
    // 异步等待登录，不阻塞响应
    waitForRedLogin().then(() => console.log('[RED] 登录成功')).catch(() => {});
    res.json({ success: true, message: '浏览器已打开，请在窗口中登录创作者中心' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '登录启动失败' });
  }
});

// ── 微信视频号登录管理 ──
app.get('/api/platform/wechat/status', authenticate, async (_req, res) => {
  try {
    const { checkWeChatLoginStatus } = await import('./services/browserManager');
    const status = await checkWeChatLoginStatus();
    res.json({ platform: 'WECHAT', loginStatus: status });
  } catch (err: any) {
    res.json({ platform: 'WECHAT', loginStatus: 'unknown' });
  }
});

app.post('/api/platform/wechat/login', authenticate, async (_req, res) => {
  try {
    const { waitForWeChatLogin } = await import('./services/browserManager');
    waitForWeChatLogin().then(() => console.log('[WECHAT] 登录成功')).catch(() => {});
    res.json({ success: true, message: '浏览器已打开，请在窗口中扫码登录视频号助手' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '登录启动失败' });
  }
});

/** 绑定微信视频号（读取已登录的浏览器页面，自动创建 Account 记录） */
app.post('/api/platform/wechat/bind', authenticate, async (req, res) => {
  try {
    const { getWeChatPage, extractWeChatAccountInfo } = await import('./services/browserManager');
    const { prisma } = await import('./utils/prismaClient');

    const page = await getWeChatPage();
    await page.goto('https://channels.weixin.qq.com/platform', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    const accountInfo = await extractWeChatAccountInfo(page);

    if (!accountInfo.nickname) throw new Error('无法读取视频号昵称，请确认已登录');
    const openid = accountInfo.wxId || `wechat_${Date.now()}`;

    await prisma.account.upsert({
      where: { platform_openid: { platform: 'WECHAT', openid } },
      update: { nickname: accountInfo.nickname, userId: (req as any).userId },
      create: {
        userId: (req as any).userId, platform: 'WECHAT',
        openid, nickname: accountInfo.nickname, avatar: '',
        encryptedAccess: '', encryptedRefresh: '',
        expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
      },
    });

    res.json({ success: true, nickname: accountInfo.nickname });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '绑定失败' });
  }
});

// ── 数据看板 ──
app.get('/api/analytics/trend', authenticate, async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const data = await analyticsService.getTrend((req as any).userId, days);
    const grouped: Record<string, any[]> = {};
    for (const d of data) {
      if (!grouped[d.platform]) grouped[d.platform] = [];
      grouped[d.platform].push(d);
    }
    res.json(grouped);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 全平台内容数据 ──

/** 获取已入库的笔记/视频列表 */
app.get('/api/collect/:platform/posts', authenticate, async (req, res) => {
  try {
    const { platform } = req.params;
    const posts = await analyticsService.getContentItems((req as any).userId, platform.toUpperCase());
    res.json(posts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 触发刷新 — 从平台拉取最新内容列表并入库 */
app.post('/api/collect/:platform/posts/refresh', authenticate, async (req, res) => {
  try {
    const { platform } = req.params;
    await collectPostsForUser((req as any).userId, platform.toUpperCase());
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** 实时拉取评论列表（不存库，直接返回） */
app.get('/api/collect/:platform/comments', authenticate, async (req, res) => {
  try {
    const { platform } = req.params;
    const comments = await Promise.race([
      fetchCommentsForUser((req as any).userId, platform.toUpperCase()),
      new Promise<any[]>((_, reject) => setTimeout(() => reject(new Error('评论抓取超时')), 20000)),
    ]);
    res.json(comments);
  } catch (err: any) {
    res.json([]);
  }
});

// ── 启动 Token 自动续期 ──
startTokenRefresher();

// ── 启动数据采集 ──
startDataCollector();

// ── 启动 Worker ──
startWorker().catch(err => console.error('[Worker] 启动失败:', err.message));

// ── 全局错误处理 ──
app.use(errorHandler);

// ── 启动服务 ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Matrix-Share] 服务运行在端口 ${PORT}`);
});
