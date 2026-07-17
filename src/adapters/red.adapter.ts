import axios from 'axios';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult } from './platformAdapter.interface';

const redis = getRedis();

export class RedOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'RED';

  async getAuthUrl(userId: string): Promise<string> {
    const clientId = process.env.RED_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.RED_REDIRECT_URI!);
    const state = `red_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);
    return `https://open.xiaohongshu.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=scope.snsapi_base,scope.snsapi_publish&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

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

    return {
      userId: boundUserId,
      openid,
      nickname,
      avatar,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  async refreshToken(refreshToken: string) {
    const res = await axios.post('https://api.xiaohongshu.com/oauth2/refresh_token', {
      client_id: process.env.RED_CLIENT_ID,
      client_secret: process.env.RED_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresIn: res.data.expires_in,
    };
  }
}
