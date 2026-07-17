import crypto from 'crypto';
import xml2js from 'xml2js';

export class WxCrypto {
  private token: string;
  private encodingAESKey: string;
  private appId: string;
  private aesKey: Buffer;
  private iv: Buffer;

  constructor() {
    this.token = process.env.WX_COMPONENT_TOKEN || '';
    this.encodingAESKey = process.env.WX_COMPONENT_AES_KEY || '';
    this.appId = process.env.WX_COMPONENT_APPID || '';
    this.aesKey = Buffer.from(this.encodingAESKey + '=', 'base64');
    this.iv = this.aesKey.slice(0, 16);
  }

  public verifySignature(signature: string, timestamp: string, nonce: string, encryptXml: string): boolean {
    const rawStr = [this.token, timestamp, nonce, encryptXml].sort().join('');
    const sha1 = crypto.createHash('sha1').update(rawStr).digest('hex');
    return sha1 === signature;
  }

  public decrypt(encryptXml: string): string {
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.aesKey, this.iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([decipher.update(Buffer.from(encryptXml, 'base64')), decipher.final()]);
    let pad = decrypted[decrypted.length - 1];
    if (pad < 1 || pad > 32) pad = 0;
    decrypted = decrypted.slice(0, decrypted.length - pad);

    const contentLen = decrypted.readUInt32BE(16);
    const msg = decrypted.slice(20, 20 + contentLen).toString('utf-8');
    const fromAppId = decrypted.slice(20 + contentLen).toString('utf-8');

    if (fromAppId !== this.appId) {
      throw new Error('AppID 校验不匹配，解密失败！');
    }
    return msg;
  }

  public static parseXml(xmlStr: string): Promise<any> {
    return new Promise((resolve, reject) => {
      xml2js.parseString(xmlStr, { explicitArray: false, ignoreAttrs: true }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }
}
