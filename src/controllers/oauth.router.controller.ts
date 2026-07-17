import { Request, Response } from 'express';
import { PlatformOAuthAdapter } from '../adapters/platformAdapter.interface';
import { RedOAuthAdapter } from '../adapters/red.adapter';
import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';
import { WeChatOAuthAdapter } from '../adapters/wechat.adapter';
import { encrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';

const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:5173';
const APP_PROTOCOL = process.env.NODE_ENV === 'production' ? 'https' : 'http';
const redirect = (path: string) => `${APP_PROTOCOL}://${APP_DOMAIN}${path}`;

const adapters: Record<string, PlatformOAuthAdapter> = {
  RED: new RedOAuthAdapter(),
  DOUYIN: new DouyinOAuthAdapter(),
  KUAISHOU: new KuaishouOAuthAdapter(),
  BILIBILI: new BilibiliOAuthAdapter(),
  WECHAT: new WeChatOAuthAdapter(),
};

export function getAdapter(platform: string): PlatformOAuthAdapter | undefined {
  return adapters[platform];
}

export const getAuthUrl = async (req: Request, res: Response) => {
  const { platform } = req.params;
  const userId = (req as any).userId;
  if (!userId) return res.status(401).json({ error: '未登录' });

  const adapter = adapters[platform.toUpperCase()];
  if (!adapter) return res.status(400).json({ error: `不支持的平台: ${platform}` });

  try {
    const authUrl = await adapter.getAuthUrl(userId);
    return res.json({ authUrl });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};

export const handleCallback = async (req: Request, res: Response) => {
  const { platform } = req.params;
  const adapter = adapters[platform.toUpperCase()];
  if (!adapter) {
    return res.redirect(redirect(`/dashboard/channels?bind=error&msg=UnsupportedPlatform`));
  }

  try {
    const result = await adapter.handleCallback(req.query as Record<string, string>);

    await prisma.account.upsert({
      where: { openid: result.openid },
      update: {
        encryptedAccess: encrypt(result.accessToken),
        encryptedRefresh: encrypt(result.refreshToken),
        expiresAt: new Date(Date.now() + result.expiresIn * 1000),
        nickname: result.nickname,
        avatar: result.avatar,
      },
      create: {
        userId: result.userId,
        platform: adapter.platform,
        openid: result.openid,
        nickname: result.nickname,
        avatar: result.avatar,
        encryptedAccess: encrypt(result.accessToken),
        encryptedRefresh: encrypt(result.refreshToken),
        expiresAt: new Date(Date.now() + result.expiresIn * 1000),
      },
    });

    return res.redirect(redirect(`/dashboard/channels?bind=success&platform=${platform}`));
  } catch (err: any) {
    return res.redirect(
      redirect(`/dashboard/channels?bind=error&msg=${encodeURIComponent(err.message)}`)
    );
  }
};
