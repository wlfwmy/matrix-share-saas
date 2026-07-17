import { Request, Response } from 'express';
import axios from 'axios';
import { getRedis } from '../utils/redis';
import { encrypt } from '../utils/crypto';
import { WxCrypto } from '../utils/wxCrypto';

const redis = getRedis();
const wxCrypto = new WxCrypto();
const APP_DOMAIN = process.env.APP_DOMAIN || 'localhost:5173';
const APP_PROTOCOL = process.env.NODE_ENV === 'production' ? 'https' : 'http';
const redirect = (path: string) => `${APP_PROTOCOL}://${APP_DOMAIN}${path}`;

export const handleWxEvents = async (req: Request, res: Response) => {
  const { signature, timestamp, nonce, msg_signature } = req.query as Record<string, string>;
  const xmlBody = req.body;

  try {
    const outerObj = await WxCrypto.parseXml(xmlBody);
    const encryptData = outerObj.xml.Encrypt;

    if (!wxCrypto.verifySignature(msg_signature || signature, timestamp, nonce, encryptData)) {
      return res.status(403).send('Invalid Signature');
    }

    const decryptedXml = wxCrypto.decrypt(encryptData);
    const eventData = await WxCrypto.parseXml(decryptedXml);
    const infoType = eventData.xml.InfoType;

    if (infoType === 'component_verify_ticket') {
      const ticket = eventData.xml.ComponentVerifyTicket;
      await redis.set('wx:component_verify_ticket', ticket, 'EX', 43200);
    }

    return res.send('success');
  } catch (err: any) {
    return res.send('success');
  }
};

export const handleWxCallback = async (req: Request, res: Response) => {
  const { auth_code } = req.query as { auth_code: string };
  if (!auth_code) return res.redirect(redirect('/dashboard/channels?bind=error&msg=UserCancelled'));

  try {
    const ticket = await redis.get('wx:component_verify_ticket');
    if (!ticket) throw new Error('Ticket 未就绪');

    const componentTokenRes = await axios.post('https://api.weixin.qq.com/cgi-bin/component/api_component_token', {
      component_appid: process.env.WX_COMPONENT_APPID,
      component_appsecret: process.env.WX_COMPONENT_APPSECRET,
      component_verify_ticket: ticket,
    });
    const compAccessToken = componentTokenRes.data.component_access_token;

    const authInfoRes = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/component/api_query_auth?component_access_token=${compAccessToken}`,
      {
        component_appid: process.env.WX_COMPONENT_APPID,
        authorization_code: auth_code,
      }
    );

    const { authorizer_appid, authorizer_access_token, authorizer_refresh_token } =
      authInfoRes.data.authorization_info;

    const encAccess = encrypt(authorizer_access_token);
    const encRefresh = encrypt(authorizer_refresh_token);

    return res.redirect(redirect('/dashboard/channels?bind=success&platform=wechat'));
  } catch (err: any) {
    return res.redirect(
      redirect(`/dashboard/channels?bind=error&msg=${encodeURIComponent(err.message)}`)
    );
  }
};
