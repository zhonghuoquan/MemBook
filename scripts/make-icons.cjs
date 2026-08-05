// 用高分辨率源图生成 Tauri 图标（BMP-in-ICO，Windows 全版本兼容）
// 两阶段缩小（源图→4x中间尺寸→目标尺寸）+ lanczos3 + normalise + sharpen
// 小尺寸（≤48px）用两阶段缩小，比直接缩小更清晰
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const ICON_DIR = path.join(__dirname, '..', 'src-tauri', 'icons');
const SRC = process.argv[2] || path.join(ICON_DIR, 'icon-source.png');

const RESIZE_OPTIONS = {
  fit: 'contain',
  background: { r: 0, g: 0, b: 0, alpha: 0 },
  kernel: 'lanczos3',
  withoutEnlargement: false,
};

// Windows 任务栏和资源管理器常用的图标尺寸
// 从大到小排列：某些图标加载库（含 Tauri codegen）可能取 ICO 第一个尺寸作为窗口图标，
// 将 256 放首位确保 Tauri 嵌入的窗口图标是高分辨率，任务栏不模糊
// 16/24/32：100% DPI 任务栏（始终合并/从不合并/小图标模式）
// 20/40：125% DPI 任务栏；48/64：150%/200% DPI 任务栏
// 96/128/256：资源管理器大图标/超大图标视图
const ICO_SIZES = [256, 128, 96, 64, 48, 40, 32, 24, 20, 16];

/**
 * 去除源图四周透明留白，让小尺寸图标中的 logo 占据更大比例，避免任务栏缩放模糊。
 * 仅在源图有实质性透明边距时才 trim+extend；源图已满版时不加 padding，避免 logo 占比降低。
 */
async function prepareSource(srcPath, outPath) {
  const srcMeta = await sharp(srcPath).metadata();
  // 检测源图实际不透明区域边界
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const logoW = maxX - minX + 1;
  const logoH = maxY - minY + 1;
  const logoRatio = Math.max(logoW / info.width, logoH / info.height);

  // 源图 logo 占比 ≥95% 时直接使用，不加 padding（避免 logo 缩小变模糊）
  if (logoRatio >= 0.95) {
    await sharp(srcPath).clone().png().toFile(outPath);
    console.log(`prepared: ${outPath} (source already full, ${info.width}x${info.height}, skip padding)`);
    return;
  }

  // 有透明边距时 trim + 少量 padding（2%，比原来 5% 更少，让 logo 占比更大）
  const trimmed = sharp(srcPath).trim();
  const { width, height } = await trimmed.metadata();
  const maxDim = Math.max(width, height);
  const padding = Math.round(maxDim * 0.02);
  const canvasSize = maxDim + padding * 2;
  const top = Math.floor((canvasSize - height) / 2);
  const bottom = canvasSize - height - top;
  const left = Math.floor((canvasSize - width) / 2);
  const right = canvasSize - width - left;

  await trimmed
    .extend({ top, bottom, left, right, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log(`prepared: ${outPath} (${width}x${height} -> ${canvasSize}x${canvasSize}, padding 2%)`);
}

/**
 * 构建 BMP-in-ICO 容器（Windows 全版本兼容，包括 XP）。
 *
 * 为什么用 BMP 而不是 PNG：
 * - Windows 任务栏使用 GDI/Direct2D 渲染图标，对 BMP 格式有原生优化，渲染更清晰
 * - PNG-in-ICO 需要 Windows 先解码 PNG 再渲染，某些 DPI 缩放场景下会引入模糊
 * - BMP-in-ICO 的 32 位 BGRA 模式同样支持完整 8 位 alpha 透明通道
 * - 微软官方推荐：256x256 可用 PNG 压缩节省空间，其他尺寸用 BMP 保证渲染质量
 *
 * BMP-in-ICO 单条目结构：
 *   BITMAPINFOHEADER (40 字节，biHeight = 2 * iconHeight，表示 XOR + AND 掩码)
 *   XOR 位图（BGRA 像素，自下而上，行对齐到 4 字节）
 *   AND 掩码（1bpp，自下而上，行对齐到 4 字节；32 位图标中全零，由 alpha 通道处理透明）
 */
async function makeIco(srcPath, outPath, sizes) {
  const headers = [];
  const images = [];
  let offset = 6 + sizes.length * 16;

  for (const s of sizes) {
    // 两阶段缩小：小尺寸（≤48px）先缩小到 4x 中间尺寸，再缩小到目标尺寸
    // 比直接从 1250px 缩小到 32px（39倍）更清晰，第二阶段缩小更精确
    let resizePipeline;
    if (s <= 48) {
      const midSize = s * 4; // 中间尺寸 = 4x 目标尺寸
      resizePipeline = sharp(srcPath)
        .resize(midSize, midSize, RESIZE_OPTIONS)
        .normalise()
        .sharpen({ sigma: 1.0, m1: 2.0, m2: 0.4 })
        .resize(s, s, { ...RESIZE_OPTIONS, kernel: 'lanczos3' })
        .sharpen({ sigma: 0.6, m1: 1.0, m2: 0.2 }); // 第二阶段轻度锐化
    } else {
      resizePipeline = sharp(srcPath).resize(s, s, RESIZE_OPTIONS);
    }
    const { data } = await resizePipeline
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const rowSize = s * 4; // 32 位 BGRA，每像素 4 字节，自然对齐到 4
    const xorSize = rowSize * s;
    const andRowSize = Math.ceil(s / 32) * 4; // 1bpp，每行像素打包到字节后对齐到 4 字节
    const andSize = andRowSize * s;

    // BITMAPINFOHEADER
    const bih = Buffer.alloc(40);
    bih.writeUInt32LE(40, 0);              // biSize
    bih.writeInt32LE(s, 4);                // biWidth
    bih.writeInt32LE(s * 2, 8);            // biHeight = 2x（XOR + AND 掩码）
    bih.writeUInt16LE(1, 12);              // biPlanes
    bih.writeUInt16LE(32, 14);             // biBitCount
    bih.writeUInt32LE(0, 16);              // biCompression = BI_RGB
    bih.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
    // 其余字段（biXPelsPerMeter/biYPelsPerMeter/biClrUsed/biClrImportant）保持 0

    // XOR 位图（BGRA，自下而上）
    const xor = Buffer.alloc(xorSize);
    for (let y = 0; y < s; y++) {
      const srcY = s - 1 - y; // BMP 自下而上：第一行对应源图最后一行
      const srcRowStart = srcY * s * 4;
      const dstRowStart = y * s * 4;
      for (let x = 0; x < s; x++) {
        const si = srcRowStart + x * 4;
        const di = dstRowStart + x * 4;
        xor[di] = data[si + 2];     // B
        xor[di + 1] = data[si + 1]; // G
        xor[di + 2] = data[si];     // R
        xor[di + 3] = data[si + 3]; // A
      }
    }

    // AND 掩码（全零，32 位图标的透明度由 alpha 通道处理）
    const and = Buffer.alloc(andSize);

    const bmpBuffer = Buffer.concat([bih, xor, and]);
    images.push(bmpBuffer);

    const entry = Buffer.alloc(16);
    entry.writeUInt8(s === 256 ? 0 : s, 0);
    entry.writeUInt8(s === 256 ? 0 : s, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(bmpBuffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += bmpBuffer.length;
    headers.push(entry);
  }

  const ICONDIR = Buffer.alloc(6);
  ICONDIR.writeUInt16LE(0, 0);
  ICONDIR.writeUInt16LE(1, 2);
  ICONDIR.writeUInt16LE(sizes.length, 4);

  fs.writeFileSync(outPath, Buffer.concat([ICONDIR, ...headers, ...images]));
  console.log(`ico: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB, BMP-in-ICO)`);
}

async function makePng(srcPath, size, name) {
  const out = path.join(ICON_DIR, name);
  let pipeline;
  if (size <= 48) {
    const midSize = size * 4;
    pipeline = sharp(srcPath)
      .resize(midSize, midSize, RESIZE_OPTIONS)
      .normalise()
      .sharpen({ sigma: 1.0, m1: 2.0, m2: 0.4 })
      .resize(size, size, { ...RESIZE_OPTIONS, kernel: 'lanczos3' })
      .sharpen({ sigma: 0.6, m1: 1.0, m2: 0.2 });
  } else {
    pipeline = sharp(srcPath).resize(size, size, RESIZE_OPTIONS);
  }
  await pipeline.png().toFile(out);
  console.log(`png: ${name} ${size}x${size}`);
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('source icon not found:', SRC);
    process.exit(1);
  }
  console.log('source:', SRC);

  // 先裁剪透明留白，生成中间源图，让所有图标基于同一优化后的源图
  const preparedSrc = path.join(ICON_DIR, 'icon-source-prepared.png');
  await prepareSource(SRC, preparedSrc);

  // Tauri 必需的标准 PNG 图标
  await makePng(preparedSrc, 32, '32x32.png');
  await makePng(preparedSrc, 64, '64x64.png');
  await makePng(preparedSrc, 128, '128x128.png');
  await makePng(preparedSrc, 256, '128x128@2x.png');
  await makePng(preparedSrc, 512, 'icon.png');

  // Windows 磁贴图标（Tauri 构建流程需要）
  await makePng(preparedSrc, 30, 'Square30x30Logo.png');
  await makePng(preparedSrc, 44, 'Square44x44Logo.png');
  await makePng(preparedSrc, 50, 'StoreLogo.png');
  await makePng(preparedSrc, 71, 'Square71x71Logo.png');
  await makePng(preparedSrc, 89, 'Square89x89Logo.png');
  await makePng(preparedSrc, 107, 'Square107x107Logo.png');
  await makePng(preparedSrc, 142, 'Square142x142Logo.png');
  await makePng(preparedSrc, 150, 'Square150x150Logo.png');
  await makePng(preparedSrc, 284, 'Square284x284Logo.png');
  await makePng(preparedSrc, 310, 'Square310x310Logo.png');

  // Windows .ico（含 16~256 多尺寸，任务栏使用 32px 在标准 DPI 下）
  await makeIco(preparedSrc, path.join(ICON_DIR, 'icon.ico'), ICO_SIZES);

  // macOS .icns
  await sharp(preparedSrc)
    .resize(512, 512, RESIZE_OPTIONS)
    .png()
    .toFile(path.join(ICON_DIR, 'icon.icns'));
  console.log('icns: icon.icns 512x512');

  // iOS AppIcon 全尺寸（名称与 Tauri 默认生成的一致）
  const IOS_ICONS = [
    { size: 20, scale: 1 }, { size: 20, scale: 2 }, { size: 20, scale: 2, suffix: '-1' }, { size: 20, scale: 3 },
    { size: 29, scale: 1 }, { size: 29, scale: 2 }, { size: 29, scale: 2, suffix: '-1' }, { size: 29, scale: 3 },
    { size: 40, scale: 1 }, { size: 40, scale: 2 }, { size: 40, scale: 2, suffix: '-1' }, { size: 40, scale: 3 },
    { size: 60, scale: 2 }, { size: 60, scale: 3 },
    { size: 76, scale: 1 }, { size: 76, scale: 2 },
    { size: 83.5, scale: 2 },
    { size: 512, scale: 2, name: 'AppIcon-512@2x.png' },
  ];
  const iosDir = path.join(ICON_DIR, 'ios');
  for (const { size, scale, suffix = '', name: customName } of IOS_ICONS) {
    const px = Math.round(size * scale);
    const name = customName || `AppIcon-${size}x${size}@${scale}x${suffix}.png`;
    await sharp(preparedSrc)
      .resize(px, px, { ...RESIZE_OPTIONS, fit: 'cover' })
      .png()
      .toFile(path.join(iosDir, name));
    console.log(`ios: ${name} ${px}x${px}`);
  }

  // Android mipmap 图标（launcher / round / foreground 使用同一源图）
  const ANDROID_DENSITIES = [
    { dir: 'mipmap-mdpi', size: 48 },
    { dir: 'mipmap-hdpi', size: 72 },
    { dir: 'mipmap-xhdpi', size: 96 },
    { dir: 'mipmap-xxhdpi', size: 144 },
    { dir: 'mipmap-xxxhdpi', size: 192 },
  ];
  for (const { dir, size } of ANDROID_DENSITIES) {
    const outDir = path.join(ICON_DIR, 'android', dir);
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
      await sharp(preparedSrc)
        .resize(size, size, { ...RESIZE_OPTIONS, fit: 'cover' })
        .png()
        .toFile(path.join(outDir, name));
    }
    console.log(`android: ${dir} ${size}x${size}`);
  }

  console.log('done');
})();
