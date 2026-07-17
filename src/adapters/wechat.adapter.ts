import axios from 'axios';
import { getRedis } from '../utils/redis';
import { PlatformOAuthAdapter, PlatformTokenResult } from './platformAdapter.interface';
import { WxCrypto } from '../utils/wxCrypto';

const redis = getRedis();
const wxCrypto = new WxCrypto();

export class WeChatOAuthAdapter implements PlatformOAuthAdapter {
  readonly platform = 'WECHAT';

  async getAuthUrl(userId: string): Promise<string> {
    const compAccessToken = await this.getComponentAccessToken();

    const preAuthRes = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/component/api_create_preauthcode?component_access_token=${compAccessToken}`,
      { component_appid: process.env.WX_COMPONENT_APPID }
    );
    const preAuthCode = preAuthRes.data.pre_auth_code;

    const state = `wechat_${userId}_${Math.random().toString(36).substring(2, 10)}`;
    await redis.set(`oauth:state:${state}`, userId, 'EX', 600);

    const redirectUri = encodeURIComponent(process.env.WX_COMPONENT_REDIRECT_URI!);
    return `https://mp.weixin.qq.com/cgi-bin/componentloginpage?component_appid=${process.env.WX_COMPONENT_APPID}&pre_auth_code=${preAuthCode}&redirect_uri=${redirectUri}&auth_type=2&state=${state}`;
  }

  async handleCallback(query: Record<string, string>): Promise<PlatformTokenResult> {
    const { auth_code, state } = query;
    if (!auth_code || !state) throw new Error('缺少 auth_code 或 state 参数');

    const boundUserId = await redis.get(`oauth:state:${state}`);
    if (!boundUserId) throw new Error('state 无效或已过期');
    await redis.del(`oauth:state:${state}`);

    const compAccessToken = await this.getComponentAccessToken();

    const authInfoRes = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/component/api_query_auth?component_access_token=${compAccessToken}`,
      {
        component_appid: process.env.WX_COMPONENT_APPID,
        authorization_code: auth_code,
      }
    );

    const { authorizer_appid, authorizer_access_token, authorizer_refresh_token, expires_in } =
      authInfoRes.data.authorization_info;

    const infoRes = await axios.get(
      `https://api.weixin.qq.com/cgi-bin/component/api_get_authorizer_info?component_access_token=${compAccessToken}`,
      {
        params: {
          component_appid: process.env.WX_COMPONENT_APPID,
          authorizer_appid,
        },
      }
    );
    const nickname = infoRes.data.authorizer_info?.nick_name || authorizer_appid;
    const avatar = infoRes.data.authorizer_info?.head_img;

    return {
      userId: boundUserId,
      openid: authorizer_appid,
      nickname,
      avatar,
      accessToken: authorizer_access_token,
      refreshToken: authorizer_refresh_token,
      expiresIn: expires_in || 7200,
    };
  }

  async refreshToken(refreshToken: string) {
    const compAccessToken = await this.getComponentAccessToken();
    const res = await axios.post(
      `https://api.weixin.qq.com/cgi-bin/component/api_authorizer_token?component_access_token=${compAccessToken}`,
      {
        component_appid: process.env.WX_COMPONENT_APPID,
        authorizer_refresh_token: refreshToken,
      }
    );
    return {
      accessToken: res.data.authorizer_access_token,
      refreshToken: res.data.authorizer_refresh_token,
      expiresIn: res.data.expires_in,
    };
  }

  private async getComponentAccessToken(): Promise<string> {
    const cached = await redis.get('wx:component_access_token');
    if (cached) return cached;

    const ticket = await redis.get('wx:component_verify_ticket');
    if (!ticket) throw new Error('component_verify_ticket 未就绪');

    const res = await axios.post('https://api.weixin.qq.com/cgi-bin/component/api_component_token', {
      component_appid: process.env.WX_COMPONENT_APPID,
      component_appsecret: process.env.WX_COMPONENT_APPSECRET,
      component_verify_ticket: ticket,
    });

    const token = res.data.component_access_token;
    await redis.set('wx:component_access_token', token, 'EX', 7200 - 300);
    return token;
  }
}
