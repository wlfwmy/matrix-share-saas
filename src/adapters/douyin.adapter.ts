import axios from 'axios';
import crypto from 'crypto';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult, PlatformData } from './platformAdapter.interface';

const redis = getRedis();

export class DouyinOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'DOUYIN';

  async getAuthUrl(userId: string): Promise<string> {
    const clientKey = process.env.DOUYIN_CLIENT_KEY;
    const redirectUri = encodeURIComponent(process.env.DOUYIN_REDIRECT_URI!);

    // state 只需是不可预测的一次性凭证，真正的身份信任来自 Redis 映射，
    // 不需要把 userId 明文拼进去
    const state = crypto.randomBytes(16).toString('hex');
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);

    return `https://open.douyin.com/platform/oauth/connect/?client_key=${clientKey}&response_type=code&scope=video.create&redirect_uri=${redirectUri}&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const tokenRes = await axios.post(
      'https://open.douyin.com/oauth/access_token/',
      {
        client_key: process.env.DOUYIN_CLIENT_KEY,
        client_secret: process.env.DOUYIN_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
      },
      { timeout: 10000 },
    );

    const data = tokenRes.data.data;
    if (data.error_code && data.error_code !== 0) {
      throw new Error(`抖音授权失败: ${data.description}`);
    }

    const { access_token, refresh_token, expires_in, open_id } = data;

    const userInfoRes = await axios.get('https://open.douyin.com/oauth/userinfo/', {
      params: { access_token, open_id },
      timeout: 10000,
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

  /**
   * 拉取抖音视频数据：获取用户最近视频的播放量/点赞/评论/分享
   * 注意：当前只拉最近 20 条视频，账号发布数超过 20 条时早期视频数据不计入汇总。
   * 如需完整历史数据，需处理接口分页（cursor / has_more）。
   */
  async fetchData(accessToken: string, openid: string): Promise<PlatformData> {
    const listRes = await axios.get('https://open.douyin.com/video/list/', {
      params: { open_id: openid, access_token: accessToken, count: 20 },
      timeout: 10000,
    });
    const videoList = listRes.data?.data?.list;
    if (!videoList?.length) return { views: 0, likes: 0, comments: 0, shares: 0 };

    const videoIds = videoList.map((v: any) => v.video_id);
    const dataRes = await axios.post(
      'https://open.douyin.com/video/data/',
      { open_id: openid, access_token: accessToken, video_ids: videoIds },
      { timeout: 10000 },
    );
    const statsList = dataRes.data?.data?.list || [];

    return statsList.reduce(
      (acc: PlatformData, s: any) => ({
        views: acc.views + (s.statistics?.play_count || 0),
        likes: acc.likes + (s.statistics?.digg_count || 0),
        comments: acc.comments + (s.statistics?.comment_count || 0),
        shares: acc.shares + (s.statistics?.share_count || 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0 },
    );
  }

  async refreshToken(refreshToken: string) {
    const res = await axios.post(
      'https://open.douyin.com/oauth/refresh_token/',
      {
        client_key: process.env.DOUYIN_CLIENT_KEY,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      { timeout: 10000 },
    );
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
