/** 统一平台 OAuth 适配器接口 */

export interface PlatformTokenResult {
  userId: string;
  openid: string;
  nickname: string;
  avatar?: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** 平台数据看板数据 */
export interface PlatformData {
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/** 单篇内容数据（笔记/视频） */
export interface PostItem {
  externalId: string;
  title: string;
  publishDate?: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
}

/** 评论数据 */
export interface CommentItem {
  commenter: string;
  content: string;
  time: string;
  likes: number;
}

export interface PlatformOAuthAdapter {
  readonly platform: string;
  getAuthUrl(userId: string): Promise<string>;
  handleCallback(query: Record<string, string>): Promise<PlatformTokenResult>;
  refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>;
  /** 拉取该平台账号的累计数据（播放量/点赞等），暂未实现的平台返回 null */
  fetchData?(accessToken: string, openid: string, appId?: string): Promise<PlatformData>;

  /** 拉取内容列表（每篇笔记/视频的独立数据） */
  fetchPostList?(accessToken: string, openid: string, appId?: string): Promise<PostItem[]>;

  /** 拉取评论列表 */
  fetchComments?(accessToken: string, openid: string, appId?: string): Promise<CommentItem[]>;
}
