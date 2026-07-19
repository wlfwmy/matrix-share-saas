// @ts-nocheck — page.evaluate 在浏览器环境运行，Node.js TS 不认识 document

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';

const RED_PROFILE_DIR = path.resolve(__dirname, '../../edge-profile');

let browser: Browser | null = null;

/** 获取/创建共享无头浏览器实例（用于 cookie 上下文） */
export async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
  }
  return browser;
}

/** 使用持久化浏览器 profile 创建上下文 */
export async function createPersistentContext(): Promise<{
  context: BrowserContext;
  close: () => Promise<void>;
}> {
  const context = await chromium.launchPersistentContext(RED_PROFILE_DIR, {
    headless: true,
    args: ['--no-sandbox'],
    locale: 'zh-CN',
  });
  return { context, close: () => context.close() };
}

/** 创建独立的 cookie 上下文 */
export async function createContext(cookiesStr: string): Promise<BrowserContext> {
  const b = await getBrowser();
  const context = await b.newContext({
    locale: 'zh-CN',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });
  const cookies = cookiesStr.split(';').map((pair) => {
    const [name, ...rest] = pair.trim().split('=');
    return { name: name.trim(), value: rest.join('=').trim(), domain: '.xiaohongshu.com', path: '/' };
  });
  await context.addCookies(cookies);
  return context;
}

// ── 小红书常驻浏览器 ──────────────────────────────
// Edge 浏览器通过 scripts/start-edge.cmd 提前启动（或手动），
// 监听固定端口 9222，服务启动后通过 CDP 连接即可。
// 登录态保存在 edge-profile/ 目录，重启后可复用。

const CDP_PORT = 9222;
let redBrowser: Browser | null = null;
let redContext: BrowserContext | null = null;
let redLoginResolve: (() => void) | null = null;

export type RedLoginStatus = 'unknown' | 'need_login' | 'ok' | 'expired';

/** 连接正在运行的 Edge 浏览器（固定端口 9222） */
export async function getRedPage(): Promise<Page> {
  // 复用已有连接
  if (redBrowser?.isConnected() && redContext) {
    const pages = redContext.pages();
    for (const p of pages) {
      if (!p.isClosed()) return p;
    }
    return await redContext.newPage();
  }

  // 关闭旧上下文
  if (redContext) { try { await redContext.close(); } catch {} redContext = null; }

  // 连接正在运行的 Edge（通过 scripts/start-edge.cmd 提前启动）
  try {
    redBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { timeout: 10000 });
  } catch (e: any) {
    throw new Error(`Edge 未运行。请先运行 scripts/start-edge.cmd 启动浏览器。(${e.message})`);
  }

  const existingCtx = redBrowser.contexts();
  redContext = existingCtx[0] || await redBrowser.newContext({ locale: 'zh-CN' });

  redBrowser.on('disconnected', () => {
    console.log('[RED] Browser disconnected');
    redBrowser = null;
    redContext = null;
  });

  const page = await redContext.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });`);

  await page.goto('https://creator.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page;
}

/** 检查小红书登录态 */
export async function checkRedLoginStatus(): Promise<RedLoginStatus> {
  try {
    const page = await getRedPage();
    await new Promise(r => setTimeout(r, 8000));
    const ok = await page.evaluate(() => document.body.innerText.includes('发布笔记')).catch(() => false);
    return ok ? 'ok' : 'need_login';
  } catch (e: any) {
    console.error('[RED] checkRedLoginStatus error:', e.message);
    return 'unknown';
  }
}

/**
 * 等待用户登录（在已打开的浏览器中操作）
 */
export async function waitForRedLogin(): Promise<void> {
  const page = await getRedPage();
  const loggedIn = await page.evaluate(() => document.body.innerText.includes('发布笔记')).catch(() => false);
  if (loggedIn) return;

  await page.goto('https://creator.xiaohongshu.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  return new Promise((resolve) => {
    redLoginResolve = resolve;
    pollLogin(page, resolve);
  });
}

async function pollLogin(page: Page, resolve: () => void) {
  const ok = await page.evaluate(() => document.body.innerText.includes('发布笔记')).catch(() => false);
  if (ok) { resolve(); return; }
  setTimeout(() => pollLogin(page, resolve), 1000);
}

/** 从常驻浏览器提取 Dashboard 指标 */
export async function extractRedMetrics(page: Page): Promise<Record<string, number>> {
  const data = await page.evaluate(() => {
    const lines = document.body.innerText.split('\n').filter((l: string) => l.trim());
    const pairs: Record<string, string> = {};
    for (let i = 0; i < lines.length - 1; i++) {
      const cur = lines[i].trim();
      const next = lines[i + 1].trim();
      if (/^[\d.]+%?$/.test(next) && /[一-鿿]/.test(cur) && !/[0-9]/.test(cur)) {
        pairs[cur] = next;
      }
    }
    const fields: Record<string, string> = {
      '粉丝数': 'followers', '关注数': 'following', '获赞与收藏': 'likesAndCollects',
      '曝光数': 'impressions', '观看数': 'views', '点赞数': 'likes',
      '评论数': 'comments', '收藏数': 'favorites', '分享数': 'shares', '净涨粉': 'netFollowers',
    };
    const result: Record<string, number> = {};
    for (const [label, key] of Object.entries(fields)) {
      if (pairs[label] !== undefined) result[key] = parseInt(pairs[label]) || 0;
    }
    return result;
  });
  return data;
}

/** 点击侧边栏菜单切换 SPA 页面 */
export async function clickSidebar(page: Page, name: string): Promise<void> {
  await page.getByText(name, { exact: false }).first().click();
  await new Promise(r => setTimeout(r, 5000));
}

/** 点击侧边栏菜单（尝试多个可能的标签名） */
export async function clickSidebarAny(page: Page, names: string[]): Promise<boolean> {
  for (const name of names) {
    const count = await page.getByText(name, { exact: false }).count();
    if (count > 0) {
      await page.getByText(name, { exact: false }).first().click();
      await new Promise(r => setTimeout(r, 5000));
      return true;
    }
  }
  return false;
}

/** 从笔记管理页提取单篇笔记数据 */
export async function extractRedPostList(page: Page): Promise<Array<{
  externalId: string; title: string; publishDate: string | null;
  views: number; likes: number; comments: number; shares: number; collects: number;
}>> {
  await page.waitForTimeout(3000);

  const EMPTY_INDICATORS = ['暂无数据', '没有找到相关笔记', '暂无笔记', '暂无内容', '还没有发布笔记'];
  const SIDEBAR_ITEMS = new Set([
    '首页', '数据概览', '发布笔记', '笔记管理', '评论管理', '创作设置',
    '创作激励', '数据中心', '成长中心', '合作中心', '灵感笔记', '热门话题',
    '内容分析', '粉丝数据', '变现中心', '创作中心', '数据分析', '内容管理',
    '设置', '帮助', '反馈', '退出登录', '创作者中心', '我的创作', '消息',
    '登录', '注册', '小红书', '创作者服务中心',
  ]);

  return page.evaluate(({ emptyIndicators, sidebarItems }) => {
    const text = document.body.innerText;

    // 空状态检测
    for (const kw of emptyIndicators) {
      if (text.includes(kw)) return [];
    }

    const lines = text.split('\n').filter(l => l.trim());
    const posts: Array<{
      title: string; publishDate: string | null;
      views: number; likes: number; comments: number; shares: number; collects: number;
    }> = [];
    let current: Record<string, string> = {};

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();

      // 跳过侧边栏/导航
      if (sidebarItems.includes(l)) continue;
      // 跳过纯数字、URL、单字符
      if (/^\d+$/.test(l) || /^https?:\/\//.test(l) || l.length <= 1) continue;

      // 指标行：指标关键词 + 下一行是数字
      const nextVal = lines[i + 1]?.trim();
      if (/^(粉丝|关注|曝光|观看|点赞|评论|收藏|分享|净涨)/.test(l) && nextVal && /^\d+$/.test(nextVal)) {
        current[l] = nextVal;
        continue;
      }

      // 遇到新的标题行 → 保存上一篇
      if (/[一-鿿]{2,}/.test(l) && !current.title) {
        // 如果 current 中有残留数据，先保存
        if (Object.keys(current).length > 1) {
          posts.push({
            title: current.title || '',
            publishDate: current.publishDate || null,
            views: parseInt(current['观看数']) || 0,
            likes: parseInt(current['点赞数']) || 0,
            comments: parseInt(current['评论数']) || 0,
            shares: parseInt(current['分享数']) || 0,
            collects: parseInt(current['收藏数']) || 0,
          });
        }
        current = { title: l };
        // 下一行可能是日期
        const next = lines[i + 1]?.trim();
        if (next && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(next)) {
          current.publishDate = next;
        }
      }
    }

    // 最后一个
    if (current.title) {
      posts.push({
        title: current.title,
        publishDate: current.publishDate || null,
        views: parseInt(current['观看数']) || 0,
        likes: parseInt(current['点赞数']) || 0,
        comments: parseInt(current['评论数']) || 0,
        shares: parseInt(current['分享数']) || 0,
        collects: parseInt(current['收藏数']) || 0,
      });
    }

    // 只保留有至少一项有效指标的笔记（过滤掉导航文字误匹配）
    return posts.filter(p => p.views > 0 || p.likes > 0 || p.comments > 0 || p.shares > 0 || p.collects > 0);
  }, { emptyIndicators: EMPTY_INDICATORS, sidebarItems: [...SIDEBAR_ITEMS] });
}

/** 从评论管理页提取评论 */
export async function extractRedComments(page: Page): Promise<Array<{
  commenter: string; content: string; time: string; likes: number;
}>> {
  await page.waitForTimeout(3000);

  const EMPTY_INDICATORS = ['暂无数据', '没有找到相关评论', '暂无评论', '暂无内容', '还没有评论'];

  return page.evaluate(({ emptyIndicators }) => {
    const text = document.body.innerText;

    // 空状态检测
    for (const kw of emptyIndicators) {
      if (text.includes(kw)) return [];
    }

    // 检查页面是否确实在评论管理页（需要有时间词和评论特征）
    const timePattern = /\d+分钟前|\d+小时前|\d+天前|刚刚|昨天/;
    if (!timePattern.test(text)) return [];

    const lines = text.split('\n').filter(l => l.trim());
    const comments: Array<{ commenter: string; content: string; time: string; likes: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();

      // 跳过已知的非评论行
      if (/^(首页|数据概览|发布笔记|笔记管理|评论管理|创作设置|创作激励|设置|帮助|反馈|退出|登录|注册|消息)$/.test(l)) continue;
      if (/^\d+$/.test(l) || /^https?:\/\//.test(l) || l.length <= 1) continue;

      // 真正的评论用户：2-12 个中文字符，不以常见功能词开头
      if (/^[一-鿿·]{2,12}$/.test(l)
          && !/^(粉丝|关注|曝光|观看|点赞|评论|收藏|分享|净涨|数据|内容|创作|成长|合作|变现|灵感|热门|帮助|设置|全部|回复|删除)/.test(l))
      {
        const next = lines[i + 1]?.trim();
        if (!next) continue;

        // 内容行不能是功能词
        if (/^(粉丝|关注|曝光|观看|点赞|评论数|收藏|分享|净涨|数据|内容|创作)/.test(next)) continue;

        const commenter = l;
        const content = next;
        const time = lines[i + 2]?.trim() || '';

        // 时间行必须匹配时间格式
        if (!timePattern.test(time) && time !== '') continue;

        const likesLine = lines[i + 3]?.trim();
        const likes = likesLine && /^\d+$/.test(likesLine) ? parseInt(likesLine) : 0;

        comments.push({ commenter, content, time, likes });
        i += 3;
      }
    }

    return comments;
  }, { emptyIndicators: EMPTY_INDICATORS });
}

// ── 微信视频号 ──────────────────────────────
// 复用同一个 Edge 浏览器，打开视频号助手页面

let weChatLoginResolve: (() => void) | null = null;

export type WeChatLoginStatus = 'unknown' | 'need_login' | 'ok' | 'expired';

/** 获取视频号助手页面 */
export async function getWeChatPage(): Promise<Page> {
  // 复用已有的 CDP 连接
  if (redBrowser?.isConnected()) {
    // 找一个已有的视频号页面，或创建新页面
    for (const ctx of redBrowser.contexts()) {
      for (const p of ctx.pages()) {
        const url = p.url();
        if (url.includes('channels.weixin.qq.com') && !p.isClosed()) return p;
      }
    }
    // 没有现有页面 → 新建一个
    const ctx = redBrowser.contexts()[0] || await redBrowser.newContext({ locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });`);
    await page.goto('https://channels.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    return page;
  }

  // 连接尚未建立，委托 getRedPage 建立连接后重定向
  const page = await getRedPage();
  await page.goto('https://channels.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  return page;
}

/** 检查视频号助手登录态 */
export async function checkWeChatLoginStatus(): Promise<WeChatLoginStatus> {
  try {
    const page = await getWeChatPage();
    await new Promise(r => setTimeout(r, 5000));

    // 判断是否出现登录二维码
    const hasQR = await page.evaluate(() => {
      return document.querySelector('canvas') !== null
        || document.body.innerText.includes('请使用微信扫一扫')
        || document.body.innerText.includes('二维码');
    }).catch(() => false);
    if (hasQR) return 'need_login';

    // 判断是否已登录（看到主面板）
    const hasDashboard = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('视频号') && text.includes('助手') && (text.includes('首页') || text.includes('昨日数据'));
    }).catch(() => false);
    if (hasDashboard) return 'ok';

    return 'need_login';
  } catch (e: any) {
    console.error('[WECHAT] checkWeChatLoginStatus error:', e.message);
    return 'unknown';
  }
}

/** 等待用户扫码登录 */
export async function waitForWeChatLogin(): Promise<void> {
  const page = await getWeChatPage();
  const loggedIn = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('视频号') && text.includes('助手');
  }).catch(() => false);
  if (loggedIn) return;

  // 确保在登录页
  await page.goto('https://channels.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  return new Promise((resolve) => {
    weChatLoginResolve = resolve;
    pollWeChatLogin(page, resolve);
  });
}

async function pollWeChatLogin(page: Page, resolve: () => void) {
  const ok = await page.evaluate(() => {
    const text = document.body.innerText;
    return text.includes('视频号') && text.includes('助手') && text.includes('首页');
  }).catch(() => false);
  if (ok) { resolve(); return; }
  setTimeout(() => pollWeChatLogin(page, resolve), 1000);
}

/**
 * 视频号助手侧边栏导航（处理二级菜单：点击父项展开，再点子项）
 * @param parentLabel 父菜单文字（如"内容管理""互动管理"）
 * @param childLabel 子菜单文字（如"视频""评论"）
 */
export async function navigateWeChatSidebar(page: Page, parentLabel: string, childLabel?: string): Promise<boolean> {
  // 先点击父菜单展开子项
  const parentClicked = await page.evaluate((label) => {
    const items = [...document.querySelectorAll('*')].filter(
      el => el.textContent?.trim() === label && el.offsetParent !== null
    );
    if (items.length > 0) { (items[0] as HTMLElement).click(); return true; }
    return false;
  }, parentLabel);
  if (!parentClicked) return false;
  await new Promise(r => setTimeout(r, 1500));

  if (!childLabel) return true;

  // 点击子菜单
  return page.evaluate((label) => {
    const items = [...document.querySelectorAll('span')].filter(
      el => el.textContent?.trim() === label && el.offsetParent !== null
    );
    if (items.length > 0) { (items[0] as HTMLElement).click(); return true; }
    return false;
  }, childLabel);
}

/** 从视频号助手 Dashboard 提取指标 */
export async function extractWeChatMetrics(page: Page): Promise<Record<string, number>> {
  const data = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').filter(l => l.trim());

    // 视频号助手指标关键词映射
    // 实际页面："昨日数据 | 净增关注 0 | 新增播放 0 | 新增 0 | 新增评论 0"
    const metrics: Record<string, string> = {
      '新增播放': 'views',
      '新增评论': 'comments',
      '净增关注': 'followers',
      '新增关注': 'followers',
      '新增': 'likes',            // "新增" 是点赞数
      '总播放': 'totalViews',
      '总获赞': 'totalLikes',
    };

    const result: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      const cur = lines[i].trim();
      const next = lines[i + 1]?.trim();
      for (const [cn, key] of Object.entries(metrics)) {
        // 使用 === 避免 "新增" 误匹配 "新增播放"
        if (cur === cn && next && /^\d+$/.test(next)) {
          result[key] = parseInt(next) || 0;
        }
      }
    }
    return result;
  });
  return data;
}

/** 提取视频列表（需先导航到 内容管理 → 视频） */
export async function extractWeChatPostList(page: Page): Promise<Array<{
  title: string; publishDate: string | null;
  views: number; likes: number; comments: number; shares: number;
}>> {
  await page.waitForTimeout(5000);

  // 尝试从 DOM 中寻找视频卡片元素（SPA 动态渲染）
  const cardTitles = await page.evaluate(() => {
    const cards = document.querySelectorAll('[class*="video"] [class*="title"], [class*="card"] [class*="name"], [class*="list"] [class*="title"]');
    return Array.from(cards).slice(0, 50).map(el => el.textContent?.trim()).filter(Boolean);
  }).catch(() => []);

  if (cardTitles.length > 0) {
    return cardTitles.map(title => ({ title: title!, publishDate: null, views: 0, likes: 0, comments: 0, shares: 0 }));
  }

  // fallback: 从文本提取（dashboard 区域以上的文字都是导航/账号信息，跳过）
  return page.evaluate(() => {
    const text = document.body.innerText;
    if (text.includes('暂无数据') || text.includes('没有视频')) return [];

    const lines = text.split('\n').filter(l => l.trim());

    // 内容管理页中，"昨日数据" 之后的文字是 dashboard 概览而非视频列表
    // 视频列表在 SPA 中通过 API 动态渲染，不会出现在纯文本中
    // 目前已知无法可靠提取，返回空数组让上层处理
    return [];
  });
}

/** 从视频号助手页面提取账号信息（昵称、视频号ID） */
export async function extractWeChatAccountInfo(page: Page): Promise<{ nickname: string; wxId: string }> {
  return page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let nickname = '';
    let wxId = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l === '视频号ID:' && i + 1 < lines.length) wxId = lines[i + 1];
      if (l === '申请认证' && i >= 1) nickname = lines[i - 1];
    }
    if (!nickname) {
      for (const l of lines) {
        if (/^[一-鿿·]{2,10}$/.test(l) && l !== '申请认证') { nickname = l; break; }
      }
    }
    return { nickname, wxId };
  });
}

/** 提取评论列表（需先导航到 互动管理 → 评论） */
export async function extractWeChatComments(page: Page): Promise<Array<{
  commenter: string; content: string; time: string; likes: number;
}>> {
  await page.waitForTimeout(5000);

  // 收集主文档 + 所有可访问 iframe 中的文本
  const allText: string[] = await page.evaluate(() => {
    const texts: string[] = [document.body.innerText];
    for (const f of document.querySelectorAll('iframe')) {
      try { const d = f.contentDocument || (f as any).contentWindow?.document; if (d?.body?.innerText) texts.push(d.body.innerText); } catch {}
    }
    return texts;
  });

  const combined = allText.join('\n');
  if (/暂无数据|没有评论|暂无评论/.test(combined) && !combined.includes('评论管理')) return [];

  // 收集所有文本行，去掉侧边栏/导航噪音
  const skipWords = new Set([
    '首页', '内容管理', '互动管理', '评论', '弹幕', '私信', '直播',
    '收入与服务', '带货中心', '数据中心', '设置', '通知中心',
    '视频号', '申请认证', '视频', '图文', '音乐', '音频', '草稿箱', '主页', '活动',
    '全部视频', '全部图文', '评论管理',
  ]);

  const lines = allText.flatMap(t => t.split('\n').map(l => l.trim())).filter(l => l.length > 1);
  const results: Array<{ commenter: string; content: string; time: string; likes: number }> = [];

  const knownNoise = /^(首页|内容管理|互动管理|评论|弹幕|私信|直播|收入与服务|带货中心|数据中心|设置|通知中心|视频号|申请认证|视频|图文|音乐|音频|草稿箱|主页|活动|全部视频|全部图文|评论管理|关于腾讯|© 1998|视频号助手)$/;

  for (const l of lines) {
    if (knownNoise.test(l)) continue;
    if (/^\d{4}\/\d{2}\/\d{2}/.test(l)) continue;   // 日期
    if (/^\d+$/.test(l) && parseInt(l) < 9999) continue; // 纯数字（评论数）
    if (/^共\d+个$/.test(l)) continue;
    if (l.includes('·') || l.startsWith('©')) continue;
    if (l.length <= 10) continue; // 跳过视频标题等短文本

    results.push({ commenter: '视频号用户', content: l, time: '', likes: 0 });
  }

  return results;
}

// ── 清理 ──

export async function closeBrowser(): Promise<void> {
  if (redContext) {
    try { await redContext.close(); } catch {}
    redContext = null;
  }
  redBrowser = null;
  if (browser?.isConnected()) {
    try { await browser.close(); } catch {}
    browser = null;
  }
}
