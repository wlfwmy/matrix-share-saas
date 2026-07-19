const BASE = '';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  // 账号
  listAccounts: () => api.get<Account[]>('/api/accounts'),
  unbindAccount: (id: string) => api.del(`/api/accounts/${id}`),

  // OSS 签名
  getUploadUrl: (fileName: string, fileType: string) =>
    api.get<{ uploadUrl: string; filePublicUrl: string }>(
      `/api/oss/upload-url?fileName=${encodeURIComponent(fileName)}&fileType=${encodeURIComponent(fileType)}`,
    ),

  // 分发
  publishMatrix: (body: {
    title: string;
    description: string;
    videoUrl: string;
    accounts: { id: string; platform: string; nickname: string }[];
  }) => api.post<{ success: boolean; message: string }>('/api/publish/matrix', body),

  // 支付
  createPayment: (planId: string) =>
    api.post<{ success: boolean; payUrl: string }>('/api/v1/payment/create', { planId }),
  createWechatPayment: (planId: string) =>
    api.post<{ success: boolean; codeUrl: string; outTradeNo: string }>(
      '/api/v1/payment/wechat/create',
      { planId },
    ),
  queryPaymentStatus: (orderId: string) =>
    api.get<{ status: string }>(`/api/v1/payment/status?orderId=${orderId}`),

  // 平台 Cookie 管理
  getCookieStatus: (platform: string) =>
    api.get<{ exists: boolean; lastTestedAt?: string; lastError?: string }>(
      `/api/platform/cookie/${platform}`,
    ),
  saveCookie: (platform: string, cookie: string) =>
    api.post<{ success: boolean }>('/api/platform/cookie', { platform, cookie }),
  deleteCookie: (platform: string) =>
    api.del<{ success: boolean }>(`/api/platform/cookie/${platform}`),
  testCookie: (platform: string) =>
    api.post<{ success: boolean; message: string }>('/api/platform/cookie/test', { platform }),

  // 小红书登录管理
  getRedLoginStatus: () =>
    api.get<{ platform: string; loginStatus: string }>('/api/platform/red/status'),
  startRedLogin: () =>
    api.post<{ success: boolean; message: string }>('/api/platform/red/login'),

  // 微信视频号登录管理
  getWeChatLoginStatus: () =>
    api.get<{ platform: string; loginStatus: string }>('/api/platform/wechat/status'),
  startWeChatLogin: () =>
    api.post<{ success: boolean; message: string }>('/api/platform/wechat/login'),
  bindWeChat: () =>
    api.post<{ success: boolean; nickname: string }>('/api/platform/wechat/bind'),

  // 数据看板
  getAnalytics: (days?: number) =>
    api.get<Record<string, { id: string; date: string; views: number; likes: number; comments: number; shares: number }[]>>(
      `/api/analytics/trend?days=${days || 7}`,
    ),

  // 全平台内容数据（笔记/视频列表 + 评论）
  getPosts: (platform: string) =>
    api.get<ContentItem[]>(`/api/collect/${platform}/posts`),
  refreshPosts: (platform: string) =>
    api.post<{ success: boolean }>(`/api/collect/${platform}/posts/refresh`),
  getComments: (platform: string) =>
    api.get<CommentItem[]>(`/api/collect/${platform}/comments`),
};

export interface Account {
  id: string;
  platform: string;
  nickname: string;
  avatar?: string;
  expiresAt: string;
}

export interface ContentItem {
  id: string;
  title: string;
  publishDate: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  collects: number;
}

export interface CommentItem {
  commenter: string;
  content: string;
  time: string;
  likes: number;
}
