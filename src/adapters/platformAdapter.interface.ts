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
}
