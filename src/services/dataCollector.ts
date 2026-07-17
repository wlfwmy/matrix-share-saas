import cron from 'node-cron';
import { decrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { AnalyticsService } from './analytics.service';

// 导入各平台 adapter（它们支持 fetchData）
import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';

const analytics = new AnalyticsService();

interface DataFetcher {
  platform: string;
  fetchData(accessToken: string, openid: string, appId?: string): Promise<{ views: number; likes: number; comments: number; shares: number }>;
}

const FETCHERS: DataFetcher[] = [
  new DouyinOAuthAdapter(),
  new KuaishouOAuthAdapter(),
  new BilibiliOAuthAdapter(),
  // 小红书和微信暂无可用的公开数据 API，待平台开放后接入
];

export function startDataCollector() {
  // 每 6 小时执行一次
  cron.schedule('0 */6 * * *', async () => {
    console.log('[数据采集] 开始拉取各平台数据...');

    try {
      const accounts = await prisma.account.findMany();

      for (const acc of accounts) {
        const fetcher = FETCHERS.find((f) => f.platform === acc.platform);
        if (!fetcher) continue;

        try {
          const accessToken = decrypt(acc.encryptedAccess);
          const data = await fetcher.fetchData(accessToken, acc.openid, process.env.KUAISHOU_APP_ID);

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
