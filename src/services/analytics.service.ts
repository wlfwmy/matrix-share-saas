/**
 * 数据统计服务 — 聚合各平台数据，用于前端看板折线图
 * 按 userId + accountId + date + platform 维度记录每日数据
 */

import { prisma } from '../utils/prismaClient';

const BUSINESS_TZ_OFFSET_HOURS = 8; // Asia/Shanghai

function getBusinessDateStart(): Date {
  const now = new Date();
  const shifted = new Date(now.getTime() + BUSINESS_TZ_OFFSET_HOURS * 3600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - BUSINESS_TZ_OFFSET_HOURS * 3600_000);
}

function sanitize(n: number | undefined, fieldName: string): number {
  const v = n ?? 0;
  if (!Number.isFinite(v) || v < 0) {
    console.warn(`[AnalyticsService] 异常数值 ${fieldName}=${v}，已归零处理`);
    return 0;
  }
  return v;
}

export class AnalyticsService {
  /**
   * 覆盖式写入（定时轮询平台当日累计总量时使用）
   */
  async setMetrics(
    userId: string,
    accountId: string,
    platform: string,
    data: { views: number; likes: number; comments: number; shares: number },
  ) {
    const date = getBusinessDateStart();
    const now = new Date();

    const payload = {
      views: sanitize(data.views, 'views'),
      likes: sanitize(data.likes, 'likes'),
      comments: sanitize(data.comments, 'comments'),
      shares: sanitize(data.shares, 'shares'),
    };

    try {
      await prisma.dailyAnalytics.upsert({
        where: { userId_accountId_date_platform: { userId, accountId, date, platform } },
        update: { ...payload, syncedAt: now },
        create: { userId, accountId, platform, date, ...payload, syncedAt: now },
      });
    } catch (err) {
      console.error(`[AnalyticsService] setMetrics 失败 user=${userId} account=${accountId} platform=${platform}`, err);
    }
  }

  /**
   * 增量写入（Webhook 推送单条互动事件时使用）
   * eventId 用于幂等去重，防止平台重发导致重复计数
   */
  async recordMetrics(
    userId: string,
    accountId: string,
    platform: string,
    increment: { views?: number; likes?: number; comments?: number; shares?: number },
    eventId: string,
  ) {
    const date = getBusinessDateStart();

    try {
      await prisma.webhookEvent.create({ data: { eventId, platform } });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return;
      }
      console.error(`[AnalyticsService] webhook 去重检查失败 eventId=${eventId}`, err);
      return;
    }

    const payload = {
      views: sanitize(increment.views, 'views'),
      likes: sanitize(increment.likes, 'likes'),
      comments: sanitize(increment.comments, 'comments'),
      shares: sanitize(increment.shares, 'shares'),
    };

    try {
      await prisma.dailyAnalytics.upsert({
        where: { userId_accountId_date_platform: { userId, accountId, date, platform } },
        update: {
          views: { increment: payload.views },
          likes: { increment: payload.likes },
          comments: { increment: payload.comments },
          shares: { increment: payload.shares },
        },
        create: { userId, accountId, platform, date, ...payload },
      });
    } catch (err) {
      console.error(`[AnalyticsService] recordMetrics 失败 user=${userId} account=${accountId} platform=${platform}`, err);
    }
  }

  /**
   * 查询某个用户最近 N 天的数据趋势
   */
  async getTrend(userId: string, days: number = 7, accountId?: string) {
    const start = new Date(getBusinessDateStart().getTime() - days * 86400_000);

    return prisma.dailyAnalytics.findMany({
      where: {
        userId,
        ...(accountId ? { accountId } : {}),
        date: { gte: start },
      },
      orderBy: { date: 'asc' },
    });
  }

  /** 保存/更新单篇内容数据 */
  async setContentItem(
    userId: string, platform: string, externalId: string,
    data: { title: string; publishDate?: string | null; views: number; likes: number; comments: number; shares: number; collects: number },
  ) {
    await prisma.contentItem.upsert({
      where: { platform_externalId: { platform, externalId } },
      update: { userId, title: data.title, publishDate: data.publishDate ? new Date(data.publishDate) : null, views: data.views, likes: data.likes, comments: data.comments, shares: data.shares, collects: data.collects },
      create: { userId, platform, externalId, title: data.title, publishDate: data.publishDate ? new Date(data.publishDate) : null, views: data.views, likes: data.likes, comments: data.comments, shares: data.shares, collects: data.collects },
    });
  }

  /** 查询某个平台的内容列表 */
  async getContentItems(userId: string, platform: string) {
    return prisma.contentItem.findMany({
      where: { userId, platform },
      orderBy: { publishDate: 'desc' },
    });
  }
}
