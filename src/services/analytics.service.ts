/**
 * 数据统计服务 — 聚合各平台 Webhook 推送的数据
 * 按 userId + date + platform 维度记录每日数据，用于前端看板折线图
 */

import { prisma } from '../utils/prismaClient';

export class AnalyticsService {
  /**
   * 累加当日数据指标
   */
  async recordMetrics(
    userId: string,
    platform: string,
    increment: { views?: number; likes?: number; comments?: number; shares?: number }
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.dailyAnalytics.upsert({
      where: {
        userId_date_platform: { userId, date: today, platform },
      },
      update: {
        views: { increment: increment.views ?? 0 },
        likes: { increment: increment.likes ?? 0 },
        comments: { increment: increment.comments ?? 0 },
        shares: { increment: increment.shares ?? 0 },
      },
      create: {
        userId,
        date: today,
        platform,
        views: increment.views ?? 0,
        likes: increment.likes ?? 0,
        comments: increment.comments ?? 0,
        shares: increment.shares ?? 0,
      },
    });
  }

  /**
   * 查询某个用户最近 N 天的数据趋势
   */
  async getTrend(userId: string, days: number = 7) {
    const start = new Date();
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);

    return prisma.dailyAnalytics.findMany({
      where: { userId, date: { gte: start } },
      orderBy: { date: 'asc' },
    });
  }
}
