import { Request, Response } from 'express';

let payInstance: any = null;

function getPay() {
  if (payInstance) return payInstance;
  if (!process.env.WX_MCH_ID || process.env.WX_MCH_ID === 'your_wechat_mch_id_here') {
    console.warn('[微信支付] 跳过初始化: 未配置正式商户号');
    return null;
  }
  const WxpPay = require('wechatpay-node-v3').default || require('wechatpay-node-v3');
  const privateKeyString = process.env.WX_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
  payInstance = new WxpPay({
    appid: process.env.WX_COMPONENT_APPID!,
    mchid: process.env.WX_MCH_ID!,
    serial_no: process.env.WX_MCH_SERIAL_NO!,
    private_key: privateKeyString,
    certs: {},
  });
  return payInstance;
}

const PLAN_CONFIG: Record<string, { price: number; credits: number; name: string }> = {
  'gold': { price: 99.00, credits: 100, name: '黄金会员套餐' },
  'diamond': { price: 299.00, credits: 500, name: '钻石会员套餐' },
};

export const createWxPayment = async (req: Request, res: Response) => {
  const { planId } = req.body;
  const userId = (req as any).userId || 'user_123456';

  const plan = PLAN_CONFIG[planId];
  if (!plan) return res.status(400).json({ error: '无效的套餐选择' });

  const pay = getPay();
  if (!pay) {
    // 开发模式：返回模拟二维码
    const outTradeNo = `wxorder_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    console.log(`[微信支付-模拟] ${outTradeNo} ¥${plan.price}`);
    return res.json({
      success: true,
      codeUrl: `weixin://wxpay/bizpayurl?pr=mock_${outTradeNo}`,
      outTradeNo,
    });
  }

  const outTradeNo = `wxorder_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  try {
    const result = await pay.transactions_native({
      description: `MatrixSaaS-${plan.name}`,
      out_trade_no: outTradeNo,
      notify_url: process.env.WX_PAY_NOTIFY_URL!,
      amount: {
        total: Math.round(plan.price * 100),
        currency: 'CNY',
      },
    });

    return res.json({ success: true, codeUrl: result.code_url, outTradeNo });
  } catch (error: any) {
    return res.status(500).json({ error: '微信支付下单失败' });
  }
};

export const handleWxPayNotify = async (req: Request, res: Response) => {
  return res.status(200).json({ code: 'SUCCESS', message: 'OK' });
};
