// @ts-nocheck — page.evaluate 在浏览器环境运行，Node.js TS 不认识 document

import { getRedPage, extractRedMetrics, checkRedLoginStatus } from '../services/browserManager';
export type { RedLoginStatus } from '../services/browserManager';

export interface PlatformData {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  followers?: number;
  following?: number;
}

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
}
