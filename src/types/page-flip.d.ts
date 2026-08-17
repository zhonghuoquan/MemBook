/**
 * page-flip (StPageFlip) 类型声明
 * 该 npm 包仅提供编译后的 ESM bundle（page-flip.module.js），未附带 .d.ts，
 * 此处根据官方 API 补充最小可用类型声明。
 */
declare module 'page-flip' {
  export interface PageFlipSettings {
    /** 起始页索引 */
    startPage?: number;
    /** 尺寸模式：fixed=固定尺寸 / stretch=自适应容器 */
    size?: 'fixed' | 'stretch';
    /** 页面宽（px），与页面图片宽高比一致 */
    width?: number;
    /** 页面高（px） */
    height?: number;
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    /** 是否绘制翻页阴影 */
    drawShadow?: boolean;
    /** 翻页动画时长（ms） */
    flippingTime?: number;
    /** 竖版（单页居中）显示 */
    usePortrait?: boolean;
    startZIndex?: number;
    /** 是否自适应容器尺寸 */
    autoSize?: boolean;
    maxShadowOpacity?: number;
    /** 是否内置封面 */
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    showPageCorners?: boolean;
    disableFlipByClick?: boolean;
  }

  export interface FlipEventData {
    page: number;
    mode: string;
  }

  export interface FlipEvent {
    /**
     * flip 事件 data 为纯数字页码（PageFlip.updatePageIndex →
     * trigger('flip', this, newPage)）；init 事件 data 为 { page, mode }。
     */
    data: number | FlipEventData;
    object: PageFlip;
  }

  export class PageFlip {
    constructor(parentElement: HTMLElement, settings: PageFlipSettings);
    /** 从图片数组加载页面（每张图片代表一页） */
    loadFromImages(images: string[]): void;
    /** 从 HTML 元素数组加载页面 */
    loadFromHTML(htmlElements: HTMLElement[]): void;
    /** 更新图片页面（不重建实例） */
    updateFromImages(images: string[]): void;
    getPageCount(): number;
    getCurrentPageIndex(): number;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    /** 翻到指定页（带动画）：内部按目标页相对当前位置向前/后各翻一页落地，非瞬移（区别于 turnToPage） */
    flip(page: number, corner?: 'top' | 'bottom'): void;
    turnToPage(page: number): void;
    destroy(): void;
    /** 订阅事件：init / flip / changeState / changeOrientation / update */
    on(event: 'init' | 'flip' | 'changeState' | 'changeOrientation' | 'update', callback: (e: FlipEvent) => void): this;
    off(event: string): void;
    update(): void;
  }
}

/**
 * page-flip 的 ESM bundle。package.json 的 main/browser 均指向 UMD 版本
 * （挂在 window.St 上，命名导入会得到 undefined），需改用 ESM 入口。
 */
declare module 'page-flip/dist/js/page-flip.module.js' {
  export * from 'page-flip';
}