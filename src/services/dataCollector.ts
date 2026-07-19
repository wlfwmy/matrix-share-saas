import cron from 'node-cron';
import { decrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { getRedis } from '../utils/redis';
import { AnalyticsService } from './analytics.service';

import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';
import { RedOAuthAdapter } from '../adapters/red.adapter';
import { WeChatOAuthAdapter } from '../adapters/wechat.adapter';

const analytics = new AnalyticsService();

interface DataFetcher {
  platform: string;
  fetchData(
    accessToken: string,
    openid: string,
    appId?: string,
  ): Promise<{ views: number; likes: number; comments: number; shares: number }>;
}

const FETCHERS: DataFetcher[] = [
  new DouyinOAuthAdapter(),
  new KuaishouOAuthAdapter(),
  new BilibiliOAuthAdapter(),
  // 小红书和微信暂无可用的公开数据 API，待平台开放后接入
];

const LOCK_KEY = 'lock:data-collector';
const LOCK_TTL_SECONDS = 600; // 10 分钟，覆盖任务最长可能耗时，防止卡死后永久占锁
const THROTTLE_MS = 300; // 每个账号请求间隔，避免瞬时并发触发平台限流

export function startDataCollector() {
  // 每 6 小时整点执行一次
  cron.schedule('0 */6 * * *', async () => {
    // 分布式锁：PM2 cluster 多实例下只允许一个进程执行
    const r = getRedis();
    const acquired = await r.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) {
      console.log('[数据采集] 其他实例正在执行，本实例跳过');
      return;
    }

    console.log('[数据采集] 开始拉取各平台数据...');

    try {
      const accounts = await prisma.account.findMany();

      let successCount = 0;
      let failCount = 0;

      for (const acc of accounts) {
        const fetcher = FETCHERS.find((f) => f.platform === acc.platform);
        if (!fetcher) continue;

        try {
          const accessToken = decrypt(acc.encryptedAccess);
          const data = await fetcher.fetchData(accessToken, acc.openid, process.env.KUAISHOU_APP_ID);

          // 无条件存储：真实的 0 和"接口异常"不应靠"是否全零"来区分，
          // 异常数值由 AnalyticsService 内部 sanitize 兜底；
          // 要求各 adapter.fetchData 在解析失败时 throw，而不是返回全零对象。
          await analytics.setMetrics(acc.userId, acc.id, acc.platform, data);
          console.log(`[数据采集] ${acc.platform}/${acc.nickname}: 播放 ${data.views} 点赞 ${data.likes}`);
          successCount++;
        } catch (err: any) {
          failCount++;
          console.error(`[数据采集] ${acc.platform}/${acc.nickname} 失败: ${err.message}`);
        }

        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }

      console.log(`[数据采集] 本轮采集完毕，成功 ${successCount} 失败 ${failCount}`);
    } catch (err: any) {
      console.error('[数据采集] 查询数据库失败:', err.message);
    } finally {
      await r.del(LOCK_KEY);
    }
  });

  console.log('[数据采集] 定时任务已启动 (每 6 小时整点)');
}

/** 触发刷新内容列表（数据看板手动刷新入口） */
export async function collectPostsForUser(userId: string, platform: string): Promise<void> {
  const accounts = await prisma.account.findMany({ where: { userId, platform } });
  for (const acc of accounts) {
    const fetcher = FETCHERS.find((f) => f.platform === platform);
    if (!fetcher || !('fetchPostList' in fetcher)) continue;
    const accessToken = decrypt(acc.encryptedAccess);
    const posts = await (fetcher as any).fetchPostList(accessToken, acc.openid);
    for (const post of posts) {
      await prisma.contentItem.upsert({
        where: { platform_externalId: { platform, externalId: post.externalId } },
        update: { title: post.title, views: post.views, likes: post.likes, comments: post.comments, shares: post.shares, collects: post.collects },
        create: { userId, platform, externalId: post.externalId, title: post.title, publishDate: post.publishDate ? new Date(post.publishDate) : null, views: post.views, likes: post.likes, comments: post.comments, shares: post.shares, collects: post.collects },
      });
    }
  }
}

/** 实时拉取评论列表 */
export async function fetchCommentsForUser(userId: string, platform: string): Promise<any[]> {
  const accounts = await prisma.account.findMany({ where: { userId, platform } });
  if (accounts.length === 0) return [];
  const fetcher = FETCHERS.find((f) => f.platform === platform);
  if (!fetcher || !('fetchComments' in fetcher)) return [];
  const accessToken = decrypt(accounts[0].encryptedAccess);
  return (fetcher as any).fetchComments(accessToken, accounts[0].openid) || [];
}
