import cron from 'node-cron';
import axios from 'axios';
import { decrypt, encrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { RedOAuthAdapter } from '../adapters/red.adapter';
import { DouyinOAuthAdapter } from '../adapters/douyin.adapter';
import { KuaishouOAuthAdapter } from '../adapters/kuaishou.adapter';
import { BilibiliOAuthAdapter } from '../adapters/bilibili.adapter';
import { WeChatOAuthAdapter } from '../adapters/wechat.adapter';

const REFRESHERS: Record<string, { refreshToken: (token: string) => Promise<any> }> = {
  RED: new RedOAuthAdapter(),
  DOUYIN: new DouyinOAuthAdapter(),
  KUAISHOU: new KuaishouOAuthAdapter(),
  BILIBILI: new BilibiliOAuthAdapter(),
  WECHAT: new WeChatOAuthAdapter(),
};

export function startTokenRefresher() {
  // 每 1 小时 30 分钟执行一次
  cron.schedule('0 */1 * * *', async () => {
    console.log('[Token 续期] 开始扫描即将过期的托管账号...');

    try {
      const accounts = await prisma.account.findMany();

      for (const acc of accounts) {
        const refresher = REFRESHERS[acc.platform];
        if (!refresher) {
          console.warn(`[Token 续期] 不支持的平台: ${acc.platform}`);
          continue;
        }

        try {
          const rawRefreshToken = decrypt(acc.encryptedRefresh);
          const result = await refresher.refreshToken(rawRefreshToken);

          await prisma.account.update({
            where: { id: acc.id },
            data: {
              encryptedAccess: encrypt(result.accessToken),
              encryptedRefresh: encrypt(result.refreshToken),
              expiresAt: new Date(Date.now() + result.expiresIn * 1000),
            },
          });

          console.log(`[Token 续期] ${acc.platform}/${acc.nickname} 刷新成功`);
        } catch (err: any) {
          console.error(`[Token 续期] ${acc.platform}/${acc.nickname} 失败: ${err.message}`);
        }
      }

      console.log('[Token 续期] 本轮刷新完毕');
    } catch (err: any) {
      console.error('[Token 续期] 查询数据库失败:', err.message);
    }
  });

  console.log('[Token 续期] 定时任务已启动 (每 90 分钟)');
}
