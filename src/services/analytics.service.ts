/**
 * 数据统计服务 — 聚合各平台数据，用于前端看板折线图
 * 按 userId + accountId + date + platform 维度记录每日数据
 */

import { prisma } from '../utils/prismaClient';

// 统一使用业务时区，避免服务器部署时区不同导致日期错位
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
   * 覆盖式写入（定时轮询平台"当日累计总量"时使用）
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
      console.error(
        `[AnalyticsService] setMetrics 失败 user=${userId} account=${accountId} platform=${platform}`,
        err,
      );
      // 不向上抛出，避免一个账号失败中断整批定时任务
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
      // 幂等检查：同一事件不重复计数，利用唯一约束冲突判断是否已处理过
      await prisma.webhookEvent.create({ data: { eventId, platform } });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return; // 事件已处理过，直接跳过
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
      console.error(
        `[AnalyticsService] recordMetrics 失败 user=${userId} account=${accountId} platform=${platform}`,
        err,
      );
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

  /** 获取指定平台已入库的内容列表 */
  async getContentItems(userId: string, platform: string) {
    return prisma.contentItem.findMany({
      where: { userId, platform },
      orderBy: { publishDate: 'desc' },
      take: 50,
    });
  }
}

/**
 * 注意：setMetrics（覆盖式）和 recordMetrics（增量式）不要对同一个 platform 混用。
 * 有 Webhook 推送能力的平台只用 recordMetrics；只能轮询的平台（当前抖音/B站/快手）
 * 只用 setMetrics。混用会导致两条更新路径互相覆盖，数据不可预测。
 */
