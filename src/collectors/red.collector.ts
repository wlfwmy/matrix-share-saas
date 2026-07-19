// @ts-nocheck — page.evaluate 在浏览器环境运行，Node.js TS 不认识 document

import { getRedPage, extractRedMetrics, extractRedPostList, extractRedComments, clickSidebar, clickSidebarAny, checkRedLoginStatus } from '../services/browserManager';
export type { RedLoginStatus } from '../services/browserManager';
import { AnalyticsService } from '../services/analytics.service';

export interface PlatformData {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followers?: number;
  following?: number;
}

const analytics = new AnalyticsService();

/**
 * 小红书数据采集器
 *
 * 使用常驻浏览器（browserManager.getRedPage()），
 * 从创作者中心 Dashboard DOM 提取指标。
 * 浏览器在服务运行期间保持打开，登录态保持在内存中。
 */
export class RedDataCollector {
  readonly platform = 'RED';

  async fetchData(_accessToken?: string, _openid?: string): Promise<PlatformData> {
    const page = await getRedPage();

    // 等待 Dashboard 渲染
    await new Promise(r => setTimeout(r, 10000));

    // 检查登录
    const loggedIn = await page.evaluate(() =>
      document.body.innerText.includes('发布笔记')
    ).catch(() => false);
    if (!loggedIn) throw new Error('NEED_LOGIN:小红书创作者中心未登录');

    await new Promise(r => setTimeout(r, 5000));

    const data = await extractRedMetrics(page);
    if (!data || Object.keys(data).length === 0) throw new Error('RED:无法提取指标数据');

    return {
      views: data.views ?? data.impressions ?? 0,
      likes: data.likes ?? 0,
      comments: data.comments ?? 0,
      shares: data.shares ?? 0,
      followers: data.followers,
      following: data.following,
    };
  }

  /** 采集单篇笔记数据并存入 DB */
  async collectPostList(userId: string): Promise<void> {
    const page = await getRedPage();

    // 确保在首页（加时间戳防 SPA 缓存）
    await page.goto(`https://creator.xiaohongshu.com/?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // 等 SPA 重定向完成 + 侧边栏渲染
    await page.waitForURL('**/creator.xiaohongshu.com/**', { timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));

    // 点"笔记管理"或"内容管理"
    await clickSidebarAny(page, ['笔记管理', '内容管理', '笔记']);
    await new Promise(r => setTimeout(r, 8000));

    const posts = await extractRedPostList(page);
    if (posts.length === 0) {
      console.log('[RED] 笔记列表为空（用户暂无发布笔记）');
      return;
    }

    let saved = 0;
    for (const post of posts) {
      // 用标题+日期作为外部 ID（没有真实 noteId 时的 fallback）
      const externalId = post.publishDate
        ? `red_${post.title}_${post.publishDate.slice(0, 10)}`
        : `red_${post.title}`;
      await analytics.setContentItem(userId, 'RED', externalId, post);
      saved++;
    }
    console.log(`[RED] 已保存 ${saved} 篇笔记数据`);
  }

  /** 实时抓取评论列表 */
  async fetchComments(): Promise<Array<{
    commenter: string; content: string; time: string; likes: number;
  }>> {
    const page = await getRedPage();
    const baseUrl = 'https://creator.xiaohongshu.com';

    // 尝试导航到评论管理页（新旧 UI）
    await page.goto(`${baseUrl}/new/comment?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 如果 404 了（新 UI 没有 /new/comment），直接返回空
    const is404 = await page.evaluate(() => document.body.innerText.includes('页面不见了') || document.body.innerText.includes('不存在')).catch(() => false);
    if (is404) {
      console.log('[RED] 新 UI 无独立评论页，返回空');
      return [];
    }

    const comment = await extractRedComments(page);
    if (comment.length > 0) return comment;

    // fallback: 从首页点击侧边栏
    await page.goto(`${baseUrl}/?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await clickSidebarAny(page, ['评论管理', '评论']);
    await page.waitForTimeout(5000);

    return extractRedComments(page);
  }
}
