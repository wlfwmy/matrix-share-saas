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
};

export interface Account {
  id: string;
  platform: string;
  nickname: string;
  avatar?: string;
  expiresAt: string;
}
