import cron from 'node-cron';
import { decrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { AnalyticsService } from './analytics.service';

// OAuth 平台 adapter（它们支持 fetchData）
import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';

// Cookie 平台 collector
import { RedDataCollector } from '../collectors/red.collector';

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
];

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
            await analytics.setMetrics(acc.userId, acc.platform, data);
            console.log(`[数据采集] ${acc.platform}/${acc.nickname}: 播放 ${data.views} 点赞 ${data.likes}`);
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
