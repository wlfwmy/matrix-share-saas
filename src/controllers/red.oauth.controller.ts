import { Request, Response } from 'express';
import axios from 'axios';
import { getRedis } from '../utils/redis';
import { encrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';

const redis = getRedis();
const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:5173';
const APP_PROTOCOL = process.env.NODE_ENV === 'production' ? 'https' : 'http';
const redirect = (path: string) => `${APP_PROTOCOL}://${APP_DOMAIN}${path}`;

export const getRedAuthUrl = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  if (!userId) return res.status(401).json({ error: '未登录' });

  const clientId = process.env.RED_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.RED_REDIRECT_URI!);
  const state = `red_${userId}_${Math.random().toString(36).substring(2, 10)}`;
  await redis.set(`oauth:state:${state}`, userId, 'EX', 600);

  const authUrl = `https://open.xiaohongshu.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=scope.snsapi_base,scope.snsapi_publish&state=${state}`;
  return res.json({ authUrl });
};

export const handleRedCallback = async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) {
    return res.redirect(redirect('/dashboard/channels?bind=error&msg=MissingParams'));
  }

  const boundUserId = await redis.get(`oauth:state:${state}`);
  if (!boundUserId) {
    return res.redirect(redirect('/dashboard/channels?bind=error&msg=InvalidOrExpiredState'));
  }
  await redis.del(`oauth:state:${state}`);

  try {
    const tokenRes = await axios.post('https://api.xiaohongshu.com/oauth2/access_token', {
      client_id: process.env.RED_CLIENT_ID,
      client_secret: process.env.RED_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.RED_REDIRECT_URI,
    });

    const { access_token, refresh_token, expires_in, openid } = tokenRes.data;

    const userInfoRes = await axios.get('https://api.xiaohongshu.com/api/open/v1/user/info', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const { nickname, avatar } = userInfoRes.data.data;

    await prisma.account.upsert({
      where: { platform_openid: { platform: 'RED', openid } },
      update: {
        encryptedAccess: encrypt(access_token),
        encryptedRefresh: encrypt(refresh_token),
        expiresAt: new Date(Date.now() + expires_in * 1000),
        nickname,
        avatar,
      },
      create: {
        userId: boundUserId,
        platform: 'RED',
        openid,
        nickname,
        avatar,
        encryptedAccess: encrypt(access_token),
        encryptedRefresh: encrypt(refresh_token),
        expiresAt: new Date(Date.now() + expires_in * 1000),
      },
    });

    return res.redirect(redirect('/dashboard/channels?bind=success&platform=red'));
  } catch (err: any) {
    return res.redirect(
      redirect(`/dashboard/channels?bind=error&msg=${encodeURIComponent('授权失败,请重试')}`)
    );
  }
};
