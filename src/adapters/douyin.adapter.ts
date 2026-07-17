import axios from 'axios';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult } from './platformAdapter.interface';

const redis = getRedis();

export class DouyinOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'DOUYIN';

  async getAuthUrl(userId: string): Promise<string> {
    const clientKey = process.env.DOUYIN_CLIENT_KEY;
    const redirectUri = encodeURIComponent(process.env.DOUYIN_REDIRECT_URI!);
    const state = `douyin_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);
    return `https://open.douyin.com/platform/oauth/connect/?client_key=${clientKey}&response_type=code&scope=video.create&redirect_uri=${redirectUri}&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const tokenRes = await axios.post('https://open.douyin.com/oauth/access_token/', {
      client_key: process.env.DOUYIN_CLIENT_KEY,
      client_secret: process.env.DOUYIN_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    const data = tokenRes.data.data;
    if (data.error_code && data.error_code !== 0) {
      throw new Error(`抖音授权失败: ${data.description}`);
    }

    const { access_token, refresh_token, expires_in, open_id } = data;

    const userInfoRes = await axios.get('https://open.douyin.com/oauth/userinfo/', {
      params: { access_token, open_id },
    });
    const userInfo = userInfoRes.data.data;

    return {
      userId: boundUserId,
      openid: open_id,
      nickname: userInfo.nickname,
      avatar: userInfo.avatar,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  async refreshToken(refreshToken: string) {
    const res = await axios.post('https://open.douyin.com/oauth/refresh_token/', {
      client_key: process.env.DOUYIN_CLIENT_KEY,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const data = res.data.data;
    if (data.error_code && data.error_code !== 0) {
      throw new Error(`抖音 Token 刷新失败: ${data.description}`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
}
