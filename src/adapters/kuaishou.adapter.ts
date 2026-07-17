import axios from 'axios';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult } from './platformAdapter.interface';

const redis = getRedis();

export class KuaishouOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'KUAISHOU';

  async getAuthUrl(userId: string): Promise<string> {
    const appId = process.env.KUAISHOU_APP_ID;
    const redirectUri = encodeURIComponent(process.env.KUAISHOU_REDIRECT_URI!);
    const state = `kuaishou_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);
    return `https://open.kuaishou.com/oauth2/authorize?app_id=${appId}&response_type=code&scope=user_info,video_publish&redirect_uri=${redirectUri}&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const tokenRes = await axios.post('https://open.kuaishou.com/oauth2/access_token', {
      app_id: process.env.KUAISHOU_APP_ID,
      app_secret: process.env.KUAISHOU_APP_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in, open_id } = tokenRes.data;

    const userInfoRes = await axios.get('https://open.kuaishou.com/openapi/user_info', {
      params: { access_token, app_id: process.env.KUAISHOU_APP_ID },
    });
    const userInfo = userInfoRes.data;

    return {
      userId: boundUserId,
      openid: open_id,
      nickname: userInfo.nickname,
      avatar: userInfo.head_url,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  async refreshToken(refreshToken: string) {
    const res = await axios.post('https://open.kuaishou.com/oauth2/refresh_token', {
      app_id: process.env.KUAISHOU_APP_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresIn: res.data.expires_in,
    };
  }
}
