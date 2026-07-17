import { Request, Response } from 'express';
import { AlipaySdk } from 'alipay-sdk';

const alipaySdk = new AlipaySdk({
  appId: process.env.ALIPAY_APP_ID!,
  privateKey: process.env.ALIPAY_PRIVATE_KEY!,
  alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY!,
  gateway: process.env.ALIPAY_GATEWAY,
  signType: 'RSA2',
});

const PLAN_CONFIG: Record<string, { price: number; credits: number; name: string }> = {
  'gold': { price: 99.00, credits: 100, name: '黄金会员套餐' },
  'diamond': { price: 299.00, credits: 500, name: '钻石会员套餐' },
};

export const createPayment = async (req: Request, res: Response) => {
  const { planId } = req.body;
  const userId = (req as any).userId || 'user_123456';

  const plan = PLAN_CONFIG[planId];
  if (!plan) return res.status(400).json({ error: '无效的套餐选择' });

  const outTradeNo = `order_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  try {
    const payUrl = await alipaySdk.pageExec('alipay.trade.page.pay', {
      bizContent: {
        out_trade_no: outTradeNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        total_amount: plan.price.toFixed(2),
        subject: `MatrixSaaS-${plan.name}`,
        timeout_express: '15m',
      },
      returnUrl: process.env.ALIPAY_RETURN_URL,
      notifyUrl: process.env.ALIPAY_NOTIFY_URL,
    });

    return res.json({ success: true, payUrl });
  } catch (error: any) {
    return res.status(500).json({ error: '创建支付订单失败' });
  }
};

export const handleAlipayNotify = async (req: Request, res: Response) => {
  const params = req.body;

  try {
    const isValid = alipaySdk.checkNotifySign(params);
    if (!isValid) return res.status(400).send('fail');

    const tradeStatus = params.trade_status;
    if (tradeStatus !== 'TRADE_SUCCESS' && tradeStatus !== 'TRADE_FINISHED') {
      return res.send('success');
    }

    const outTradeNo = params.out_trade_no;
    const totalAmount = parseFloat(params.total_amount);

    // 幂等校验：订单已支付则直接返回成功
    // const order = await prisma.order.findUnique({ where: { id: outTradeNo } });
    // if (order?.status === 'PAID') return res.send('success');

    return res.send('success');
  } catch (error: any) {
    return res.status(500).send('fail');
  }
};

export const queryOrderStatus = async (req: Request, res: Response) => {
  const { orderId } = req.query as { orderId: string };
  if (!orderId) return res.status(400).json({ error: '订单号不能为空' });
  try {
    return res.json({ status: 'PENDING' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
};
