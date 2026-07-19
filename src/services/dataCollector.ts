import cron from 'node-cron';
import { decrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { AnalyticsService } from './analytics.service';
import { PostItem, CommentItem } from '../adapters/platformAdapter.interface';

// OAuth 平台 adapter（它们支持 fetchData）
import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';

// Cookie 平台 collector
import { RedDataCollector } from '../collectors/red.collector';
import { WeChatDataCollector } from '../collectors/wechat.collector';

const analytics = new AnalyticsService();

interface DataFetcher {
  platform: string;
  fetchData(accessToken: string, openid: string, appId?: string): Promise<{ views: number; likes: number; comments: number; shares: number }>;
}

// OAuth 平台：使用 accessToken/openid
const OAUTH_FETCHERS: DataFetcher[] = [
  new DouyinOAuthAdapter(),
  new KuaishouOAuthAdapter(),
  new BilibiliOAuthAdapter(),
];

// Cookie 平台：accessToken 参数复用为 userId，内部查 PlatformCookie 表
const COOKIE_FETCHERS: DataFetcher[] = [
  new RedDataCollector(),
  new WeChatDataCollector(),
];

// OAuth 平台 adapter 完整引用（含 PostItem/CommentItem 方法）
const OAUTH_ADAPTERS = [
  new DouyinOAuthAdapter(),
  new KuaishouOAuthAdapter(),
  new BilibiliOAuthAdapter(),
];

/**
 * 为指定用户+平台拉取并保存笔记/视频列表
 */
export async function collectPostsForUser(userId: string, platform: string): Promise<void> {
  if (platform === 'RED') {
    const collector = new RedDataCollector();
    await collector.collectPostList(userId);
    return;
  }
  if (platform === 'WECHAT') {
    const collector = new WeChatDataCollector();
    await collector.collectPostList(userId);
    return;
  }

  const adapter = OAUTH_ADAPTERS.find(a => a.platform === platform);
  if (!adapter || !adapter.fetchPostList) {
    console.log(`[数据采集] ${platform} 暂未实现 fetchPostList`);
    return;
  }

  const account = await prisma.account.findFirst({ where: { userId, platform } });
  if (!account) throw new Error(`未找到 ${platform} 账号`);

  const accessToken = decrypt(account.encryptedAccess);
  const posts = await adapter.fetchPostList(accessToken, account.openid, process.env.KUAISHOU_APP_ID);

  let saved = 0;
  for (const post of posts) {
    await analytics.setContentItem(userId, platform, post.externalId, post);
    saved++;
  }
  console.log(`[数据采集] ${platform}/${account.nickname}: 已保存 ${saved} 条内容`);
}

/**
 * 为指定用户+平台实时拉取评论列表
 */
export async function fetchCommentsForUser(userId: string, platform: string): Promise<CommentItem[]> {
  if (platform === 'RED') {
    const collector = new RedDataCollector();
    return collector.fetchComments();
  }
  if (platform === 'WECHAT') {
    const collector = new WeChatDataCollector();
    return collector.fetchComments();
  }

  const adapter = OAUTH_ADAPTERS.find(a => a.platform === platform);
  if (!adapter || !adapter.fetchComments) {
    console.log(`[数据采集] ${platform} 暂未实现 fetchComments`);
    return [];
  }

  const account = await prisma.account.findFirst({ where: { userId, platform } });
  if (!account) return [];

  const accessToken = decrypt(account.encryptedAccess);
  return adapter.fetchComments(accessToken, account.openid, process.env.KUAISHOU_APP_ID);
}

export function startDataCollector() {
  // 每 6 小时执行一次
  cron.schedule('0 */6 * * *', async () => {
    console.log('[数据采集] 开始拉取各平台数据...');

    try {
      const accounts = await prisma.account.findMany();

      for (const acc of accounts) {
        try {
          let data: { views: number; likes: number; comments: number; shares: number } | null = null;

          // OAuth 平台
          const oauthFetcher = OAUTH_FETCHERS.find((f) => f.platform === acc.platform);
          if (oauthFetcher) {
            const accessToken = decrypt(acc.encryptedAccess);
            data = await oauthFetcher.fetchData(accessToken, acc.openid, process.env.KUAISHOU_APP_ID);
          }

          // Cookie 平台（accessToken 参数复用为 userId）
          const cookieFetcher = COOKIE_FETCHERS.find((f) => f.platform === acc.platform);
          if (cookieFetcher) {
            data = await cookieFetcher.fetchData(acc.userId, '');
          }

          if (!data) continue;

          // 只存有数据的记录，跳过全零
          if (data.views > 0 || data.likes > 0 || data.comments > 0 || data.shares > 0) {
            await analytics.setMetrics(acc.userId, acc.id, acc.platform, data);
            console.log(`[数据采集] ${acc.platform}/${acc.nickname}: 播放 ${data.views} 点赞 ${data.likes}`);
          }

          // 全平台采集笔记/视频列表
          try {
            await collectPostsForUser(acc.userId, acc.platform);
          } catch (e: any) {
            console.error(`[数据采集] ${acc.platform}/${acc.nickname} 内容列表失败: ${e.message}`);
          }
        } catch (err: any) {
          console.error(`[数据采集] ${acc.platform}/${acc.nickname} 失败: ${err.message}`);
        }
      }

      console.log('[数据采集] 本轮采集完毕');
    } catch (err: any) {
      console.error('[数据采集] 查询数据库失败:', err.message);
    }
  });

  console.log('[数据采集] 定时任务已启动 (每 6 小时)');
}
