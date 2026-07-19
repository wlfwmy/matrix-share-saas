import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/appError';

// 启动时立即校验，配置缺失直接拒绝启动，绝不静默降级为默认密钥
const RAW_SECRET = process.env.JWT_SECRET;
if (!RAW_SECRET) {
  throw new Error('JWT_SECRET 未配置，服务拒绝启动');
}
if (RAW_SECRET.length < 32) {
  throw new Error('JWT_SECRET 长度不足，建议至少 32 个字符');
}
const JWT_SECRET: string = RAW_SECRET;

// 显式开关控制是否允许开发环境免鉴权 fallback，
// 不再仅依赖 NODE_ENV 拼写正确这一个隐式条件
const ALLOW_DEV_FALLBACK =
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_FALLBACK !== 'false';

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    if (ALLOW_DEV_FALLBACK) {
      console.warn('[鉴权] 未传 Token，使用开发环境 dev_user 兜底（生产环境不应看到此日志）');
      (req as any).userId = 'dev_user';
      return next();
    }
    return next(AppError.unauthorized());
  }

  try {
    const token = header.slice(7);
    // 显式锁定算法，防止算法混淆类问题
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return next(AppError.unauthorized('登录已过期，请重新登录'));
    }
    return next(AppError.unauthorized('登录状态无效，请重新登录'));
  }
}
