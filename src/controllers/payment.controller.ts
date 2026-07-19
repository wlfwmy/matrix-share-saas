import { Request, Response } from 'express';
import { AlipaySdk } from 'alipay-sdk';
import { prisma } from '../utils/prismaClient';

const alipaySdk = new AlipaySdk({
  appId: process.env.ALIPAY_APP_ID!,
  privateKey: process.env.ALIPAY_PRIVATE_KEY!,
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
  gateway: process.env.ALIPAY_GATEWAY,
  signType: 'RSA2',
});

const PLAN_CONFIG: Record<string, { price: number; credits: number; name: string }> = {
  gold: { price: 99.0, credits: 100, name: '黄金会员套餐' },
  diamond: { price: 299.0, credits: 500, name: '钻石会员套餐' },
};

export const createPayment = async (req: Request, res: Response) => {
  const { planId } = req.body;
  const userId = (req as any).userId;

  if (!userId) {
    return res.status(401).json({ error: '请先登录' });
  }

  const plan = PLAN_CONFIG[planId];
  if (!plan) return res.status(400).json({ error: '无效的套餐选择' });

  // Order.id 本身就是订单号（也是传给支付宝的 out_trade_no），schema 里没有
  // 单独的 outTradeNo 字段
  const orderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  try {
    // 关键修复：调支付宝下单之前先落库。schema 里 Order 没有 credits 字段，
    // 所以这里不存 credits，结算时按 planId 反查 PLAN_CONFIG 就行——
    // 前提是 PLAN_CONFIG 的套餐价格/额度以后不能悄悄改动历史含义，
    // 如果套餐权益可能变化，建议后续把 planId 对应的价格和 credits
    // 也一起存进订单快照字段，避免套餐配置改了导致老订单结算对不上。
    await prisma.order.create({
      data: {
        id: orderId,
        userId,
        planId,
        amount: plan.price,
        payChannel: 'ALIPAY',
        status: 'PENDING',
      },
    });

    const payUrl = await alipaySdk.pageExec('alipay.trade.page.pay', {
      bizContent: {
        out_trade_no: orderId,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: plan.price.toFixed(2),
        subject: `MatrixSaaS-${plan.name}`,
        timeout_express: '15m',
      },
      returnUrl: process.env.ALIPAY_RETURN_URL,
      notifyUrl: process.env.ALIPAY_NOTIFY_URL,
    });

    return res.json({ success: true, payUrl, orderId });
  } catch (error: any) {
    console.error('[支付宝下单失败]', error.message);
    return res.status(500).json({ error: '创建支付订单失败' });
  }
};

export const handleAlipayNotify = async (req: Request, res: Response) => {
  const params = req.body;

  try {
    const isValid = alipaySdk.checkNotifySign(params);
    if (!isValid) {
      console.warn('[支付宝回调] 签名校验失败', params);
      return res.status(400).send('fail');
    }

    const tradeStatus = params.trade_status;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return res.send('success');
    }

    const orderId = params.out_trade_no;
    const notifiedAmount = parseFloat(params.total_amount);

    // 第一层幂等：按支付宝这条通知本身的 notify_id 去重。
    // 支付宝在网络超时等情况下会用同一个 notify_id 重推，这层只挡
    // "完全相同的这条通知被重复处理"，业务层面真正的幂等还是要看
    // 下面订单状态那层。
    const eventId = params.notify_id;
    if (eventId) {
      try {
        await prisma.webhookEvent.create({
          data: { eventId, platform: 'ALIPAY' },
        });
      } catch {
        // 唯一约束冲突 = 这条通知已经处理过，直接确认成功
        return res.send('success');
      }
    }

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      console.error('[支付宝回调] 找不到对应订单', orderId);
      return res.status(400).send('fail');
    }

    // 第二层幂等：订单本身已经是 PAID，直接返回成功
    if (order.status === 'PAID') {
      return res.send('success');
    }

    // 金额核对：只信自己数据库里创建订单时记录的金额
    if (Math.abs(order.amount - notifiedAmount) > 0.01) {
      console.error(
        `[支付宝回调] 金额不一致 orderId=${orderId} 期望=${order.amount} 实际=${notifiedAmount}`
      );
      return res.status(400).send('fail');
    }

    const plan = PLAN_CONFIG[order.planId];
    if (!plan) {
      // 理论上不该发生（下单时已经校验过 planId），但万一套餐配置后续被
      // 下架/改动，这里要能兜住而不是让 credits 加成 NaN
      console.error(`[支付宝回调] 订单 ${orderId} 对应的 planId=${order.planId} 找不到套餐配置`);
      return res.status(500).send('fail');
    }

    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderId },
        data: { status: 'PAID', payTime: new Date() },
      }),
      prisma.user.update({
        where: { id: order.userId },
        data: { credits: { increment: plan.credits } },
      }),
    ]);

    console.log(`[支付宝回调] 订单 ${orderId} 支付成功，已加 ${plan.credits} credits`);
    return res.send('success');
  } catch (error: any) {
    console.error('[支付宝回调] 处理异常', error.message);
    return res.status(500).send('fail');
  }
};

export const queryOrderStatus = async (req: Request, res: Response) => {
  const { orderId } = req.query as { orderId: string };
  if (!orderId) return res.status(400).json({ error: '订单号不能为空' });

  try {
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(404).json({ error: '订单不存在' });
    return res.json({ status: order.status, payTime: order.payTime });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
