// @ts-nocheck — page.evaluate 在浏览器环境运行，Node.js TS 不认识 document

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import net from 'net';

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
// 使用系统 Edge 浏览器，通过 CDP 连接。
// 登录态保存在 edge-profile/ 目录，服务重启后可复用。

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

let redBrowser: Browser | null = null;
let redContext: BrowserContext | null = null;
let redLoginResolve: (() => void) | null = null;
let edgeProcess: ChildProcess | null = null;

export type RedLoginStatus = 'unknown' | 'need_login' | 'ok' | 'expired';

/** 查找可用端口 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** 等待 CDP 端口就绪 */
async function waitForCDP(port: number, timeout = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const sock = new net.Socket();
      await new Promise<void>((resolve, reject) => {
        sock.connect(port, '127.0.0.1', resolve);
        sock.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 3000);
      });
      sock.destroy();
      return;
    } catch {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  throw new Error(`CDP 端口 ${port} 连接超时`);
}

/** 启动 Edge 浏览器实例并返回 CDP 连接 */
async function launchEdge(): Promise<Browser> {
  const port = await findFreePort();
  const userDataDir = RED_PROFILE_DIR;

  // 确保 profile 目录存在
  const fs = await import('fs');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  edgeProcess = spawn(EDGE_PATH, [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-extensions',
    '--disable-default-apps',
    '--disable-sync',
    '--no-default-browser-check',
  ], {
    stdio: 'ignore',
    detached: false,
  });

  edgeProcess.on('exit', () => {
    edgeProcess = null;
  });

  await waitForCDP(port);
  const b = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return b;
}

/** 获取小红书常驻浏览器 Page */
export async function getRedPage(): Promise<Page> {
  if (redBrowser?.isConnected() && redContext) {
    const pages = redContext.pages();
    return pages[0] || await redContext.newPage();
  }

  // 启动常驻浏览器（使用系统 Edge）
  redBrowser = await launchEdge();
  // 使用已有的默认上下文（profile 中的 localStorage 保留在其中）
  const existingCtx = redBrowser.contexts();
  redContext = existingCtx[0] || await redBrowser.newContext({ locale: 'zh-CN' });

  redBrowser.on('disconnected', () => {
    redBrowser = null;
    redContext = null;
    // 子进程已经随浏览器退出而退出
  });

  const page = await redContext.newPage();
  await page.addInitScript(`Object.defineProperty(navigator, 'webdriver', { get: () => false });`);

  // 导航到创作者中心
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
  } catch {
    return 'unknown';
  }
}

/**
 * 等待用户登录（在已打开的浏览器中操作）
 * 返回 Promise，用户登录成功后 resolve
 */
export async function waitForRedLogin(): Promise<void> {
  const page = await getRedPage();
  const loggedIn = await page.evaluate(() => document.body.innerText.includes('发布笔记')).catch(() => false);
  if (loggedIn) return;

  // 确保在登录页
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

// ── 清理 ──

export async function closeBrowser(): Promise<void> {
  for (const b of [redBrowser, browser]) {
    if (b?.isConnected()) try { await b.close(); } catch {}
  }
  if (edgeProcess && !edgeProcess.killed) {
    try { edgeProcess.kill(); } catch {}
  }
  redBrowser = null; redContext = null; browser = null; edgeProcess = null;
}
