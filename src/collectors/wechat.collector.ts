// @ts-nocheck — page.evaluate 在浏览器环境运行，Node.js TS 不认识 document

import { getWeChatPage, extractWeChatMetrics, extractWeChatPostList, extractWeChatComments, navigateWeChatSidebar } from '../services/browserManager';
import { AnalyticsService } from '../services/analytics.service';

export interface PlatformData {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followers?: number;
}

const analytics = new AnalyticsService();

/**
 * 微信视频号数据采集器
 *
 * 使用常驻浏览器，从视频号助手 (channels.weixin.qq.com) Dashboard DOM 提取指标。
 */
export class WeChatDataCollector {
  readonly platform = 'WECHAT';

  async fetchData(): Promise<PlatformData> {
    const page = await getWeChatPage();

    // 确保在首页
    await page.goto('https://channels.weixin.qq.com/platform', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 8000));

    // 检查登录
    const loggedIn = await page.evaluate(() =>
      document.body.innerText.includes('视频号')
    ).catch(() => false);
    if (!loggedIn) throw new Error('NEED_LOGIN:视频号助手未登录');

    await new Promise(r => setTimeout(r, 3000));

    const data = await extractWeChatMetrics(page);
    if (!data || Object.keys(data).length === 0) throw new Error('WECHAT:无法提取指标数据');

    return {
      views: data.views ?? 0,
      likes: data.likes ?? 0,
      comments: data.comments ?? 0,
      shares: 0,
      followers: data.followers,
    };
  }

  /** 采集视频列表并存入 DB */
  async collectPostList(userId: string): Promise<void> {
    const page = await getWeChatPage();

    // 导航到首页
    await page.goto(`https://channels.weixin.qq.com/platform?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));

    // 侧边栏：内容管理 → 视频
    await navigateWeChatSidebar(page, '内容管理', '视频');
    await new Promise(r => setTimeout(r, 5000));

    const posts = await extractWeChatPostList(page);
    if (posts.length === 0) {
      console.log('[WECHAT] 视频列表为空');
      return;
    }

    let saved = 0;
    for (const post of posts) {
      const externalId = post.publishDate
        ? `wechat_${post.title}_${post.publishDate.slice(0, 10)}`
        : `wechat_${post.title}`;
      await analytics.setContentItem(userId, 'WECHAT', externalId, {
        ...post,
        collects: 0,
      });
      saved++;
    }
    console.log(`[WECHAT] 已保存 ${saved} 条视频数据`);
  }

  /** 实时抓取评论列表 */
  async fetchComments(): Promise<Array<{
    commenter: string; content: string; time: string; likes: number;
  }>> {
    const page = await getWeChatPage();

    // 直接导航到评论页 URL
    await page.goto('https://channels.weixin.qq.com/platform/interaction/comment', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // 快速检查页面是否正常加载（不是空白页或404）
    const pageOk = await page.evaluate(() => {
      const t = document.body.innerText;
      return t.includes('视频号') || t.includes('评论');
    }).catch(() => false);
    if (!pageOk) {
      console.log('[WECHAT] 评论页未正常加载');
      return [];
    }

    const comments = await extractWeChatComments(page);
    if (comments.length > 0) return comments;

    // fallback: 从首页通过侧边栏导航，给 SPA 更多加载时间
    await page.goto(`https://channels.weixin.qq.com/platform?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await navigateWeChatSidebar(page, '互动管理', '评论');
    await page.waitForTimeout(8000); // 给 SPA 更多时间加载

    return extractWeChatComments(page);
  }
}
