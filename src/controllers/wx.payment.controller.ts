import { Request, Response } from 'express';
import { prisma } from '../utils/prismaClient';

let payInstance: any = null;

function getPay() {
  if (payInstance) return payInstance;

  if (!process.env.WX_MCH_ID || process.env.WX_MCH_ID === 'your_wechat_mch_id_here') {
    if (process.env.NODE_ENV === 'production') {
      // 生产环境绝不允许静默降级为模拟支付，宁可直接报错暴露配置问题
      throw new Error('微信支付商户号未配置，生产环境禁止使用模拟支付');
    }
    console.warn('[微信支付] 跳过初始化: 未配置正式商户号（仅限开发环境）');
    return null;
  }

  const WxpPay = require('wechatpay-node-v3').default || require('wechatpay-node-v3');
  const privateKeyString = process.env.WX_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';

  payInstance = new WxpPay({
    appid: process.env.WX_COMPONENT_APPID!,
    mchid: process.env.WX_MCH_ID!,
    serial_no: process.env.WX_MCH_SERIAL_NO!,
    private_key: privateKeyString,
    // certs 需要配置微信支付平台证书（不是商户私钥），用于回调验签。
    // 建议使用 wechatpay-node-v3 的自动下载平台证书功能，不要留空对象。
    certs: {},
    apiv3_private_key: process.env.WX_APIV3_KEY!, // 解密回调密文必需
  });

  return payInstance;
}

const PLAN_CONFIG: Record<string, { price: number; credits: number; name: string }> = {
  gold: { price: 99.0, credits: 100, name: '黄金会员套餐' },
  diamond: { price: 299.0, credits: 500, name: '钻石会员套餐' },
};

/**
 * 创建微信支付订单
 * 要求：路由层必须挂 authenticate 中间件，req.userId 必须存在
 */
export const createWxPayment = async (req: Request, res: Response) => {
  const userId = (req as any).userId;
  if (!userId) {
    return res.status(401).json({ error: '未登录' });
  }

  const { planId } = req.body;
  const plan = PLAN_CONFIG[planId];
  if (!plan) return res.status(400).json({ error: '无效的套餐选择' });

  const outTradeNo = `wxorder_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  try {
    const pay = getPay();

    if (!pay) {
      // 仅开发环境可达（生产环境 getPay 内部会直接 throw）
      await prisma.order.create({
        data: { id: outTradeNo, userId, planId, amount: plan.price, payChannel: 'WECHAT', status: 'PENDING' },
      });
      console.log(`[微信支付-模拟] ${outTradeNo} ¥${plan.price}`);
      return res.json({
        success: true,
        codeUrl: `weixin://wxpay/bizpayurl?pr=mock_${outTradeNo}`,
        outTradeNo,
      });
    }

    // 先落库再下单，保证回调到达时有订单记录可核对
    await prisma.order.create({
      data: { id: outTradeNo, userId, planId, amount: plan.price, payChannel: 'WECHAT', status: 'PENDING' },
    });

    const result = await pay.transactions_native({
      description: `MatrixSaaS-${plan.name}`,
      out_trade_no: outTradeNo,
      notify_url: process.env.WX_PAY_NOTIFY_URL!,
      amount: { total: Math.round(plan.price * 100), currency: 'CNY' },
    });

    return res.json({ success: true, codeUrl: result.code_url, outTradeNo });
  } catch (error: any) {
    console.error('[微信支付] 创建订单失败:', error.message);
    return res.status(500).json({ error: '微信支付下单失败' });
  }
};

/**
 * 微信支付异步通知回调
 * 路由层不加 authenticate（微信服务器调用，不带登录态），安全性完全依赖验签+解密
 */
export const handleWxPayNotify = async (req: Request, res: Response) => {
  try {
    const pay = getPay();
    if (!pay) {
      console.error('[微信支付回调] 收到通知但支付实例未初始化');
      return res.status(500).json({ code: 'FAIL', message: '服务未就绪' });
    }

    // 1. 验证微信支付平台签名（使用 express.json verify 回调保存的原始 body）
    const rawBody = (req as any).rawBody;
    if (!rawBody) {
      console.error('[微信支付回调] 无法获取原始请求体，请确认 express.json() 已配置 verify 回调');
      return res.status(500).json({ code: 'FAIL', message: '服务配置错误' });
    }
    const isValid = pay.verifySign({
      timestamp: req.headers['wechatpay-timestamp'],
      nonce: req.headers['wechatpay-nonce'],
      body: rawBody,
      serial: req.headers['wechatpay-serial'],
      signature: req.headers['wechatpay-signature'],
    });
    if (!isValid) {
      console.warn('[微信支付回调] 验签失败，可能是伪造请求');
      return res.status(400).json({ code: 'FAIL', message: '签名验证失败' });
    }

    // 2. 解密 resource 字段拿到明文订单信息（AEAD_AES_256_GCM）
    const resource = req.body.resource;
    const decrypted = pay.decipher_gcm(
      resource.ciphertext,
      resource.associated_data,
      resource.nonce,
      process.env.WX_APIV3_KEY!,
    );
    const payload = JSON.parse(decrypted);

    if (payload.trade_state !== 'SUCCESS') {
      return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
    }

    const orderId = payload.out_trade_no;
    const notifiedAmount = payload.amount?.total; // 单位: 分

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      console.error(`[微信支付回调] 找不到订单 ${orderId}`);
      return res.status(400).json({ code: 'FAIL', message: '订单不存在' });
    }

    // 金额核对（数据库存的是元，转成分比较）
    if (Math.round(Number(order.amount) * 100) !== notifiedAmount) {
      console.error(`[微信支付回调] 金额不符 订单=${order.amount}元 回调=${notifiedAmount}分`);
      return res.status(400).json({ code: 'FAIL', message: '金额不符' });
    }

    if (order.status === 'PAID') {
      // 已处理过，幂等直接返回成功
      return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
    }

    // Order 表没有 credits 字段，从套餐配置反查
    const plan = PLAN_CONFIG[order.planId];
    if (!plan) {
      console.error(`[微信支付回调] 订单 ${orderId} 对应的 planId=${order.planId} 找不到套餐配置`);
      return res.status(500).json({ code: 'FAIL', message: '套餐配置异常' });
    }

    await prisma.$transaction(async (tx) => {
      const updated = await tx.order.updateMany({
        where: { id: orderId, status: 'PENDING' },
        data: { status: 'PAID', payTime: new Date() },
      });
      if (updated.count === 0) return; // 并发下已被处理
      await tx.user.update({
        where: { id: order.userId },
        data: { credits: { increment: plan.credits } },
      });
    });

    console.log(`[微信支付回调] 订单 ${orderId} 处理完成，已为用户 ${order.userId} 加 ${plan.credits} credits`);
    return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
  } catch (error: any) {
    console.error('[微信支付回调] 处理异常:', error.message);
    // 返回非 SUCCESS，微信会按其策略重试通知
    return res.status(500).json({ code: 'FAIL', message: '处理异常' });
  }
};
