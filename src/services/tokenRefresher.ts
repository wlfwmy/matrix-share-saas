import cron from 'node-cron';
import { decrypt, encrypt } from '../utils/crypto';
import { prisma } from '../utils/prismaClient';
import { getRedis } from '../utils/redis';
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

const REFRESH_WINDOW_MS = 2 * 3600_000; // 提前 2 小时刷新
const MAX_FAIL_COUNT = 3; // 连续失败 3 次标记为需要重新授权
const LOCK_KEY = 'lock:token-refresher';
const LOCK_TTL_SECONDS = 300; // 5 分钟，防止任务卡死后永久占锁
const THROTTLE_MS = 300; // 每个账号请求间隔，避免瞬时并发触发平台限流

export function startTokenRefresher() {
  // 每小时整点执行一次
  cron.schedule('0 * * * *', async () => {
    // 分布式锁：PM2 cluster 多实例下只允许一个进程执行，避免并发 refresh
    // 同一账号导致一次性 refresh token 被提前消耗、另一进程刷新失败
    const r = getRedis();
    const acquired = await r.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SECONDS, 'NX');
    if (!acquired) {
      console.log('[Token 续期] 其他实例正在执行，本实例跳过');
      return;
    }

    console.log('[Token 续期] 开始扫描即将过期的托管账号...');

    try {
      const accounts = await prisma.account.findMany({
        where: {
          expiresAt: { lte: new Date(Date.now() + REFRESH_WINDOW_MS) },
        },
      });

      console.log(`[Token 续期] 本轮需刷新 ${accounts.length} 个账号`);

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
          // 注意：Account 表暂未记录 refreshFailCount，失败仅在日志中记录。
          // 如果连续失败率较高，后续建议在 schema 里加 failCount 字段，
          // 或者配合消息告警让管理员人工介入处理。
        }

        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }

      console.log('[Token 续期] 本轮刷新完毕');
    } catch (err: any) {
      console.error('[Token 续期] 查询数据库失败:', err.message);
    } finally {
      await r.del(LOCK_KEY);
    }
  });

  console.log('[Token 续期] 定时任务已启动 (每小时整点，仅刷新 2 小时内到期账号)');
}
