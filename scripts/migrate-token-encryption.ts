/**
 * migrate-token-encryption.ts
 *
 * 一次性迁移脚本：把数据库里所有账号的 token 从旧的 AES-256-CBC 格式
 * 重新加密为新的 AES-256-GCM 格式。
 *
 * 使用方式：
 *   1. 先部署这个脚本，但 crypto.ts 暂时还没切换成新版（先跑迁移，再切代码）
 *      或者：
 *      在同一次部署里，把旧版 decrypt 逻辑复制一份到本文件内（见下方 legacyDecrypt），
 *      避免脚本运行时依赖的 crypto.ts 已经是新版导致读不出旧数据。
 *   2. npx tsx scripts/migrate-token-encryption.ts
 *   3. 脚本是幂等的：已经是新格式（含 authTag 段，split(':') 长度为 3）的记录会被跳过，
 *      可以放心重复执行、中途失败后重跑。
 *
 * 强烈建议：
 *   - 执行前手动备份数据库（或者至少备份 Account 表）
 *   - 先在测试环境跑一遍，确认 encrypted 字段格式符合预期
 *   - 生产环境执行时选择低峰期，脚本本身很快，但操作数据库总要谨慎
 */

import crypto from 'crypto';
import { prisma } from '../src/utils/prismaClient';

// ── 旧版 CBC 解密逻辑（从原 crypto.ts 复制，不依赖新版 crypto.ts）──
const OLD_ALGORITHM = 'aes-256-cbc';
const OLD_ENCRYPT_KEY = process.env.TOKEN_ENCRYPT_KEY || 'your-32-character-secure-key-!!!';

function legacyDecrypt(text: string): string {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const decipher = crypto.createDecipheriv(OLD_ALGORITHM, Buffer.from(OLD_ENCRYPT_KEY), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

// ── 新版 GCM 加密逻辑（从新 crypto.ts 复制一份，避免脚本对模块加载时机敏感）──
const NEW_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const SALT = 'matrix-share-saas-token-encrypt';

const RAW_SECRET = process.env.TOKEN_ENCRYPT_KEY;
if (!RAW_SECRET) {
  throw new Error('TOKEN_ENCRYPT_KEY 未配置，无法执行迁移');
}
const NEW_ENCRYPT_KEY = crypto.scryptSync(RAW_SECRET, SALT, KEY_LENGTH);

function newEncrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(NEW_ALGORITHM, NEW_ENCRYPT_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

// 判断是否已经是新格式：新格式是 iv:authTag:ciphertext 共 3 段，旧格式是 iv:ciphertext 共 2 段
function isNewFormat(cipherText: string): boolean {
  return cipherText.split(':').length === 3;
}

async function migrateField(
  accountId: string,
  fieldName: 'encryptedAccess' | 'encryptedRefresh',
  oldValue: string,
): Promise<string | null> {
  if (isNewFormat(oldValue)) {
    return null; // 已经是新格式，跳过
  }
  try {
    const plain = legacyDecrypt(oldValue);
    return newEncrypt(plain);
  } catch (err: any) {
    console.error(`[迁移失败] account=${accountId} field=${fieldName}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('[Token 迁移] 开始扫描账号...');

  const accounts = await prisma.account.findMany();
  console.log(`[Token 迁移] 共 ${accounts.length} 个账号`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const acc of accounts) {
    const newAccess = await migrateField(acc.id, 'encryptedAccess', acc.encryptedAccess);
    const newRefresh = await migrateField(acc.id, 'encryptedRefresh', acc.encryptedRefresh);

    // 两个字段都已是新格式（返回 null 且原值本身是新格式）时跳过；
    // 只要有一个成功迁移就要写库
    const accessAlreadyNew = isNewFormat(acc.encryptedAccess);
    const refreshAlreadyNew = isNewFormat(acc.encryptedRefresh);

    if (accessAlreadyNew && refreshAlreadyNew) {
      skipped++;
      continue;
    }

    // 迁移失败的字段保持原值不动（下次重跑时会再次尝试），
    // 避免部分失败时把数据写坏
    const updateData: Record<string, string> = {};
    if (newAccess) updateData.encryptedAccess = newAccess;
    if (newRefresh) updateData.encryptedRefresh = newRefresh;

    const accessNeedsMigration = !accessAlreadyNew;
    const refreshNeedsMigration = !refreshAlreadyNew;
    const accessOk = !accessNeedsMigration || !!newAccess;
    const refreshOk = !refreshNeedsMigration || !!newRefresh;

    if (Object.keys(updateData).length > 0) {
      await prisma.account.update({ where: { id: acc.id }, data: updateData });
    }

    if (accessOk && refreshOk) {
      migrated++;
      console.log(`[Token 迁移] account=${acc.id} platform=${acc.platform} 迁移成功`);
    } else {
      failed++;
      console.error(`[Token 迁移] account=${acc.id} platform=${acc.platform} 部分或全部字段迁移失败，需人工排查`);
    }
  }

  console.log(`[Token 迁移] 完成。成功 ${migrated}，跳过（已是新格式）${skipped}，失败 ${failed}`);

  if (failed > 0) {
    console.warn('[Token 迁移] 存在失败记录，这些账号的 token 解密可能会在下次续期/发布时报错，建议人工核查后引导用户重新授权。');
  }
}

main()
  .catch((err) => {
    console.error('[Token 迁移] 脚本异常终止:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
