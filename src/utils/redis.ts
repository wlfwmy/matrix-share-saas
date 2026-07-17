// 内存 Redis Mock — 开发模式用，无需安装 Redis
// 接口兼容 ioredis 的 get/set/del 等常用方法

class RedisMock {
  private store = new Map<string, { value: string; expiry: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiry > 0 && Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, mode?: string | number, ttl?: number): Promise<'OK'> {
    let expiry = 0;
    if (mode === 'EX' && ttl) {
      expiry = Date.now() + ttl * 1000;
    } else if (typeof mode === 'number') {
      expiry = Date.now() + mode * 1000;
    }
    this.store.set(key, { value, expiry });
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }

  // ioredis 兼容: 自动断开连接
  async quit() { this.store.clear(); }
  async disconnect() { /* noop */ }
  on(_event: string, _cb: (...args: any[]) => void) { return this; }
}

// 生产环境用真实 ioredis，开发环境用内存 Mock
let instance: any = null;

export function getRedis(): any {
  if (instance) return instance;
  if (process.env.NODE_ENV === 'production') {
    const IORedis = require('ioredis');
    instance = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });
  } else {
    console.log('[Redis] 使用内存 Mock (开发模式, 无需安装 Redis)');
    instance = new RedisMock();
  }
  return instance;
}
