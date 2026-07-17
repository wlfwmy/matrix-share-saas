import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppError } from '../utils/appError';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production';

export function signToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    // 开发环境：未传 token 时用默认 userId 方便调试
    if (process.env.NODE_ENV !== 'production') {
      (req as any).userId = 'dev_user';
      return next();
    }
    throw AppError.unauthorized();
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string };
    (req as any).userId = payload.userId;
    next();
  } catch {
    throw AppError.unauthorized('登录已过期，请重新登录');
  }
}
