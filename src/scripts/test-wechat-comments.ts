// @ts-nocheck
/**
 * 测试微信视频号评论提取
 * 运行：npx ts-node src/scripts/test-wechat-comments.ts
 */
import { getWeChatPage, extractWeChatComments, clickSidebarAny } from '../services/browserManager';

async function main() {
  console.log('连接浏览器...');
  const page = await getWeChatPage();
  console.log('当前页面 URL:', page.url());

  // 尝试直接导航到评论页
  await page.goto('https://channels.weixin.qq.com/comment', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 5000));

  let comments = await extractWeChatComments(page);
  console.log(`直接导航：提取到 ${comments.length} 条评论`);
  if (comments.length > 0) {
    console.log('示例:', JSON.stringify(comments.slice(0, 3), null, 2));
    return;
  }

  // fallback: 从首页导航
  await page.goto('https://channels.weixin.qq.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 8000));

  console.log('页面文字片段:', (await page.evaluate(() => document.body.innerText.slice(0, 500))).replace(/\n/g, '\\n'));
  console.log('---');

  await clickSidebarAny(page, ['评论管理', '评论']);
  await new Promise(r => setTimeout(r, 5000));

  console.log('侧边栏导航后 URL:', page.url());
  console.log('页面文字片段:', (await page.evaluate(() => document.body.innerText.slice(0, 500))).replace(/\n/g, '\\n'));

  comments = await extractWeChatComments(page);
  console.log(`侧边栏导航：提取到 ${comments.length} 条评论`);
  if (comments.length > 0) {
    console.log('示例:', JSON.stringify(comments.slice(0, 3), null, 2));
  }
}

main().catch(console.error);
