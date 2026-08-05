/**
 * ModalGuard — 弹窗打开时屏蔽背景元素的所有交互。
 *
 * 原理：
 * 弹窗打开时设置 document.body.style.pointerEvents = 'none'，
 * 所有背景元素不再接收任何指针事件（包括 :hover、mousedown、mousemove 等）。
 * 弹窗自身（遮罩 + 内容）通过 style.pointerEvents = 'auto' 恢复事件接收。
 *
 * 这比逐个拦截 window 级事件监听器更彻底：
 * CSS pointer-events 在浏览器层面阻止事件派发到目标元素，
 * window/document 级监听器也不会触发。
 */

let modalCount = 0;
let bodyOverflow = '';

export const ModalGuard = {
  /** 弹窗打开时调用 */
  open() {
    if (modalCount === 0) {
      // 锁定 body 所有指针事件，仅弹窗自身可接收
      document.body.style.pointerEvents = 'none';
      // 锁定背景滚动
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      // 清理残留的光标/选择样式
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    modalCount++;
  },

  /** 弹窗关闭时调用 */
  close() {
    modalCount = Math.max(0, modalCount - 1);
    if (modalCount === 0) {
      document.body.style.pointerEvents = '';
      document.body.style.overflow = bodyOverflow || '';
    }
  },

  get isActive() {
    return modalCount > 0;
  },
};
