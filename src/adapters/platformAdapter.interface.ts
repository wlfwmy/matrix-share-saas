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

export interface PlatformOAuthAdapter {
  readonly platform: string;
  getAuthUrl(userId: string): Promise<string>;
  handleCallback(query: Record<string, string>): Promise<PlatformTokenResult>;
  refreshToken(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }>;
}
