import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
// 必须用 ESM bundle：package.json 的 main/browser 指向 UMD 版（window.St 上，命名导入会得到 undefined）
import { PageFlip } from 'page-flip/dist/js/page-flip.module.js';
import type { FlipEvent } from 'page-flip/dist/js/page-flip.module.js';
import { useEditorStore, usePhotoStore } from '../../store';
import { MM_TO_PX } from '../../utils/sharedRender';
import type { AlbumPage, Photo } from '../../types';
import { loadImage, readFileAsBlobUrl } from '../../utils/tauri';
import { HardcoverFrame } from '../common/HardcoverFrame';
import { WindowControls } from '../common/WindowControls';
import {
  renderPageThumbnail,
  preloadStickers,
  loadBackgroundBitmap,
  releasePreloadedImages,
  releaseStickerImages,
} from '../../utils/gridThumbnailRenderer';

/**
 * 翻页画布外扩量（px）：StPageFlip 的 canvas 缓冲 = .stf__parent（即 containerRef 挂载的 el）尺寸。
 * 翻页时软页页角/折叠边会翘出书体矩形，若 el 与书体等大，翘出部分超出 canvas 位图就被裁剪。
 * 因此四向均向外扩：上下 PAD_Y（页角向上/向下翘起）、左右 PAD_X（软页折叠的横向摆动），
 * 让整片画布缓冲都大于书体，页角翻转全程不被裁切。
 * （size:'fixed' 下书本位置由 left=s-r/2、top=PAD_Y 自动确定，外扩只会扩缓冲不会移动书本，安全。）
 */
const PAD_X = 64;
// PAD_Y：上下缓冲高（避免翻页页角上/下翘起被裁）。为让实物书放更大，由 110 减半为 55。
// 减弱了极端页角上/下翻时的画布余量，但配合页面尺寸预算预留，正常翻页不会裁边。
const PAD_Y = 55;
/** 底部悬浮进度条覆盖区高度（px）：进度条弹出时停在这里，不遮书。
    页面内容区据此容读书体；但书体尺寸按「页面高度」计算（不按进度条占位扣一档），只在底部留此薄悬浮区。 */
const OVERLAY_RESERVE = 36;
/** 底部悬浮控制行自身高度（px）：略高于页面预留区，配合底部 paddingBottom 使控件整体上移一点、不与底边贴太死 */
const FLOAT_BAR_H = 40;

/**
 * 为翻页画布扩大裁剪缓冲（解决「卷起的页角被裁剪」+「翻页书整体偏移」）。
 * ─────────────────────────────────────────
 * 关键：StPageFlip 会把 .stf__parent（containerRef 挂载的 containerRef el）
 *   - 强制改为 position:relative（注入的 .stf__parent CSS 覆盖 Tailwind .absolute）；
 *   - 并写入显式 width/height = 书体尺寸（spreadW × pageH）。
 * 因此不能靠 JSX 里 `left/top:-PAD` 这类负偏移来"外扩"：
 * 对 relative + 固定宽高的元素，负 left/top 只是平移（把整本书上移/左移，破坏与封面/装饰书框对齐），
 * 且 canvas 缓冲仍是书体大小，翻起的软页页角一旦伸出书体就被位图边界裁剪。
 * 正确做法：初始化后，把 el 实际盒尺寸放大（四向各扩 PAD），并把 left/top 设为负值使其关于书体居中。
 * PageFlip 按 boundsRect（left=块宽/2 − 单页宽、top=块高/2 − 页高/2）在 el 内居中绘制书体，
 * 所以放大只扩 canvas 缓冲、不移动书体 —— 封面与翻页书保持对齐，同时页角不再被裁。
 *
 * z-index=10（翻起页置顶层）：装饰层 page-edge(4)/page-stack(5) 在画布之下 ——
 * 翻起的软页翅出书体上下/左右时应盖过书缘与页堆（实物书中翻起的纸页在书口断面之上），
 * 否则翻起页穿过装饰条下方形成"穿模"。静态时画布内容只在书体区内、装饰条在书体外，
 * 提层级不影响静态观感。书脊沟槽(gutter)单独置 z=12 保持可见。
 */
function applyFlipBuffer(el: HTMLDivElement | null, size: { spreadW: number; pageH: number }) {
  if (!el) return;
  // 关键：el 必须脱离文档流（absolute），否则它作为 in-flow 子级会把 bookWrap 撑高（bookWrap 有
  // aspectRatio 但内容更高时仍会增长到 el 高度），flex 居中的是"被撑高的书框"，而书体画在 el 中心
  // 仍落在上方 —— 导致垂直偏移 ~PAD_Y（这正是实测画布中心 Y 比书框中心高 110px 的根因）。
  // 改为 absolute 后 bookWrap 保持设计的 aspectRatio 高度并正确居中；el 再以其自身尺寸在 bookWrap
  // 内居中（bookWrap 为 relative 定位上下文），使书体内接盒中心 == 书框中心 == 预览区中心。
  // 同时清掉 PageFlip(autoSize) 写的 min/max-width，避免把缓冲宽 clamp 回书体宽造成水平偏移。
  el.style.minWidth = '0px';
  el.style.maxWidth = 'none';
  el.style.position = 'absolute';
  el.style.left = '50%';
  el.style.top = '50%';
  el.style.width = `${size.spreadW + PAD_X * 2}px`;
  el.style.height = `${size.pageH + PAD_Y * 2}px`;
  // 负 margin 使其关于组合盒中心对称（左移/上移半个缓冲盒），centered over bookWrap
  el.style.marginLeft = `${-(PAD_X + size.spreadW / 2)}px`;
  el.style.marginTop = `${-(PAD_Y + size.pageH / 2)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.zIndex = '10';
}

/**
 * BookPreviewOverlay —— 相册真实效果预览（硬壳书板 + 内容软翻页）
 * ─────────────────────────────────────────
 * 真实精装书结构：
 *   - 封面 / 封底为「硬壳书板」（HardcoverFrame 实物效果，与主页相册封面完全一致），
 *     渲染相册真实封面/封底页面（用户已保存内容），非模板示意稿。
 *   - 内容页 + 前后衬页为「软页」，由 StPageFlip 对开（左右双页）承载真实翻页。
 * 三段式：
 *   1. cover：封面硬壳书板合上，点击 → 硬壳翻开动效 → 翻页书首屏 [衬页 | 内容1]。
 *   2. flip：对开真实翻页；首个对开点击左侧前衬页 → 合上回封面（与翻开互逆）；
 *      末个对开点击右侧后衬页 → 合上到封底。左右两侧圆形图标按钮翻页，底部进度条拖拽跳页。
 *   3. back：封底硬壳书板合上，点击 → 硬壳翻开动效（镜像）→ 回到翻页书末屏。
 * 书体立体感：对开页尺寸与封面单页同源（designW×designH 等比），
 * 左右页堆厚度（独立纸条纹层，随对开进度平滑变化）+ 书体多层投影 + 页堆边缘投影，
 * 使书从白底浮起（无落地投影）。
 * 布局：位于编辑器顶部任务栏下方（任务栏保持编辑器样式，预览按钮切换为「退出预览」）。
 */
interface BookPreviewOverlayProps {
  open: boolean;
  onClose: () => void;
  /** 可选：外部传入要展示的相册数据（主页相册卡片入口）。不传时回退到编辑器 store */
  pages?: AlbumPage[];
  /** 可选：相册尺寸（mm）。不传时回退到编辑器 store */
  albumSize?: { width: number; height: number; id?: string; name?: string; desc?: string } | null;
  /** 可选：照片列表。不传时回退到全局照片 store */
  photos?: Photo[];
  /** 可选：提供时表示「主页入口」——由组件自绘与编辑器预览态一致的顶部任务栏（标题居中 + 退出预览 + 窗口控制），
      覆盖层顶到窗口最上盖住主页 AppHeader；否则（编辑器入口）由编辑器 Toolbar 承担预览态任务栏 */
  topBarTitle?: string;
}

export function BookPreviewOverlay({ open, onClose, pages: externalPages, albumSize: externalAlbumSize, photos: externalPhotos, topBarTitle }: BookPreviewOverlayProps) {
  const { t } = useTranslation();
  const storePages = useEditorStore((s) => s.pages);
  const storePhotos = usePhotoStore((s) => s.photos);
  const storeAlbumSize = useEditorStore((s) => s.albumSize);
  // 支持外部传入（主页相册卡片入口）优先，否则回退编辑器/全局 store
  const pages = externalPages ?? storePages;
  const photos = externalPhotos ?? storePhotos;
  const albumSize = externalAlbumSize ?? storeAlbumSize;
  // 主页入口：自绘顶部任务栏并让覆盖层顶到窗口最上（盖住主页 AppHeader），与编辑器预览态保持一致
  const isHomePreview = topBarTitle != null;

  const containerRef = useRef<HTMLDivElement>(null);
  const bookWrapRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  // 封面单页与翻页书单页的共享像素尺寸（封面/封底各显示 1 页，翻页书对开显示 2 页），
  // 由渲染期统一算出，供 JSX 与 PageFlip 初始化共同使用，从根源保证尺寸/位置对齐。
  const pageSizeRef = useRef({ coverW: 420, spreadW: 840, pageH: 560 });
  // 翻页书总页数（含前后衬页与补页，不含封面/封底）
  const totalPagesRef = useRef(0);
  // 按下位置：区分「点击衬页合书」与「拖拽翻页」（位移 > 6px 视为拖拽）
  const downPosRef = useRef<{ x: number; y: number } | null>(null);
  // 仅有封面+封底、无内容页：此时没有软页可翻，预览退化为「封面↔封底」直接切换
  const noContentPagesRef = useRef(false);
  // 当前对开左页页码（0 起），由 flip 事件驱动
  const [pageIndex, setPageIndex] = useState(0);
  // 封面/封底真实渲染图（与主页相册封面同源的真实页面内容）
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  // 当前展示阶段：封面硬壳 | 内容翻页 | 封底硬壳
  const [stage, setStage] = useState<'cover' | 'flip' | 'back'>('cover');
  const [opening, setOpening] = useState(false);         // 封面翻开动效进行中
  const [openingBack, setOpeningBack] = useState(false); // 封底翻开动效进行中
  const [closingDir, setClosingDir] = useState<'front' | 'back' | null>(null); // 合书动效方向
  // 翻页交互进行中（拖角/折叠/翻动，PageFlip changeState ≠ 'read'）：
  // 翻起页翅出书体时应盖过书缘/页堆装饰且不叠书脊沟槽阴影 → 隐藏 gutter
  const [flipping, setFlipping] = useState(false);
  // 底部进度条自动收起：悬浮底部唤起，2.5s 无操作渐隐滑出（对齐全屏查看交互）
  const [progressVisible, setProgressVisible] = useState(false);
  const progressTimerRef = useRef<number | null>(null);
  // 渐进式渲染：后台分批渲染内容页的进度（正在生成预览页面 x/N），翻页书就绪前给用户反馈
  const [renderProgress, setRenderProgress] = useState<{ done: number; total: number } | null>(null);
  // 用户在翻页书就绪前点击封面/封底 → 就绪后自动翻开（不再静默忽略点击）
  const pendingOpenRef = useRef(false);
  // 批次渲染完成待热替换：翻页进行中（changeState ≠ 'read'）时延后到静止再 updateFromImages
  const pendingUpdateRef = useRef(false);
  // 当前翻页书页面图片数组（未渲染部分为加载占位；批次完成后整体热替换）
  const pageImagesRef = useRef<string[]>([]);

  // 相册尺寸标识：albumSize 迟到（会话恢复 hydrate 竞态）或切换尺寸时，
  // 下方初始化 effect 据此销毁重建翻页书，保证书本按用户设定尺寸生成
  const sizeKey = albumSize ? `${Math.round(albumSize.width)}x${Math.round(albumSize.height)}` : '';

  // 进入翻页书（封面/封底绕书脊翻开的 3D 动效）。
  // 无内容页（仅封面+封底）时退化为封面↔封底切换。
  // 就绪前被点击由 pendingOpenRef 标记，翻页书创建完成后自动调用本函数。
  const openFlipBook = (dir: 'front' | 'back' = 'front') => {
    const openState = dir === 'back' ? openingBack : opening;
    const setOpen = dir === 'back' ? setOpeningBack : setOpening;
    if (noContentPagesRef.current) {
      if (openState) return;
      setOpen(true);
      setTimeout(() => {
        setOpen(false);
        setStage(dir === 'back' ? 'cover' : 'back');
      }, 550);
      return;
    }
    if (openState || !flipRef.current) return;
    setOpen(true);
    setTimeout(() => {
      setOpen(false);
      if (!flipRef.current) return;
      setStage('flip');
      flipRef.current.turnToPage(dir === 'back' ? Math.max(0, totalPagesRef.current - 2) : 1);
    }, 550);
  };

  // 批次渲染完成 → 把最新页面图片数组热替换进翻页书（PageFlip.updateFromImages）。
  // 若用户正在翻页（拖角/翻动中），先标记 pending，等 changeState 回到 'read' 再替换，避免打断翻页动画。
  const flushPendingUpdate = () => {
    const flip = flipRef.current;
    if (!flip) return;
    if ((flip as any).getState?.() !== 'read') { pendingUpdateRef.current = true; return; }
    pendingUpdateRef.current = false;
    try {
      flip.updateFromImages(pageImagesRef.current);
    } catch { /* 忽略热替换失败 */ }
  };

  // 打开时渲染封面/封底真实页面 + 内容页，初始化翻页书
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    setPageIndex(0);
    setStage('cover');
    setOpening(false);
    setOpeningBack(false);
    setClosingDir(null);
    setCoverImage(null);
    setBackImage(null);
    setRenderProgress(null);
    pendingOpenRef.current = false;
    pendingUpdateRef.current = false;

    const boot = async () => {
      // 显式传入相册尺寸给渲染引擎：冷启动时全局 store 的 albumSize 为 null，
      // 不传会让 renderPageThumbnail 回退 store 尺寸 → 返回 null → 封面/内容全空白。
      // （与主页封面卡片一致：必须按当前相册尺寸渲染，而非依赖全局 store）
      const renderAlbumSize = { width: albumSize?.width ?? 210, height: albumSize?.height ?? 280 };
      // 封面/封底硬壳书板：渲染相册真实页面（与主页相册封面卡片一致的内容）
      const coverPage = pages.find((p) => p.pageKind === 'cover') ?? pages[0];
      if (coverPage) {
        const img = await renderSinglePage(coverPage, photos, renderAlbumSize);
        if (!cancelled) setCoverImage(img);
      }
      const backPage = pages.find((p) => p.pageKind === 'backCover');
      if (backPage) {
        const img = await renderSinglePage(backPage, photos, renderAlbumSize);
        if (!cancelled) setBackImage(img);
      }

      // 内容页（软翻页主体）；携带完整 pages 供渲染时按绝对页索引绘制时间水印
      const content = pages
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => p.pageKind !== 'cover' && p.pageKind !== 'backCover');
      // 无内容页（仅有封面+封底）：不创建翻页书，退化为封面↔封底切换
      noContentPagesRef.current = content.length === 0;
      if (content.length === 0) {
        if (!cancelled) setRenderProgress(null);
        return;
      }

      // 页序（软页，总页数补为偶数，保证末对开为 [补白页 | 后衬页]，封底内衬始终在右侧）：
      //   [衬页 | 内容1..N | (补白页) | 衬页]
      // 未渲染的内容页先用「加载占位页」填充，使翻页书页数完整、可立即创建。
      const endpaper = makeEndpaperDataUrl();
      const pageImages: string[] = [endpaper, ...content.map(() => LOADING_PAGE_DATAURL), endpaper];
      if (pageImages.length % 2 === 1) {
        pageImages.splice(pageImages.length - 1, 0, LOADING_PAGE_DATAURL);
      }
      totalPagesRef.current = pageImages.length;
      pageImagesRef.current = pageImages;

      const el = containerRef.current;
      if (!el) return;
      el.innerHTML = '';

      // 渐进式渲染第一步：只渲染首屏对开附近的前 N 张内容页，即可创建翻页书 → 点封面马上能进翻页
      const FIRST_BATCH = 8;
      let renderedCount = 0; // 已渲染内容页数（累计，跨批次进度）
      const report = (doneInBatch: number) => {
        if (cancelled) return;
        setRenderProgress({ done: Math.min(renderedCount + doneInBatch, content.length), total: content.length });
      };
      const firstImages = await renderPageBatch(content.slice(0, FIRST_BATCH), photos, renderAlbumSize, pages, report);
      if (cancelled) return;
      for (let k = 0; k < firstImages.length; k++) pageImages[1 + k] = firstImages[k];
      renderedCount += firstImages.length;

      let flip: PageFlip;
      try {
        // 页面尺寸必须与封面实际渲染尺寸完全一致。
        // 直接复用渲染期算好的共享尺寸 pageSizeRef（与 JSX 中封面/翻页书同一来源）：
        //   - 单页宽 = coverW = 封面单页宽，单页高 = pageH = 封面单页高。
        //   - usePortrait:false 下 PageFlip 画布自动为 2×单页宽（对开），正好铺满翻页书容器。
        // 不再用 getBoundingClientRect 测量（翻页书容器此时为 invisible，且受额外 cap 影响），
        // 从而彻底避免封面与翻页书尺寸/位置错位。
        const { coverW, pageH } = pageSizeRef.current;
        const mmH = albumSize?.height ?? 280;
        const designH = Math.round(mmH * MM_TO_PX);
        const fallbackH = Math.round(designH * 1.1);
        flip = new PageFlip(el, {
          // 单页宽 = 封面单页宽；单页高 = 封面单页高；usePortrait:false 画布 = 2×单页宽
          width: coverW,
          height: pageH,
          size: 'fixed',
          minWidth: 160,
          maxWidth: coverW * 2,
          minHeight: 160,
          maxHeight: Math.max(fallbackH, pageH),
          drawShadow: true,
          flippingTime: 700,
          usePortrait: false,
          autoSize: true,
          showCover: false,
          startPage: 1,
          maxShadowOpacity: 0.55,
          showPageCorners: true,
          mobileScrollSupport: true,
          swipeDistance: 30,
          clickEventForward: true,
          useMouseEvents: true,
          disableFlipByClick: false,
        });
        // 先加载当前快照（首批真实 + 其余占位），后续批次经 updateFromImages 热替换
        flip.loadFromImages([...pageImages]);
      } catch (err) {
        console.warn('[BookPreview] 翻页书初始化失败', err);
        return;
      }
      flipRef.current = flip;
      // 初始化完成后扩大画布缓冲（PageFlip 会把 el 强制为书体尺寸；此处放大四向缓冲并保持书体居中）
      applyFlipBuffer(containerRef.current, pageSizeRef.current);

      // 页码同步：StPageFlip 的 flip 事件 data 为纯数字页码
      // （PageFlip.updatePageIndex → trigger('flip', this, newPage)），
      // 仅 init 事件是 { page, mode } —— 此处做双格式兼容。
      // 进度条跳页是主动 setPageIndex；拖拽/按钮翻页依赖本事件（否则页堆厚度不更新）。
      flip.on('flip', (e: FlipEvent) => {
        if (cancelled) return;
        const raw = e?.data;
        const page = typeof raw === 'number' ? raw : raw?.page;
        if (typeof page === 'number' && Number.isFinite(page)) setPageIndex(page);
      });

      // 翻页交互状态：'read'（静止）| 'user_fold'/'fold_corner'（拖角）| 'flipping'（翻动中）
      // 翻动中隐藏书脊沟槽阴影（gutter 在画布之上，避免压住翻起页穿模），静止后淡入还原；
      // 静止时若有待热替换的批次（翻页中完成渲染的），立即执行，避免打断翻页动画。
      flip.on('changeState', (e: FlipEvent) => {
        if (cancelled) return;
        const state = e?.data as unknown as string | undefined;
        setFlipping(state !== 'read');
        if (state === 'read' && pendingUpdateRef.current) flushPendingUpdate();
      });

      // 响应式尺寸：wrapper 宽度随视口/容器变化，重新触发自动尺寸适配，并重挂缓冲
      if (bookWrapRef.current) {
        ro = new ResizeObserver(() => {
          if (cancelled || !flipRef.current) return;
          try { (flipRef.current as any).update?.(); } catch {}
          applyFlipBuffer(containerRef.current, pageSizeRef.current);
        });
        ro.observe(bookWrapRef.current);
      }

      // PageFlip 初始化末尾有 +1ms init 定时器（ui.update/turnToPage 等）可能重写 el 尺寸，
      // 延迟再应用一次缓冲盒，确保书体居中、四周缓冲稳定生效（覆盖竞态重置）。
      const guardTimer = window.setTimeout(() => {
        if (cancelled) return;
        applyFlipBuffer(containerRef.current, pageSizeRef.current);
      }, 90);
      void guardTimer;

      // 用户在翻页书就绪前点过封面 → 自动翻开，不要求再次点击
      if (pendingOpenRef.current) {
        pendingOpenRef.current = false;
        window.setTimeout(openFlipBook, 60);
      }

      // 渐进式渲染第二步：其余页面后台分批渲染（每批让出主线程 + 报告进度），
      // 完成后整体热替换进翻页书（翻页进行中延后，静止后 flushPendingUpdate 生效）。
      for (let start = FIRST_BATCH; start < content.length && !cancelled; start += FIRST_BATCH) {
        const batchImages = await renderPageBatch(content.slice(start, start + FIRST_BATCH), photos, renderAlbumSize, pages, report);
        if (cancelled) return;
        for (let k = 0; k < batchImages.length; k++) pageImages[start + 1 + k] = batchImages[k];
        renderedCount += batchImages.length;
        pageImagesRef.current = pageImages;
        flushPendingUpdate();
      }
      if (!cancelled) setRenderProgress(null);
    };

    boot();
    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      flipRef.current?.destroy();
      flipRef.current = null;
    };
    // 依赖 sizeKey/pagesCount：会话恢复时 store 异步 hydrate，albumSize/pages 可能晚于 open 到达。
    // 若只在 open 时初始化一次，PageFlip 会按默认 210×280 建书且永不重建，
    // 而装饰书框（JSX）随后按真实尺寸渲染 → 书本与书框比例/位置错位、尺寸不符用户设定。
    // 尺寸或页数变化（hydrate 迟到）时销毁重建，保证书本严格按用户设定的相册尺寸生成。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sizeKey, pages.length]);

  // Esc 退出预览
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // 进度条唤起/自动收起
  const showProgress = () => {
    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setProgressVisible(true);
  };
  const hideProgressDelayed = () => {
    if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    progressTimerRef.current = window.setTimeout(() => setProgressVisible(false), 2500);
  };
  // 进入翻页先显示进度条，随后自动收起；非翻页态一律隐藏
  useEffect(() => {
    if (stage !== 'flip') {
      setProgressVisible(false);
      return;
    }
    showProgress();
    hideProgressDelayed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);
  // 卸载时清理收起定时器
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) window.clearTimeout(progressTimerRef.current);
    };
  }, []);

  if (!open) return null;

  // 安全页码：钳制到 [0, total-1]，杜绝 NaN 溢出到 UI
  const total = totalPagesRef.current || 1;
  const safePage = Math.min(Math.max(Number.isFinite(pageIndex) ? pageIndex : 0, 0), total - 1);
  // 内容页数（去掉前后衬页/补页）；当前内容页序号（1 起）= 对开右页（首个对开右页即第 1 张内容页）
  const contentTotal = Math.max(total - 2, 1);
  const contentCurrent = Math.min(contentTotal, Math.max(1, safePage + 1));

  // ── 共享像素尺寸（封面/封底显示 1 页，翻页书对开显示 2 页）──
  // 尺寸完全同源：单页宽 = coverW，单页高 = pageH（由 coverW 与设计宽高比推得）。
  // 翻页书总宽 = 2 × 单页宽（spreadW），从而翻页书每个单页与封面/封底严格同宽同高。
  // 用 JS 数值（而非 CSS calc 字符串）统一定出，保证封面、翻页书、PageFlip 画布三处取到完全一致的数。
  const mmW = albumSize?.width ?? 210;
  const mmH = albumSize?.height ?? 280;
  const ar = mmW / mmH;
  const aspectCss = `${mmW} / ${mmH}`;
  // 实物书预览：让书尽量占满可用预览区，不受「设计尺寸放大上限」约束（预览追求视觉大，几何实时可调）。
  // 可用区 = 视口 − 顶部任务栏 − 底部进度条行（再留少量边距）；两侧留出圆形翻页按钮空间。
  // 关键：翻页书四周还有一层白色缓冲画布（PAD_X/PAD_Y，用于避免翻页时页角被裁），
  // 必须把这层缓冲也纳入尺寸预算，保证「书体 + 四周白底」完整落在预览区内 —— 否则书一放大,
  // 白底向上溢出、穿帮到顶部任务栏。
  // 保持真实宽高比，单页同时满足「宽 + 2*PAD_X ≤ 可用宽」与「高 + 2*PAD_Y ≤ 可用高」双约束。
  // 高度按页面内容区计算（vh − 任务栏 − 上下留白），不按进度条占位整体扣一档；底部仅留薄悬浮区
  // OVERLAY_RESERVE 给进度条弹出落位，书体居中时不会被底部进度条遮挡。
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const TOOLBAR_H = 56;   // --layout-toolbar-height（与任务栏 CSS 变量一致）
  const NAV_SPACE = 180;  // 两侧圆形翻页按钮留白总宽
  const V_MARGIN = 12;    // 上下留白（不拥挤，进度条在底部悬浮区内，不占书体空间）
  const availW = Math.max(vw - NAV_SPACE, 320); // 对开可用宽
  const availH = Math.max(vh - TOOLBAR_H - OVERLAY_RESERVE - V_MARGIN, 240); // 书体可用高（含四周白底缓冲预算）
  const coverW = Math.floor(
    Math.min((availW - PAD_X * 2) / 2, (availH - PAD_Y * 2) * ar),
  );
  const spreadW = coverW * 2;
  const pageH = Math.round(coverW / ar);
  pageSizeRef.current = { coverW, spreadW, pageH };
  // 居中补偿：相册封面页自带左侧书脊，硬壳封面视觉重心偏左。把书体右侧视作「背面+右侧书脊」对称，
  // 封面右移 spinePx/2、封底左移 spinePx/2，使整本书（正面+书脊）以容器中心对称。
  const coverPage_ = pages.find((p) => p.pageKind === 'cover');
  const spinePx = coverPage_ && coverPage_.spineWidth ? (coverPage_.spineWidth * coverW) / mmW : 0;
  const coverCompX = spinePx / 2;

  // 动态页堆厚度（按对开进度）：左侧=已翻、右侧=未翻，随进度平滑变化；
  // 各设最小基础厚度，保证翻开时两侧都清晰可见（避免某侧为 0）。
  const spreads = Math.max(Math.ceil(total / 2), 1);
  const curSpread = Math.min(Math.floor(safePage / 2), spreads - 1);
  const progress = spreads > 1 ? curSpread / (spreads - 1) : 1;
  const MAX_STACK = 16;      // 单侧可达到的最大厚度（原26，收窄10px，变化更柔和）
  const BASE_STACK = 6;      // 侧边最小可见厚度（翻开时也显示，保证两侧始终可见）
  const stackLpx = BASE_STACK + progress * (MAX_STACK - BASE_STACK);       // 左：已翻页数
  const stackRpx = BASE_STACK + (1 - progress) * (MAX_STACK - BASE_STACK); // 右：未翻页数

  // ── 阶段切换与翻页控制 ──

  // 封面 → 翻页书：封面绕书脊（左）向左翻开的 3D 动效；
  // 无内容页（仅有封面+封底）：翻页书不存在，点击直接在「封面→封底」间切换。
  // 翻页书仍在生成（渐进式渲染首批未完成）时：标记 pendingOpen，就绪后自动翻开（不再静默忽略点击）。
  const toFlipFromCover = () => {
    if (!flipRef.current && !noContentPagesRef.current) {
      pendingOpenRef.current = true;
      return;
    }
    openFlipBook('front');
  };

  // 封底 → 翻页书：封底绕书脊（右）向右翻开的 3D 动效（镜像），回到末屏；
  // 无内容页（仅有封面+封底）：翻页书不存在，点击直接在「封底→封面」间切换
  const openFromBack = () => {
    if (!flipRef.current && !noContentPagesRef.current) {
      pendingOpenRef.current = true;
      return;
    }
    openFlipBook('back');
  };

  // 合书：翻页书向封面/封底方向收拢，随后切换到对应硬壳书板（与翻开动效互逆）
  const closeBook = (dir: 'front' | 'back') => {
    if (closingDir) return;
    setClosingDir(dir);
    setTimeout(() => {
      setClosingDir(null);
      setStage(dir === 'front' ? 'cover' : 'back');
    }, 460);
  };

  const handlePrev = () => {
    const flip = flipRef.current;
    if (!flip) return;
    // 首个对开再向前 → 合上回封面
    if (flip.getCurrentPageIndex() <= 0) {
      closeBook('front');
      return;
    }
    flip.flipPrev('bottom');
  };
  const handleNext = () => {
    const flip = flipRef.current;
    if (!flip) return;
    // 末个对开再向后 → 合上到封底
    if (flip.getCurrentPageIndex() >= totalPagesRef.current - 2) {
      closeBook('back');
      return;
    }
    flip.flipNext('bottom');
  };

  // 进度条拖拽跳页：PageProgressBar 回传 1-based 内容页序号(1..contentTotal)。
  // 书页索引 = 内容页号（索引0=前衬页，索引c=第c内容页）；右页为奇数索引。
  // 用 flip()（带动画的翻页）而非 turnToPage()（瞬移），保证点击/拖拽切换页时有翻页效果。
  const handleProgressToPage = (contentPage1: number) => {
    const pf = flipRef.current;
    if (!pf) return;
    const target = Math.min(Math.max(contentPage1, 1), contentTotal);
    if (target < 1 || target > (totalPagesRef.current - 2)) return;
    setStage('flip');
    setClosingDir(null);
    try {
      pf.flip(target, 'bottom');
    } catch {
      pf.turnToPage(target % 2 === 0 ? target : target - 1);
    }
  };

  // ── 衬页点击合书：首个对开点击左侧前衬页 → 合上回封面；末个对开点击右侧后衬页 → 合上到封底 ──
  const onBookMouseDown = (e: React.MouseEvent) => {
    downPosRef.current = { x: e.clientX, y: e.clientY };
  };
  const onBookClick = (e: React.MouseEvent) => {
    const down = downPosRef.current;
    downPosRef.current = null;
    if (!down) return;
    // 位移过大 = 拖拽翻页，不视为点击
    if (Math.abs(e.clientX - down.x) > 6 || Math.abs(e.clientY - down.y) > 6) return;
    const el = bookWrapRef.current;
    const flip = flipRef.current;
    if (!el || !flip || closingDir) return;
    const rect = el.getBoundingClientRect();
    const leftHalf = e.clientX < rect.left + rect.width / 2;
    const cur = flip.getCurrentPageIndex();
    const tot = totalPagesRef.current;
    if (cur <= 0 && leftHalf) closeBook('front');
    else if (cur >= tot - 2 && !leftHalf) closeBook('back');
  };

  // ── 封面/封底硬壳书板（真实页面内容 + 共享 HardcoverFrame 实物效果）──
  const renderCover = (
    // 书本单独居中（flex 只有一个子节点=按钮），点击提示用绝对定位覆盖在下方，
    // 不参与布局 —— 使封面书本中心与翻页书中心完全一致，进/出翻页时上下对齐。
    <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: OVERLAY_RESERVE }}>
      <button
        onClick={toFlipFromCover}
        className="group relative cursor-pointer border-none bg-transparent p-8 outline-none"
        title={t('editor.bookPreview.openCover')}
        style={{
          transition: 'transform 0.55s cubic-bezier(0.4,0.2,0.2,1), opacity 0.55s',
          transform: opening ? 'perspective(1400px) translateX(-38%) rotateY(-34deg)' : 'none',
          opacity: opening ? 0 : 1,
        }}
      >
        <div
          className="book-settle-front max-w-[66vw] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02] group-hover:-translate-y-1"
          style={{ width: coverW, marginLeft: coverCompX }}
        >
          <div className="w-full" style={{ aspectRatio: aspectCss }}>
            {coverImage ? (
              <HardcoverFrame className="w-full h-full">
                <img src={coverImage} alt={t('editor.bookPreview.coverAlt')} className="w-full h-full object-cover" draggable={false} />
              </HardcoverFrame>
            ) : (
              <div className="w-full h-full rounded-[2px] bg-[var(--color-gray-100)] animate-pulse" />
            )}
          </div>
        </div>
      </button>
    </div>
  );

  const renderBack = (
    <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: OVERLAY_RESERVE }}>
      <button
        onClick={openFromBack}
        className="group relative cursor-pointer border-none bg-transparent p-8 outline-none"
        title={t('editor.bookPreview.backToFlip')}
        style={{
          transition: 'transform 0.55s cubic-bezier(0.4,0.2,0.2,1), opacity 0.55s',
          transform: openingBack ? 'perspective(1400px) translateX(38%) rotateY(34deg)' : 'none',
          opacity: openingBack ? 0 : 1,
        }}
      >
        {/* 合上落定动效：绕右侧书脊轴（封底书脊在右）收拢落定 */}
        <div
          className="book-preview-close max-w-[66vw] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.02] group-hover:-translate-y-1"
          style={{ width: coverW, marginLeft: -coverCompX }}
        >
          <div className="w-full" style={{ aspectRatio: aspectCss }}>
            {backImage ? (
              <HardcoverFrame variant="back" className="w-full h-full">
                <img src={backImage} alt={t('editor.bookPreview.backAlt')} className="w-full h-full object-cover" draggable={false} />
              </HardcoverFrame>
            ) : (
              <div className="w-full h-full rounded-[2px] bg-[var(--color-gray-100)] animate-pulse" />
            )}
          </div>
        </div>
      </button>
    </div>
  );

  return (
    /* 白色大背景：编辑器入口位于编辑器顶部任务栏正下方（Toolbar 切预览态）；
       主页入口顶到窗口最上并自绘预览任务栏（isHomePreview），盖住主页 AppHeader */
    <div
      className="fixed left-0 right-0 bottom-0 z-[var(--z-modal)] flex flex-col bg-white"
      style={{ top: isHomePreview ? 0 : 'var(--layout-toolbar-height)' }}
    >
      {isHomePreview && (
        /* 预览态顶部任务栏（主页入口自绘，风格与编辑器预览态一致）：标题居中 + 退出预览 + 窗口控制 */
        <div
          data-tauri-drag-region
          className="h-[var(--layout-toolbar-height)] bg-[image:var(--gradient-header)] relative flex items-center px-4 gap-1 shrink-0 z-10 select-none"
        >
          <div className="flex-1" />
          {/* 相册标题：绝对居中 */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex justify-center min-w-0" data-no-drag>
            <span className="text-[var(--text-h3)] font-[700] text-[var(--color-gray-800)] truncate max-w-[320px] px-3">
              {topBarTitle}
            </span>
          </div>
          <div className="flex-1" />
          {/* 退出预览（与编辑器预览态按钮一致：关闭图标 + 文案） */}
          <button
            onClick={onClose}
            data-no-drag
            className="flex items-center gap-1.5 px-3 h-8 rounded-[var(--radius-lg)] bg-white/60 hover:bg-white/90 text-[12px] font-[600] text-[var(--color-gray-700)] border-none cursor-pointer transition-colors"
            title={t('editor.exitBookPreviewBtn')}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></svg>
            {t('editor.exitBookPreviewBtn')}
          </button>
          <WindowControls />
        </div>
      )}
      <style>{`
        /* 翻页画布容器：overflow 可见（el 四向外扩 PAD_X/PAD_Y 撑大缓冲，翻起的页角不被裁切） */
        .book-preview-flip {
          overflow: visible;
        }
        /* 画布光标与封面一致（可点击翻页） */
        .book-preview-flip canvas { cursor: pointer; }
        /* 书体投影层（精确贴合书体矩形）。z=30 置于翻页画布(z=10)之上：
           PageFlip 每帧会把整块画布（含外扩缓冲带）用白色 fillRect 刷为不透明，
           若投影位居画布之下，其外发散阴影会被画布白底盖住（表现为投影被遮挡）。
           此处阴影盒=书体大小、box-shadow 向书体外侧发散，提升层级不会覆盖书页内容，
           只在白底上显现——翻起页伸入缓冲带时会被轻微盖一层外阴影，属可接受表现。 */
        .book-body-shadow {
          pointer-events: none;
          z-index: 30;
          border-radius: 2px;
          box-shadow:
            0 2px 5px rgba(0,0,0,0.13),
            0 10px 26px rgba(0,0,0,0.15),
            0 28px 60px -14px rgba(0,0,0,0.24),
            0 56px 110px -28px rgba(0,0,0,0.16);
        }
        /* ── 左右页堆（书口）：真实纸张断面 = 逐页条纹 + 内衬色带 + 靠书芯压暗。
     z=31 置于翻页画布(z=10)之上，避免被画布整块白底盖住（方案 A：装饰永远可见） */
        .page-stack-left,
        .page-stack-right {
          position: absolute;
          top: 1px; bottom: 1px;
          pointer-events: none;
          z-index: 31;
          transition: width 0.5s cubic-bezier(0.33, 1, 0.68, 1);
          overflow: hidden;
        }
        .page-stack-left {
          left: -1px;
          transform: translateX(-100%);
          border-radius: 2.5px 0 0 2.5px;
          /* 纸页断面：约 2.2px/页的米白纸页 + 细缝阴影；叠加靠书芯（右侧）渐暗 */
          background:
            linear-gradient(90deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.08) 100%),
            repeating-linear-gradient(90deg,
              #faf6ec 0 1.6px, #ddd5c2 1.6px 2.2px);
          box-shadow:
            -3px 2px 8px rgba(0,0,0,0.18),
            -10px 14px 30px -8px rgba(0,0,0,0.22);
        }
        .page-stack-right {
          right: -1px;
          transform: translateX(100%);
          border-radius: 0 2.5px 2.5px 0;
          background:
            linear-gradient(90deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0) 45%),
            repeating-linear-gradient(90deg,
              #ddd5c2 0 0.6px, #faf6ec 0.6px 2.2px);
          box-shadow:
            3px 2px 8px rgba(0,0,0,0.18),
            10px 14px 30px -8px rgba(0,0,0,0.22);
        }
        /* 内衬色带（最外侧 1-2 页是米色衬页，贴在硬壳内侧） */
        .stack-endpaper {
          position: absolute;
          top: 0; bottom: 0;
          width: 4.5px;
          background: linear-gradient(90deg, #e8dfc8, #ded3b6);
          box-shadow: inset 0 0 0 0.5px rgba(0,0,0,0.06);
        }
        .page-stack-left .stack-endpaper { left: 0; }
        .page-stack-right .stack-endpaper { right: 0; }
        /* 书脊沟槽：双页交界的柔和阴影（对开书体感）。
           z=12 置于翻页画布(z=10)之上 —— 静态时叠在纸面中央还原沟槽阴影；
           翻页交互进行中（拖角/折叠/翻动）淡出，避免阴影压在翻起页上形成穿模 */
        .book-gutter {
          position: absolute;
          top: 0; bottom: 0; left: 50%;
          width: 7%;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 12;
          transition: opacity 0.25s ease;
          background: linear-gradient(90deg,
            rgba(0,0,0,0) 0%, rgba(0,0,0,0.06) 42%, rgba(0,0,0,0.10) 50%, rgba(0,0,0,0.06) 58%, rgba(0,0,0,0) 100%);
        }
        .book-gutter.gutter-hidden { opacity: 0; }
        /* 封面落定（从翻开状态合上，与封面翻开动效互逆） */
        @keyframes book-settle-front {
          from { opacity: 0.5; transform: perspective(1600px) rotateY(-20deg); }
          to { opacity: 1; transform: perspective(1600px) rotateY(0deg); }
        }
        .book-settle-front {
          transform-origin: left center;
          animation: book-settle-front 0.5s cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* 翻页书合书动效：向封面（左）/封底（右）收拢 */
        @keyframes book-close-left {
          to { opacity: 0; transform: perspective(1600px) translateX(-22%) rotateY(-30deg); }
        }
        @keyframes book-close-right {
          to { opacity: 0; transform: perspective(1600px) translateX(22%) rotateY(30deg); }
        }
        .book-closing-left {
          transform-origin: left center;
          animation: book-close-left 0.45s cubic-bezier(0.5, 0, 0.8, 0.4) forwards;
        }
        .book-closing-right {
          transform-origin: right center;
          animation: book-close-right 0.45s cubic-bezier(0.5, 0, 0.8, 0.4) forwards;
        }
        /* 封底落定（从翻开状态合上） */
        @keyframes book-preview-close {
          from { opacity: 0; transform: perspective(1600px) rotateY(14deg) scale(0.97); }
          to { opacity: 1; transform: perspective(1600px) rotateY(0deg) scale(1); }
        }
        .book-preview-close {
          transform-origin: right center;
          animation: book-preview-close 0.45s cubic-bezier(0.22, 1, 0.36, 1);
        }
      `}</style>

      {/* 内容区：翻页书始终挂载（未 ready 时 invisible），避免 containerRef 为 null */}
      <div className="flex-1 relative min-h-0">
        {/* 封面硬壳书板 */}
        {stage === 'cover' && renderCover}

        {/* 封底硬壳书板 */}
        {stage === 'back' && renderBack}

        {/* 翻页书（对开）：按钮绝对定位于两侧边缘（远离书体，留出空间感） */}
        <div className={`absolute inset-0 ${stage === 'flip' ? '' : 'invisible'}`}>
          <div className="w-full h-full flex items-center justify-center" style={{ paddingBottom: OVERLAY_RESERVE }}>
            <div
              ref={bookWrapRef}
              className={`relative cursor-pointer ${closingDir === 'front' ? 'book-closing-left' : closingDir === 'back' ? 'book-closing-right' : ''}`}
              // 宽 = 翻页书对开总宽 spreadW（=2×封面单页宽），宽高比与 PageFlip 画布完全一致（spreadW : pageH）
              style={{ width: spreadW, aspectRatio: `${spreadW} / ${pageH}` }}
              onMouseDown={onBookMouseDown}
              onClick={onBookClick}
            >
              {/* 书体投影层（精确贴合书体矩形） */}
              <div className="book-body-shadow absolute inset-0" />
              {/* 翻页书本体（PageFlip 挂载点）：不在这里写 style 的宽高/偏移 —— React 每次重渲染会按 JSX style 覆盖 el.style，
              清掉 applyFlipBuffer 手动设置的缓冲盒尺寸导致 el 缩回调到左上、页角再被裁且与页堆/书缘错位。
              尺寸/位置完全由 applyFlipBuffer 在初始化与 resize 时设置（React 不再触碰该元素内联样式，改动得以持久）。 */}
              <div ref={containerRef} className="book-preview-flip" />
              {/* 左页堆（已翻，外端为前内衬色带） */}
              <div className="page-stack-left" style={{ width: stackLpx }}>
                <div className="stack-endpaper" />
              </div>
              {/* 右页堆（未翻，外端为后内衬色带） */}
              <div className="page-stack-right" style={{ width: stackRpx }}>
                <div className="stack-endpaper" />
              </div>
              {/* 书脊沟槽静态阴影（翻动中淡出，避免压住翻起页） */}
              <div className={`book-gutter ${flipping ? 'gutter-hidden' : ''}`} />
            </div>
          </div>
          {/* 两侧圆形翻页按钮（照片查看大图样式，贴容器左右边缘） */}
          <div className="absolute left-7 top-1/2 -translate-y-1/2">
            <NavArrow dir="prev" onClick={handlePrev} label={t('editor.bookPreview.prev')} />
          </div>
          <div className="absolute right-7 top-1/2 -translate-y-1/2">
            <NavArrow dir="next" onClick={handleNext} label={t('editor.bookPreview.next')} />
          </div>
        </div>
        {/* 渐进式渲染进度：后台分批生成预览页面中（封面/翻页态都显示，浅色胶囊提示，不挡书不拦截点击） */}
        {renderProgress && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-white/85 backdrop-blur border border-[var(--color-border)] px-3.5 py-1.5 text-[12px] text-[var(--color-gray-600)] shadow-sm pointer-events-none select-none">
            <svg className="w-3.5 h-3.5 animate-spin text-[var(--color-brand)]" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
              <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            <span>{t('editor.bookPreview.generatingPages', { current: renderProgress.done, total: renderProgress.total })}</span>
          </div>
        )}

        {/* 底部悬浮区（不占布局，停于内容区底部薄悬浮区）。
          外层容器保持可交互以接收 hover 唤起（不能因隐藏而带 pointer-events-none，否则收不到鼠标事件）；
          内层进度条/快捷按钮在隐藏时才 pointer-events-none + 滑出。
          布局为整行：封面按钮在左、进度条占满中部（flex-1）、封底按钮在右，整体上移避免贴底。 */}
        {stage === 'flip' ? (
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center"
            style={{ height: FLOAT_BAR_H, paddingBottom: 8 }}
            onMouseEnter={showProgress}
            onMouseLeave={hideProgressDelayed}
          >
            <div
              className={`w-full max-w-[880px] mx-auto px-8 flex items-center gap-4 transition-all duration-500 ease-out ${
                progressVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none'
              }`}
            >
              <QuickJumpButton label={t('editor.bookPreview.goCover')} onClick={() => closeBook('front')} title={t('editor.bookPreview.goCover')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 5v14M5 12l7-7 7 7" /></svg>
              </QuickJumpButton>
              <div className="flex-1 min-w-0">
                <PageProgressBar value={contentCurrent} total={contentTotal} onToPage={handleProgressToPage} />
              </div>
              <QuickJumpButton label={t('editor.bookPreview.goBack')} onClick={() => closeBook('back')} title={t('editor.bookPreview.goBack')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M12 5v14M5 12l7 7 7-7" /></svg>
              </QuickJumpButton>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 底部悬浮快捷按钮（图标 + 文案）：一键返回封面/封底 */
function QuickJumpButton({
  label,
  onClick,
  title,
  children,
}: {
  label: string;
  onClick: () => void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-full bg-black/[0.05] text-[var(--color-gray-600)] border-none cursor-pointer text-[12px] transition-all duration-200 hover:bg-black/[0.09] hover:text-[var(--color-gray-800)] hover:scale-105 active:scale-95"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

/** 圆形翻页按钮（照片查看大图样式）：位于翻页书左右两侧 */
function NavArrow({ dir, onClick, label }: { dir: 'prev' | 'next'; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="shrink-0 w-12 h-12 flex items-center justify-center rounded-full bg-black/[0.04] text-[var(--color-gray-600)] border-none cursor-pointer backdrop-blur-[2px] transition-all duration-200 hover:bg-black/[0.08] hover:text-[var(--color-gray-800)] hover:scale-105 active:scale-95"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
        {dir === 'prev' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
      </svg>
    </button>
  );
}

/** 渲染单页为翻页书图片（复用缩略图渲染引擎）。albumSize 必须显式传入，
 *  否则 renderPageThumbnail 回退全局 store 尺寸，冷启动（store albumSize=null）会渲染失败返回 null。 */
async function renderSinglePage(
  page: AlbumPage,
  photos: Photo[],
  albumSize?: { width: number; height: number },
): Promise<string | null> {
  try {
    const photoImages = await preloadSharedPhotos([page], photos);
    const stickerImages = await preloadStickers(page);
    const bgBitmap = page.backgroundImage ? await loadBackgroundBitmap(page.backgroundImage) : null;
    try {
      return renderPageThumbnail(
        page,
        photos,
        1,
        photoImages,
        { baseWidth: 1440, noCache: true, cacheSuffix: 'book-cover', albumSize },
        stickerImages,
        bgBitmap ?? undefined,
      );
    } finally {
      releasePreloadedImages(photoImages);
      releaseStickerImages(stickerImages);
      if (bgBitmap instanceof ImageBitmap) bgBitmap.close();
    }
  } catch {
    return null;
  }
}

/** Promise 超时包装：超时返回 null，避免个别请求挂起阻塞整个预览 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((res) => setTimeout(() => res(null), ms))]);
}

/** 解析照片可加载 src（等价 resolveGridPhotoSrc，优先读库缩略图）。
 *  先复用已解析的 photo.src（data: 永不失效 / blob: 存活即用），
 *  可跳过冷启动时重新读取 IndexedDB 的耗时 → 封面/内容更快显示，不回落到灰占位。 */
async function resolvePhotoSrc(
  photo: Photo,
  readPhotoFromDB: (id: string) => Promise<string | null>,
  makeDirectPhotoUrl: (p: Photo) => Promise<string | null>,
  isBlobUrlAlive: (url: string) => boolean,
): Promise<string | null> {
  const aliveSrc = photo.src?.startsWith('data:')
    ? photo.src
    : (photo.src?.startsWith('blob:') && isBlobUrlAlive(photo.src) ? photo.src : null);
  if (aliveSrc) return aliveSrc;
  if (photo.storageMode === 'import') {
    const id = photo.thumbBlobId ?? photo.previewBlobId ?? photo.blobId ?? photo.originalBlobId;
    if (id) {
      const u = await withTimeout(readPhotoFromDB(id), 4000);
      if (u && u.startsWith('data:')) return u;
    }
    return photo.src || null;
  }
  if (photo.storageMode === 'direct') {
    const id = photo.thumbBlobId ?? photo.previewBlobId;
    if (id) {
      const u = await withTimeout(readPhotoFromDB(id), 4000);
      if (u && u.startsWith('data:')) return u;
    }
    if (photo.src?.startsWith('blob:') || photo.src?.startsWith('data:')) return photo.src;
    if (photo.relativePath) {
      const u = await withTimeout(readFileAsBlobUrl(photo.relativePath), 4000);
      if (u) return u;
    }
    return withTimeout(makeDirectPhotoUrl(photo), 4000);
  }
  return photo.src || null;
}

/**
 * 一次性预加载所有页面用到的照片（去重共享）。
 * 每张照片用带超时的 loadImage 加载，失败/超时则跳过，绝不阻塞整体渲染。
 */
async function preloadSharedPhotos(
  pages: AlbumPage[],
  photos: Photo[],
): Promise<Map<string, HTMLImageElement | ImageBitmap>> {
  const neededIds = new Set<string>();
  for (const p of pages) {
    for (const pl of p.placements) if (pl.photoId) neededIds.add(pl.photoId);
  }
  if (neededIds.size === 0) return new Map();
  const needed = photos.filter((p) => neededIds.has(p.id));
  if (needed.length === 0) return new Map();

  const result = new Map<string, HTMLImageElement | ImageBitmap>();
  const { readPhotoFromDB, makeDirectPhotoUrl, isBlobUrlAlive } = await import('../../engine/storage-engine');

  await Promise.all(
    needed.map(async (photo) => {
      try {
        const src = await resolvePhotoSrc(photo, readPhotoFromDB, makeDirectPhotoUrl, isBlobUrlAlive);
        if (!src) return;
        // 只接受 dataURL/blob（同源，可直接绘制）；其他（如 asset://）通过文件读取已转 blob
        const img = await withTimeout(loadImage(src, { timeout: 5000 }), 5000);
        if (!img || img.naturalWidth === 0) return;
        result.set(photo.id, img);
      } catch {
        // 单张照片失败跳过，不阻塞整体
      }
    }),
  );
  return result;
}

/**
 * 渲染一批内容页为翻页书图片（复用缩略图渲染引擎）。
 * 照片按批次共享预加载（去重，只加载本批用到的照片 → 渐进式渲染下首批/后台批次 I/O 更小）；
 * 页间让出主线程（setTimeout 0）保持界面响应，并逐页回调进度。
 * 内容页传入各自的绝对 pageIndex（并携带完整相册 pages 作水印判定）→ 启用水印；
 * 封面/封底由 renderSinglePage 处理，不传 pageIndex，故不显示水印。
 */
async function renderPageBatch(
  items: { p: AlbumPage; i: number }[],
  photos: Photo[],
  albumSize: { width: number; height: number } | undefined,
  watermarkPages: AlbumPage[],
  onPage?: (doneInBatch: number) => void,
): Promise<string[]> {
  if (items.length === 0) return [];
  const allPhotoImages = await preloadSharedPhotos(items.map((c) => c.p), photos);
  try {
    const results: string[] = [];
    for (let idx = 0; idx < items.length; idx++) {
      const { p, i } = items[idx];
      try {
        const stickerImages = await preloadStickers(p);
        const bgBitmap = p.backgroundImage ? await loadBackgroundBitmap(p.backgroundImage) : null;
        try {
          const img = renderPageThumbnail(
            p,
            photos,
            1,
            allPhotoImages,
            { baseWidth: 1440, noCache: true, cacheSuffix: 'book-preview', albumSize, pageIndex: i, watermarkPages },
            stickerImages,
            bgBitmap ?? undefined,
          );
          results.push(img ?? BLANK_PAGE_DATAURL);
        } finally {
          releaseStickerImages(stickerImages);
          if (bgBitmap instanceof ImageBitmap) bgBitmap.close();
        }
      } catch {
        results.push(BLANK_PAGE_DATAURL);
      }
      // 让出主线程：避免整批同步绘制卡死界面，也便于进度条刷新
      await new Promise((r) => setTimeout(r, 0));
      onPage?.(idx + 1);
    }
    return results;
  } finally {
    releasePreloadedImages(allPhotoImages);
  }
}

/** 渲染失败时的空白页面占位（避免翻页书缺页） */
const BLANK_PAGE_DATAURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** 渐进式渲染中尚未渲染完成的内容页占位（浅灰加载页），后台批次渲染完成后由真实页热替换 */
const LOADING_PAGE_DATAURL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="840">' +
    '<rect width="600" height="840" fill="#f2f3f5"/>' +
    '<rect x="0.5" y="0.5" width="599" height="839" fill="none" stroke="#e2e4e9"/>' +
    '</svg>'
  );

/** 精装书内衬页（空白幽色微纹理）：封面/封底内页，翻页书的边界页 */
function makeEndpaperDataUrl(): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="420">` +
    `<rect width="300" height="420" fill="#f6f3ec"/>` +
    `<rect width="300" height="420" fill="url(#g)"/>` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="#e7e1d3" stop-opacity="0.55"/>` +
    `</linearGradient></defs></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * 翻页进度条：展示当前内容页位置，支持拖拽跳页。
 * value 为当前内容页序号（1..total），toPage 拖拽后回调。
 */
function PageProgressBar({ value, total, onToPage }: { value: number; total: number; onToPage: (page: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const pct = total > 1 ? ((value - 1) / (total - 1)) * 100 : 0;

  const jumpFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || total < 1) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const page = Math.round(ratio * (total - 1)) + 1;
    onToPage(page);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    jumpFromClientX(e.clientX);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingRef.current) jumpFromClientX(e.clientX);
  };
  const onPointerUp = () => {
    draggingRef.current = false;
  };

  return (
    <div className="flex items-center gap-3 w-full min-w-0 px-3 select-none">
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative flex-1 h-1.5 rounded-full bg-[var(--color-gray-200)] cursor-pointer touch-none"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-brand)]"
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-[var(--color-brand)] border-2 border-white shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className="text-[12px] text-[var(--color-gray-500)] tabular-nums shrink-0">
        {value} / {total}
      </span>
    </div>
  );
}
