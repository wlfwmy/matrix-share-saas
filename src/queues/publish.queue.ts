import { getRedis } from '../utils/redis';

export interface PublishJobData {
  taskId: string;
  userId: string;
  accountId: string;
  platform: 'RED' | 'DOUYIN' | 'KUAISHOU' | 'BILIBILI' | 'WECHAT';
  title: string;
  description: string;
  videoUrl: string;
  watermarkText?: string;
}

export interface IQueue {
  add(name: string, data: PublishJobData): Promise<void>;
}

// 开发模式 — 简单的内存队列
class DevQueue implements IQueue {
  private handlers: ((job: PublishJobData) => Promise<void>)[] = [];

  onProcess(handler: (job: PublishJobData) => Promise<void>) {
    this.handlers.push(handler);
  }

  async add(_name: string, data: PublishJobData): Promise<void> {
    console.log(`[DevQueue] 收到任务: ${data.taskId} (${data.platform})`);
    // 异步执行，不等待完成
    for (const handler of this.handlers) {
      handler(data).catch(err => {
        console.error(`[DevQueue] 任务失败 ${data.taskId}:`, err.message);
      });
    }
  }

  get name() { return 'video-publish'; }
  get opts() { return {}; }
}

let queueInstance: IQueue;

export async function getQueue(): Promise<IQueue> {
  if (queueInstance) return queueInstance;

  if (process.env.NODE_ENV === 'production') {
    const { Queue } = await import('bullmq');
    const redis = getRedis();
    queueInstance = new Queue<PublishJobData>('video-publish', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    }) as unknown as IQueue;
  } else {
    console.log('[Queue] 使用内存队列 (开发模式, 无需 Redis)');
    queueInstance = new DevQueue();
  }
  return queueInstance;
}

// 兼容旧导入
export const publishQueue = new Proxy({} as any, {
  get(_target, prop) {
    return (...args: any[]) => {
      console.warn(`[Queue] 请在 async 上下文中使用 await getQueue() 替代 publishQueue.${String(prop)}`);
      return getQueue().then(q => (q as any)[prop](...args));
    };
  }
});
