import { Request, Response } from 'express';
import { getRedis } from '../utils/redis';
import { WxCrypto } from '../utils/wxCrypto';

const redis = getRedis();
const wxCrypto = new WxCrypto();

/**
 * 微信开放平台第三方平台事件推送处理（component_verify_ticket 等）
 *
 * 注意：账号授权绑定流程走的是 oauth.router.controller.ts 的
 * getAuthUrl / handleCallback（配合 adapters/wechat.adapter.ts），
 * 那一套有完整的 state 校验 + 数据库落库逻辑。
 *
 * 本文件原先还有一个 handleWxCallback 函数，是重构前的旧实现，
 * 没有 state 校验、也没有把账号写入数据库，属于废弃代码，已删除，
 * 避免被误接路由造成安全隐患（详见迁移说明）。
 */
export const handleWxEvents = async (req: Request, res: Response) => {
  const { signature, timestamp, nonce, msg_signature } = req.query as Record<string, string>;
  const xmlBody = req.body;

  // 缺失关键校验参数直接拒绝，不依赖内部函数兜底
  if (!timestamp || !nonce || (!msg_signature && !signature)) {
    console.warn('[微信事件] 缺少必要的签名校验参数');
    return res.status(403).send('Invalid Request');
  }

  try {
    const outerObj = await WxCrypto.parseXml(xmlBody);
    const encryptData = outerObj.xml.Encrypt;

    if (!wxCrypto.verifySignature(msg_signature || signature, timestamp, nonce, encryptData)) {
      console.warn('[微信事件] 签名校验失败');
      return res.status(403).send('Invalid Signature');
    }

    const decryptedXml = wxCrypto.decrypt(encryptData);
    const eventData = await WxCrypto.parseXml(decryptedXml);
    const infoType = eventData.xml.InfoType;

    if (infoType === 'component_verify_ticket') {
      const ticket = eventData.xml.ComponentVerifyTicket;
      await redis.set('wx:component_verify_ticket', ticket, 'EX', 43200);
      console.log('[微信事件] component_verify_ticket 已更新');
    } else {
      console.log(`[微信事件] 收到未特殊处理的事件类型: ${infoType}`);
    }

    return res.send('success');
  } catch (err: any) {
    // 微信推荐无论处理是否成功都尽量返回 success，避免微信不断重推；
    // 但异常本身要打日志，方便发现潜在的探测/攻击尝试
    console.error('[微信事件] 处理异常:', err.message);
    return res.send('success');
  }
};
