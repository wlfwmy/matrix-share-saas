/**
 * Mock 社交媒体发布服务 — 开发模式用
 * 模拟各平台上传+发布延迟和返回值，无需真实 API Key 即可测试全链路
 */

export interface MockPublishResult {
  success: boolean;
  platformId?: string;
  error?: string;
}

export class MockSocialMediaService {
  private platformNames: Record<string, string> = {
    RED: '小红书',
    DOUYIN: '抖音',
    KUAISHOU: '快手',
    BILIBILI: 'B站',
    WECHAT: '微信视频号',
  };

  /**
   * 模拟发布流程：
   * 1. 上传临时素材（1.5s 延迟）
   * 2. 提交发布（1.5s 延迟）
   * 3. 90% 成功率，10% 模拟平台拦截
   */
  async mockPublish(
    platform: string,
    title: string,
    _watermarkText?: string
  ): Promise<MockPublishResult> {
    const name = this.platformNames[platform] || platform;

    console.log(`[Mock] 正在将视频上传至 ${name} 临时素材库...`);
    await sleep(1500);

    console.log(`[Mock] 视频上传完成，正在向 ${name} 提交发布申请...`);
    await sleep(1500);

    // 90% 成功率
    if (Math.random() > 0.1) {
      const mockId = `${platform.toLowerCase()}_${Math.random().toString(36).substring(2, 9)}`;
      console.log(`[Mock] ${name} 发布成功！platformId=${mockId}`);
      return { success: true, platformId: mockId };
    }

    const error = '内容包含敏感词，发布被平台系统拦截。';
    console.log(`[Mock] ${name} 发布失败: ${error}`);
    return { success: false, error };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
