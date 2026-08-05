/**
 * MemBook — 激活码生成器密钥对生成脚本
 *
 * 运行方式：node tools/license-generator/generate-keypair.cjs
 *
 * 功能：
 * 1. 使用 Node.js crypto 生成 RSA-2048 密钥对（JWK 格式）
 * 2. 将公钥写入 src/license/publicKey.ts
 * 3. 将私钥嵌入 tools/license-generator/index.html，确保生成器打开即可用
 *
 * 注意：私钥仅应保存在本开发者工具目录，切勿随应用一起发布。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_KEY_PATH = path.join(PROJECT_ROOT, 'src', 'license', 'publicKey.ts');
const GENERATOR_HTML_PATH = path.join(PROJECT_ROOT, 'tools', 'license-generator', 'index.html');
const KEYS_FILE_PATH = path.join(PROJECT_ROOT, 'tools', 'license-generator', '.license-keys.json');
const PLACEHOLDER = '__DEFAULT_PRIVATE_KEY_JWK__';

function toBase64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function publicJwkToBase64Url(jwk) {
  return {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
  };
}

function writePublicKey(publicJwk) {
  const content = `/**
 * MemBook — 内置公钥（RSA JWK）
 *
 * 用于验证激活码签名。对应的私钥仅保存在授权生成器工具中。
 * 如需更换密钥对，请使用 tools/license-generator/index.html 重新生成并替换此文件。
 */

export const LICENSE_PUBLIC_KEY: JsonWebKey = ${JSON.stringify(publicJwkToBase64Url(publicJwk), null, 2)};
`;
  fs.writeFileSync(PUBLIC_KEY_PATH, content, 'utf8');
}

function embedPrivateKey(privateJwk) {
  if (!fs.existsSync(GENERATOR_HTML_PATH)) {
    throw new Error(`生成器 HTML 不存在：${GENERATOR_HTML_PATH}，请先创建模板。`);
  }
  let html = fs.readFileSync(GENERATOR_HTML_PATH, 'utf8');
  const json = JSON.stringify(privateJwk);
  if (html.includes(PLACEHOLDER)) {
    html = html.replace(PLACEHOLDER, json);
  } else {
    // 占位符已替换过，更新已有的 DEFAULT_PRIVATE_KEY_JWK 变量值
    html = html.replace(
      /const\s+DEFAULT_PRIVATE_KEY_JWK\s*=\s*\{[\s\S]*?\}\s*;/,
      `const DEFAULT_PRIVATE_KEY_JWK = ${json};`,
    );
  }
  fs.writeFileSync(GENERATOR_HTML_PATH, html, 'utf8');
}

function loadOrGenerateKeyPair() {
  if (fs.existsSync(KEYS_FILE_PATH)) {
    console.log('检测到已有密钥文件，复用现有密钥对（如需更换请删除 .license-keys.json 后重跑）。');
    const raw = fs.readFileSync(KEYS_FILE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (!data.publicKey || !data.privateKey) {
      throw new Error('密钥文件格式不正确');
    }
    return { publicKey: data.publicKey, privateKey: data.privateKey };
  }

  console.log('正在生成 RSA-2048 密钥对...');
  return new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      'rsa',
      {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'jwk' },
        privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
      },
      (err, publicKey, privateKey) => {
        if (err) {
          reject(err);
          return;
        }
        const data = { publicKey, privateKey, generatedAt: new Date().toISOString() };
        fs.writeFileSync(KEYS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
        resolve({ publicKey, privateKey });
      },
    );
  });
}

async function main() {
  const { publicKey, privateKey } = await loadOrGenerateKeyPair();

  console.log('正在更新公钥文件...');
  writePublicKey(publicKey);

  console.log('正在将私钥嵌入生成器 HTML...');
  embedPrivateKey(privateKey);

  console.log('\n✅ 完成');
  console.log(`公钥：${PUBLIC_KEY_PATH}`);
  console.log(`生成器：${GENERATOR_HTML_PATH}`);
  console.log(`密钥备份：${KEYS_FILE_PATH}`);
  console.log('\n提示：请妥善保管生成器 HTML 与 .license-keys.json，其中包含私钥。');
}

main().catch((err) => {
  console.error('❌ 生成失败：', err.message);
  process.exit(1);
});
