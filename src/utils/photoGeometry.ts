/**
 * 照片几何计算工具
 * 用于 Canvas / EditFlyout 共享的 cover-fit、边界约束、锚点缩放等逻辑
 */

/** 旋转后全覆盖：缩放照片使旋转后槽位四角不露白 */
export function calcCoverFitWithRotation(
  iw: number,
  ih: number,
  cw: number,
  ch: number,
  rotationDeg: number,
) {
  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  // 槽位四角映射到照片坐标系 → 最小照片尺寸
  const reqW = cw * cos + ch * sin;
  const reqH = cw * sin + ch * cos;
  const scale = Math.max(reqW / iw, reqH / ih);
  // 旋转后照片的可见边界
  const boundingW = (iw * cos + ih * sin) * scale;
  const boundingH = (iw * sin + ih * cos) * scale;
  return {
    imgW: iw * scale,
    imgH: ih * scale,
    boundingW,
    boundingH,
    scale,
  };
}

/** 计算照片中心可移动范围，确保旋转后的照片始终覆盖槽位四角不露白
 * 返回的是照片左上角（panX/panY）的允许范围
 */
export function computePhotoBounds(
  photoW: number,
  photoH: number,
  slotW: number,
  slotH: number,
  rotationDeg: number,
  panScale: number,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const cf = calcCoverFitWithRotation(photoW, photoH, slotW, slotH, rotationDeg);
  const effectiveScale = cf.scale * Math.max(panScale, 1);
  const imgW = photoW * effectiveScale;
  const imgH = photoH * effectiveScale;

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // 半平面约束 a*cx + b*cy <= c，确保槽位四角在旋转后的照片矩形内
  const constraints: { a: number; b: number; c: number }[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [slotW, 0],
    [slotW, slotH],
    [0, slotH],
  ];

  for (const [sx, sy] of corners) {
    // (sx-cx)*cos + (sy-cy)*sin 在 [-imgW/2, imgW/2]
    constraints.push({ a: cos, b: sin, c: sx * cos + sy * sin + imgW / 2 });
    constraints.push({ a: -cos, b: -sin, c: -(sx * cos + sy * sin) + imgW / 2 });
    // -(sx-cx)*sin + (sy-cy)*cos 在 [-imgH/2, imgH/2]
    constraints.push({ a: sin, b: -cos, c: sx * sin - sy * cos + imgH / 2 });
    constraints.push({ a: -sin, b: cos, c: -(sx * sin - sy * cos) + imgH / 2 });
  }

  // 枚举约束交点，过滤可行解，取 cx/cy 的极值
  let minCX = Infinity;
  let maxCX = -Infinity;
  let minCY = Infinity;
  let maxCY = -Infinity;
  let hasCandidate = false;

  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      const c1 = constraints[i];
      const c2 = constraints[j];
      const det = c1.a * c2.b - c2.a * c1.b;
      if (Math.abs(det) < 1e-9) continue;
      const cx = (c1.c * c2.b - c2.c * c1.b) / det;
      const cy = (c1.a * c2.c - c2.a * c1.c) / det;

      let feasible = true;
      for (const c of constraints) {
        if (c.a * cx + c.b * cy > c.c + 1e-6) {
          feasible = false;
          break;
        }
      }
      if (!feasible) continue;

      hasCandidate = true;
      minCX = Math.min(minCX, cx);
      maxCX = Math.max(maxCX, cx);
      minCY = Math.min(minCY, cy);
      maxCY = Math.max(maxCY, cy);
    }
  }

  if (!hasCandidate) {
    // 无可行解时退回到中心点
    return {
      minX: (slotW - cf.boundingW) / 2,
      maxX: (slotW - cf.boundingW) / 2,
      minY: (slotH - cf.boundingH) / 2,
      maxY: (slotH - cf.boundingH) / 2,
    };
  }

  // 中心点约束转换为左上角（panX/panY）约束
  const boundingW = imgW * Math.abs(cos) + imgH * Math.abs(sin);
  const boundingH = imgW * Math.abs(sin) + imgH * Math.abs(cos);
  return {
    minX: minCX - boundingW / 2,
    maxX: maxCX - boundingW / 2,
    minY: minCY - boundingH / 2,
    maxY: maxCY - boundingH / 2,
  };
}

/** 以指定中心点（或光标）为基准缩放照片，返回新的 panX/panY */
export function computeZoomedPan(
  photoW: number,
  photoH: number,
  slotW: number,
  slotH: number,
  rotationDeg: number,
  oldPanScale: number,
  newPanScale: number,
  oldPanX: number,
  oldPanY: number,
  anchorCX?: number,
  anchorCY?: number,
): { panX: number; panY: number } {
  const oldCF = calcCoverFitWithRotation(photoW, photoH, slotW, slotH, rotationDeg);
  const oldBW = oldCF.boundingW * oldPanScale;
  const oldBH = oldCF.boundingH * oldPanScale;
  const newBW = oldCF.boundingW * newPanScale;
  const newBH = oldCF.boundingH * newPanScale;

  const oldCX = oldPanX + oldBW / 2;
  const oldCY = oldPanY + oldBH / 2;

  // 默认以槽位中心为缩放锚点；提供 anchor 时以 anchor 为基准（Canva 光标缩放）
  const ax = anchorCX ?? slotW / 2;
  const ay = anchorCY ?? slotH / 2;
  const ratio = oldPanScale / newPanScale;
  let newCX = ax - (ax - oldCX) * ratio;
  let newCY = ay - (ay - oldCY) * ratio;

  // 约束到新的可行区域（多边形投影，防止旋转后露白）
  const clamped = clampPhotoToSlotBounds(photoW, photoH, slotW, slotH, rotationDeg, newPanScale, newCX - newBW / 2, newCY - newBH / 2);

  return {
    panX: clamped.panX,
    panY: clamped.panY,
  };
}

/** 槽位尺寸变化时保持照片相对位置（Canva 风格：保持视觉中心在槽位内的相对偏移） */
export function computePanForResizedSlot(
  photoW: number,
  photoH: number,
  oldSlotW: number,
  oldSlotH: number,
  newSlotW: number,
  newSlotH: number,
  rotationDeg: number,
  panScale: number,
  oldPanX: number,
  oldPanY: number,
): { panX: number; panY: number } {
  const oldCF = calcCoverFitWithRotation(photoW, photoH, oldSlotW, oldSlotH, rotationDeg);
  const oldBW = oldCF.boundingW * panScale;
  const oldBH = oldCF.boundingH * panScale;

  // 视觉中心相对槽位中心的偏移
  const oldVisualCX = oldPanX + oldBW / 2;
  const oldVisualCY = oldPanY + oldBH / 2;
  const oldOffsetX = oldVisualCX - oldSlotW / 2;
  const oldOffsetY = oldVisualCY - oldSlotH / 2;

  // 按槽位尺寸比例缩放偏移，保持相对位置
  const scaleX = oldSlotW > 0 ? newSlotW / oldSlotW : 1;
  const scaleY = oldSlotH > 0 ? newSlotH / oldSlotH : 1;
  const newOffsetX = oldOffsetX * scaleX;
  const newOffsetY = oldOffsetY * scaleY;

  const newCF = calcCoverFitWithRotation(photoW, photoH, newSlotW, newSlotH, rotationDeg);
  const newBW = newCF.boundingW * panScale;
  const newBH = newCF.boundingH * panScale;

  let newPanX = newSlotW / 2 + newOffsetX - newBW / 2;
  let newPanY = newSlotH / 2 + newOffsetY - newBH / 2;

  const clamped = clampPhotoToSlotBounds(photoW, photoH, newSlotW, newSlotH, rotationDeg, panScale, newPanX, newPanY);

  return { panX: clamped.panX, panY: clamped.panY };
}

/** 将照片位置（panX/panY）投影到可行多边形内，确保旋转+缩放+移动后槽位四角不露白
 * 使用半平面迭代投影，收敛到距离目标点最近的可行解
 */
export function clampPhotoToSlotBounds(
  photoW: number,
  photoH: number,
  slotW: number,
  slotH: number,
  rotationDeg: number,
  panScale: number,
  panX: number,
  panY: number,
): { panX: number; panY: number } {
  const cf = calcCoverFitWithRotation(photoW, photoH, slotW, slotH, rotationDeg);
  const effectiveScale = cf.scale * Math.max(panScale, 1);
  const imgW = photoW * effectiveScale;
  const imgH = photoH * effectiveScale;

  const rad = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const boundingW = imgW * Math.abs(cos) + imgH * Math.abs(sin);
  const boundingH = imgW * Math.abs(sin) + imgH * Math.abs(cos);

  // 中心点约束 a*cx + b*cy <= c，确保槽位四角在旋转后的照片矩形内
  const constraints: { a: number; b: number; c: number }[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [slotW, 0],
    [slotW, slotH],
    [0, slotH],
  ];

  for (const [sx, sy] of corners) {
    constraints.push({ a: cos, b: sin, c: sx * cos + sy * sin + imgW / 2 });
    constraints.push({ a: -cos, b: -sin, c: -(sx * cos + sy * sin) + imgW / 2 });
    constraints.push({ a: sin, b: -cos, c: sx * sin - sy * cos + imgH / 2 });
    constraints.push({ a: -sin, b: cos, c: -(sx * sin - sy * cos) + imgH / 2 });
  }

  let cx = panX + boundingW / 2;
  let cy = panY + boundingH / 2;

  // 迭代投影到可行多边形（POCS）
  for (let iter = 0; iter < 80; iter++) {
    let moved = false;
    for (const c of constraints) {
      const v = c.a * cx + c.b * cy;
      if (v > c.c + 1e-6) {
        const d = v - c.c;
        const denom = c.a * c.a + c.b * c.b;
        if (denom > 1e-9) {
          cx -= c.a * d / denom;
          cy -= c.b * d / denom;
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return { panX: cx - boundingW / 2, panY: cy - boundingH / 2 };
}
