import crypto from 'crypto';
import { getRedis } from '../utils/redis';
import { http } from '../utils/httpClient';
import { PlatformOAuthAdapter, PlatformTokenResult, PlatformData } from './platformAdapter.interface';

const redis = getRedis();

export class KuaishouOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'KUAISHOU';

  async getAuthUrl(userId: string): Promise<string> {
    const appId = process.env.KUAISHOU_APP_ID;
    const redirectUri = encodeURIComponent(process.env.KUAISHOU_REDIRECT_URI!);

    const state = crypto.randomBytes(16).toString('hex');
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);

    return `https://open.kuaishou.com/oauth2/authorize?app_id=${appId}&response_type=code&scope=user_info,video_publish&redirect_uri=${redirectUri}&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const tokenRes = await http.post('https://open.kuaishou.com/oauth2/access_token', {
      app_id: process.env.KUAISHOU_APP_ID,
      app_secret: process.env.KUAISHOU_APP_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    if (tokenRes.data.result !== undefined && tokenRes.data.result !== 1) {
      throw new Error(`快手授权失败: ${tokenRes.data.error_msg || '未知错误'}`);
    }

    const { access_token, refresh_token, expires_in, open_id } = tokenRes.data;
    if (!access_token) {
      throw new Error('快手授权失败: 响应中缺少 access_token');
    }

    const userInfoRes = await http.get('https://open.kuaishou.com/openapi/user_info', {
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

  /**
   * 拉取快手视频数据：获取用户最近视频的播放量/点赞/评论/分享
   * 注意：目前只拉第一页（size=20），视频数超过 20 条时早期视频数据不计入汇总。
   */
  async fetchData(accessToken: string, openid: string, appId?: string): Promise<PlatformData> {
    const res = await http.get('https://open.kuaishou.com/openapi/video/list', {
      params: { app_id: appId || process.env.KUAISHOU_APP_ID, access_token: accessToken, page: 1, size: 20 },
    });
    const list = res.data?.result || res.data?.data || [];
    return list.reduce(
      (acc: PlatformData, v: any) => ({
        views: acc.views + (v.play_count || v.statistics?.play_count || 0),
        likes: acc.likes + (v.like_count || v.statistics?.like_count || 0),
        comments: acc.comments + (v.comment_count || v.statistics?.comment_count || 0),
        shares: acc.shares + (v.share_count || v.statistics?.share_count || 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0 },
    );
  }

  async refreshToken(refreshToken: string) {
    const res = await http.post('https://open.kuaishou.com/oauth2/refresh_token', {
      app_id: process.env.KUAISHOU_APP_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (res.data.result !== undefined && res.data.result !== 1) {
      throw new Error(`快手 Token 刷新失败: ${res.data.error_msg || '未知错误'}`);
    }
    if (!res.data.access_token) {
      throw new Error('快手 Token 刷新失败: 响应中缺少 access_token');
    }

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresIn: res.data.expires_in,
    };
  }
}
