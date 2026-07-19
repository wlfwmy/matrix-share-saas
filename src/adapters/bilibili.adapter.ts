import axios from 'axios';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult, PlatformData, PostItem, CommentItem } from './platformAdapter.interface';

const redis = getRedis();

export class BilibiliOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'BILIBILI';

  async getAuthUrl(userId: string): Promise<string> {
    const clientId = process.env.BILIBILI_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.BILIBILI_REDIRECT_URI!);
    const state = `bilibili_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);
    return `https://member.bilibili.com/platform/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { code, state } = query;
    if (!code || !state) throw new Error('缺少 code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const tokenRes = await axios.post('https://member.bilibili.com/platform/oauth/access_token', {
      client_id: process.env.BILIBILI_CLIENT_ID,
      client_secret: process.env.BILIBILI_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });

    const { access_token, refresh_token, expires_in, mid } = tokenRes.data.data;

    const userInfoRes = await axios.get('https://member.bilibili.com/platform/user/info', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userInfo = userInfoRes.data.data;

    return {
      userId: boundUserId,
      openid: String(mid),
      nickname: userInfo.name,
      avatar: userInfo.face,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
    };
  }

  /**
   * 拉取B站视频数据：获取用户所有视频的总播放/点赞/评论/分享
   * 接口：/platform/video/video_list → stat
   */
  async fetchData(accessToken: string): Promise<PlatformData> {
    const res = await axios.get('https://member.bilibili.com/platform/video/video_list', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { page: 1, pagesize: 50 },
    });
    const list = res.data?.data?.list || [];
    return list.reduce(
      (acc: PlatformData, v: any) => ({
        views: acc.views + (v.stat?.view ?? v.view_count ?? 0),
        likes: acc.likes + (v.stat?.like ?? v.like_count ?? 0),
        comments: acc.comments + (v.stat?.reply ?? v.reply_count ?? 0),
        shares: acc.shares + (v.stat?.share ?? v.share_count ?? 0),
      }),
      { views: 0, likes: 0, comments: 0, shares: 0 },
    );
  }

  async fetchPostList(accessToken: string, openid: string): Promise<PostItem[]> {
    // TODO: 调用 B 站 video/video_list 获取每篇视频的独立数据
    return [];
  }

  async fetchComments(accessToken: string, openid: string): Promise<CommentItem[]> {
    // TODO: 调用 B 站评论列表 API
    return [];
  }

  async refreshToken(refreshToken: string) {
    const res = await axios.post('https://member.bilibili.com/platform/oauth/refresh_token', {
      client_id: process.env.BILIBILI_CLIENT_ID,
      client_secret: process.env.BILIBILI_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const data = res.data.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }
}
