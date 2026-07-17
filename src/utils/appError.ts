export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(msg: string, code?: string) {
    return new AppError(400, msg, code);
  }

  static unauthorized(msg = '未登录', code?: string) {
    return new AppError(401, msg, code);
  }

  static notFound(msg = '资源不存在') {
    return new AppError(404, msg);
  }

  static internal(msg = '服务器内部错误') {
    return new AppError(500, msg);
  }
}

export function errorHandler(err: any, _req: any, res: any, _next: any) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code });
  }
  console.error('[Error]', err?.message || err);
  res.status(500).json({ error: '服务器内部错误' });
}
