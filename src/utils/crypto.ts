import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM 推荐 12 字节 IV
const KEY_LENGTH = 32; // AES-256 需要 32 字节密钥
const AUTH_TAG_LENGTH = 16;

// 启动时立即校验，配置缺失或不合规直接拒绝启动，绝不静默降级为默认密钥
const RAW_SECRET = process.env.TOKEN_ENCRYPT_KEY;
if (!RAW_SECRET) {
  throw new Error('TOKEN_ENCRYPT_KEY 未配置，服务拒绝启动');
}
if (RAW_SECRET.length < 32) {
  throw new Error('TOKEN_ENCRYPT_KEY 长度不足，至少需要 32 个字符');
}

// 用 scrypt 从原始密钥派生出严格 32 字节的密钥，
// 不依赖原始字符串本身按 UTF-8 编码后的字节数是否恰好等于 32
const SALT = 'matrix-share-saas-token-encrypt'; // 固定 salt：目的是保证派生出定长 key，不是防暴力破解
const ENCRYPT_KEY = crypto.scryptSync(RAW_SECRET, SALT, KEY_LENGTH);

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPT_KEY, iv);

  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // 格式: iv:authTag:ciphertext，全部 hex 编码
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decrypt(text: string): string {
  const parts = text.split(':');
  if (parts.length !== 3) {
    throw new Error('密文格式非法（可能是旧版 CBC 密文，需先执行迁移脚本）');
  }
  const [ivHex, authTagHex, encryptedHex] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encryptedText = Buffer.from(encryptedHex, 'hex');

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('认证标签长度非法，密文可能被篡改');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPT_KEY, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    // GCM 认证失败会在这里抛错——意味着密文被篡改或密钥不对，
    // 绝不能吞掉这个错误继续往下走
    throw new Error('Token 解密失败，数据可能已被篡改或密钥不匹配');
  }
}
