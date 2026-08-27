/**
 * 封面/封底元素跨尺寸适配的统一缩放工具
 *
 * 解决"模板效果 vs 不同尺寸页面效果不一致"问题：页面宽高比与模板设计宽高比不同时，
 * "等比不变形"与"铺满"天然对立。按元素视觉语义分类处理：
 * - 区域/背景型（渐变蒙版、全幅照片槽）：按轴拉伸铺满——颜色/渐变平滑，拉伸不产生视觉破坏；
 * - 图形/局部槽型（圆形/菱形/星形/方形槽）：等比缩放保持宽高比——防止图形变形。
 *
 * 三处转换必须共用本函数，避免逻辑漂移：
 * - pageSlice.presetShapeToPageElements（模板百分比 → 页面 mm）
 * - albumMetaSlice.rescaleCoverDecorations（切换尺寸 mm → mm）
 * - pageMarginService.calcCoverOverrides（模板百分比 → 页面 px 槽位）
 */

/** 蒙版形状判断：id 含 'mask' 的渐变蒙版/装饰矩形，属"区域/背景型"，按轴拉伸覆盖区域 */
export function isMaskShape(id: string | undefined): boolean {
  return !!id && id.includes('mask');
}

/**
 * 照片槽位尺寸适配：逐轴判断。
 * 某一边达到全幅（≥95，即与封面尺寸该边一致）时，该轴按页面尺寸拉伸铺满；
 * 否则该轴等比缩放（min(kx,ky)）保持模板比例。
 * 例：全幅槽(100×100) 两边都拉伸占满；恋恋故事(48×100) 高度拉伸全高、宽度等比；
 *     多图/方形槽(37×58 / 60×46) 两边都不全幅，等比保持比例。
 */
export function coverSlotSize(
  slot: { width: number; height: number },
  kx: number,
  ky: number,
): { width: number; height: number } {
  const k = Math.min(kx, ky);
  const fullW = slot.width >= 95;
  const fullH = slot.height >= 95;
  return {
    width: fullW ? slot.width * kx : slot.width * k,
    height: fullH ? slot.height * ky : slot.height * k,
  };
}

/**
 * 返回元素适配后的新尺寸。
 * @param region 是否区域/背景型（true=按轴拉伸铺满；false=等比缩放保持宽高比）
 * @param baseW 基准宽度（百分比或当前 mm）
 * @param baseH 基准高度
 * @param kx 宽方向缩放系数
 * @param ky 高方向缩放系数
 * @returns {width, height} 适配后的宽高
 */
export function coverElementSize(
  region: boolean,
  baseW: number,
  baseH: number,
  kx: number,
  ky: number,
): { width: number; height: number } {
  const k = Math.min(kx, ky);
  return region
    ? { width: baseW * kx, height: baseH * ky }
    : { width: baseW * k, height: baseH * k };
}

/**
 * 封面/封底元素跨尺寸适配的"锚点感知定位"。
 *
 * 背景：模板按竖版 210×280 设计（百分比坐标），若尺寸仅按页面百分比映射定位、而尺寸按
 * 等比缩放，则页面宽高比变化时视觉关系会被破坏——居中的元素偏离中心、贴边的元素离边。
 * 此函数在【尺寸已适配】的基础上，按元素在原设计中的锚点语义重新定位，保证异宽高比页面上
 * 视觉关系一致：
 * - 贴边元素（原 x≈0 左贴 / x+width≈100 右贴 / y≈0 顶贴 / y+height≈100 底贴）保持贴边；
 * - 居中元素（中心接近 50%）保持页面居中；
 * - 其余元素按页面百分比定位。
 *
 * @param box 模板百分比坐标(0-100)，含 x/y/width/height
 * @param pageW 目标页面宽（与 w 同单位，mm 或 px）
 * @param pageH 目标页面高
 * @param w 元素适配后的宽度（输出单位）
 * @param h 元素适配后的高度
 * @returns 锚定后的 x/y（输出单位，左上角）
 */
export function coverAnchorPosition(
  box: { x: number; y: number; width: number; height: number },
  pageW: number,
  pageH: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
  // 水平定位：贴左 > 贴右 > 居中 > 百分比
  const touchesLeft = box.x < 0.5;
  const touchesRight = box.x + box.width >= 99.5;
  const centerX = box.x + box.width / 2;
  const x = touchesLeft
    ? 0
    : touchesRight
      ? pageW - w
      : near(centerX, 50)
        ? pageW / 2 - w / 2
        : (box.x / 100) * pageW;
  // 垂直定位：贴顶 > 贴底 > 居中 > 百分比
  const touchesTop = box.y < 0.5;
  const touchesBottom = box.y + box.height >= 99.5;
  const centerY = box.y + box.height / 2;
  const y = touchesTop
    ? 0
    : touchesBottom
      ? pageH - h
      : near(centerY, 50)
        ? pageH / 2 - h / 2
        : (box.y / 100) * pageH;
  return { x, y };
}

/**
 * 封面形状元素跨尺寸缩放的几何重算（中心点语义）。
 *
 * ShapeElement.x/y 是**中心点**（渲染/拖动时按中心减半宽半高转左上角）。
 * 当相册尺寸变化时，用旧元素真实左上角盒（中心减半宽/半高）做锚点感知重新定位，
 * 再把锚点返回的左上角**加回半宽/半高**存回中心点 —— 与模板生成 `presetShapeToPageElements`
 * 完全一致。若把中心点误当左上角传给 `coverAnchorPosition`，贴右/贴底/角落形状会往左上偏移。
 *
 * @param shape 旧元素（含 id?/x/y/width/height，x/y 为中心点、含书脊偏移）
 * @param oldSize 旧页尺寸
 * @param newSize 新页尺寸
 * @param spineOffsetX 书脊锚点偏移（同 presetShapeToPageElements 的 spineOffsetX）
 * @returns 新尺寸下的中心点坐标与已适配尺寸
 */
export function rescaleCoverShapeGeometry(
  shape: { id?: string; x: number; y: number; width: number; height: number },
  oldSize: { width: number; height: number },
  newSize: { width: number; height: number },
  spineOffsetX: number,
): { x: number; y: number; width: number; height: number } {
  const kx = newSize.width / oldSize.width;
  const ky = newSize.height / oldSize.height;
  // 尺寸：蒙版按轴拉伸覆盖区域，装饰形状等比保持宽高比
  const { width, height } = coverElementSize(isMaskShape(shape.id), shape.width, shape.height, kx, ky);
  // 用真实左上角盒的百分比做锚点判定（中心减半宽/半高）
  const pctBox = {
    x: ((shape.x - spineOffsetX - shape.width / 2) / oldSize.width) * 100,
    y: ((shape.y - shape.height / 2) / oldSize.height) * 100,
    width: (shape.width / oldSize.width) * 100,
    height: (shape.height / oldSize.height) * 100,
  };
  // 锚点返回左上角，加回半宽/半高存回中心点
  const { x, y } = coverAnchorPosition(pctBox, newSize.width, newSize.height, width, height);
  return {
    x: spineOffsetX + x + width / 2,
    y: y + height / 2,
    width: Math.max(width, 0.5),
    height: Math.max(height, 0.5),
  };
}