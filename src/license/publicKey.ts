/**
 * MemBook — 内置公钥（RSA JWK）
 *
 * 用于验证激活码签名。对应的私钥仅保存在授权生成器工具中。
 * 如需更换密钥对，请使用 tools/license-generator/index.html 重新生成并替换此文件。
 */

export const LICENSE_PUBLIC_KEY: JsonWebKey ={
  "alg": "RS256",
  "e": "AQAB",
  "ext": true,
  "key_ops": [
    "verify"
  ],
  "kty": "RSA",
  "n": "swoGY0xAXLlWYfsL15ZvSSI28kuUNaHWM14zf3zKDvlgj32cG_9PnlmQtA_whGvlmd1F6DjouHW_GTQnTVKpm626SGIcEYLpm6UcK5HqOmdM6CFFxJWq06Pgl-W1vahdc4bwibY6E72QG7AfXz9BXWEBlt8cIW1XHQVhWEyu4x4EB7sxXa8AIBxOv36YW1NIvprFT0NnbJ5BRRaPuebF9211rV-dXc7GPJbB9CM2XAcOdhM4-USEUD7g6R-CjRHsw2p0Yc4l7DblYsVo1abGMmDthNDPeYuR4_5y4bSCQzmwRcwm844UdpbrWi5B46oVxv4R9UlVvs0VRXuenir1Lw"
}