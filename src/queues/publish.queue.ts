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

export interface AddJobOptions {
  jobId?: string;
}

export interface IQueue {
  add(name: string, data: PublishJobData, opts?: AddJobOptions): Promise<void>;
}

// 开发模式 — 简单的内存队列
class DevQueue implements IQueue {
  private handlers: ((job: PublishJobData) => Promise<void>)[] = [];
  private seenJobIds = new Set<string>();

  onProcess(handler: (job: PublishJobData) => Promise<void>) {
    this.handlers.push(handler);
  }

  async add(_name: string, data: PublishJobData, opts?: AddJobOptions): Promise<void> {
    const jobId = opts?.jobId ?? data.taskId;
    if (this.seenJobIds.has(jobId)) {
      console.log(`[DevQueue] 重复任务已忽略: ${jobId}`);
      return;
    }
    this.seenJobIds.add(jobId);

    console.log(`[DevQueue] 收到任务: ${data.taskId} (${data.platform})`);
    // 异步执行，不等待完成
    for (const handler of this.handlers) {
      handler(data).catch((err) => {
        console.error(`[DevQueue] 任务失败 ${data.taskId}:`, err.message);
      });
    }
  }

  get name() {
    return 'video-publish';
  }
  get opts() {
    return {};
  }
}

let queueInstance: IQueue;

export async function getQueue(): Promise<IQueue> {
  if (queueInstance) return queueInstance;

  if (process.env.NODE_ENV === 'production') {
    const { Queue } = await import('bullmq');
    const redis = getRedis();
    const bullQueue = new Queue<PublishJobData>('video-publish', {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: { count: 1000 }, // 失败任务只保留最近 1000 条，避免 Redis 无限堆积
      },
    });

    // 包一层，把 jobId 透传给 BullMQ，用于同一 taskId 的重复提交去重
    queueInstance = {
      add: async (name, data, opts) => {
        await bullQueue.add(name, data, {
          jobId: opts?.jobId ?? data.taskId,
        });
      },
    };
  } else {
    console.log('[Queue] 使用内存队列 (开发模式, 无需 Redis)');
    queueInstance = new DevQueue();
  }
  return queueInstance;
}

// 兼容旧导入
export const publishQueue = new Proxy({} as any, {
  get(_target, prop) {
    // 避免被误当作 thenable：访问 .then 时直接返回 undefined，
    // 防止 `await publishQueue`（漏写方法名）被 JS 当成 Promise 解析，
    // 从而抛出跟实际问题无关的诡异错误。
    if (prop === 'then') return undefined;
    return (...args: any[]) => {
      console.warn(`[Queue] 请在 async 上下文中使用 await getQueue() 替代 publishQueue.${String(prop)}`);
      return getQueue().then((q) => (q as any)[prop](...args));
    };
  },
});
