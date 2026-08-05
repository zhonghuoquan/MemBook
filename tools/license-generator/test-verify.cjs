/**
 * 快速验证：用 src/license/publicKey.ts 中的公钥校验生成器产出的激活码与签名。
 *
 * 用法：
 *   node tools/license-generator/test-verify.cjs <激活码> <签名> [机器码]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const publicKeyPath = path.resolve(__dirname, '..', '..', 'src', 'license', 'publicKey.ts');

function base64UrlToBuffer(input) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = Buffer.from(base64, 'base64').toString('binary');
  const bytes = Buffer.alloc(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractPublicKey() {
  const content = fs.readFileSync(publicKeyPath, 'utf8');
  const match = content.match(/export\s+const\s+LICENSE_PUBLIC_KEY\s*:\s*JsonWebKey\s*=\s*(\{[\s\S]*?\n\})/);
  if (!match) throw new Error('无法从 publicKey.ts 提取公钥');
  return JSON.parse(match[1]);
}

async function verify(code, signatureBase64, machineId) {
  const jwk = extractPublicKey();
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const payload = machineId ? `${code}:${machineId}` : code;
  const data = Buffer.from(payload, 'utf8');
  const signature = base64UrlToBuffer(signatureBase64);
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data);
}

async function main() {
  const [code, signature, machineId] = process.argv.slice(2);
  if (!code || !signature) {
    console.log('用法：node test-verify.cjs <激活码> <签名> [机器码]');
    process.exit(1);
  }
  const ok = await verify(code, signature, machineId);
  console.log(ok ? '✅ 签名校验通过' : '❌ 签名校验失败');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('验证出错：', err.message);
  process.exit(1);
});
