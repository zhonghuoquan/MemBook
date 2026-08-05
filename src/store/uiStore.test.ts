/**
 * uiStore — UI 状态管理测试
 *
 * 核心断言：
 * 1. toast 管理：addToast → removeToast
 * 2. canvasZoom 边界：clamp 到 0.1 ~ 5
 * 3. gridZoom 边界：clamp 到 0.5 ~ 3.0
 * 4. 多选模式：enterMultiSelect → toggleProjectSelect → exitMultiSelect
 * 5. storageMode 持久化：setStorageMode → localStorage
 * 6. panelWidth 边界：clamp 到 MIN_PANEL_WIDTH ~ MAX_PANEL_WIDTH
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, loadStorageMode } from './uiStore';
import { STORAGE_MODE_KEY } from '../types';
import { MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from '../config/appConfig';

describe('useUIStore — Toast 管理', () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
  });

  it('addToast 添加 toast，自动生成 id', () => {
    useUIStore.getState().addToast({ type: 'success', message: 'hello' });
    const { toasts } = useUIStore.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].message).toBe('hello');
    expect(toasts[0].id).toBeTruthy();
  });

  it('removeToast 按 id 移除', () => {
    useUIStore.getState().addToast({ type: 'error', message: 'fail' });
    const { toasts } = useUIStore.getState();
    expect(toasts).toHaveLength(1);

    useUIStore.getState().removeToast(toasts[0].id);
    expect(useUIStore.getState().toasts).toHaveLength(0);
  });

  it('多次 addToast 累加', () => {
    useUIStore.getState().addToast({ type: 'info', message: 'a' });
    useUIStore.getState().addToast({ type: 'info', message: 'b' });
    useUIStore.getState().addToast({ type: 'info', message: 'c' });
    expect(useUIStore.getState().toasts).toHaveLength(3);
  });
});

describe('useUIStore — canvasZoom 边界', () => {
  it('setCanvasZoom 正常值', () => {
    useUIStore.getState().setCanvasZoom(2.5);
    expect(useUIStore.getState().canvasZoom).toBe(2.5);
  });

  it('setCanvasZoom 低于 0.1 被 clamp 到 0.1', () => {
    useUIStore.getState().setCanvasZoom(0.01);
    expect(useUIStore.getState().canvasZoom).toBe(0.1);
  });

  it('setCanvasZoom 高于 5 被 clamp 到 5', () => {
    useUIStore.getState().setCanvasZoom(10);
    expect(useUIStore.getState().canvasZoom).toBe(5);
  });
});

describe('useUIStore — gridZoom 边界', () => {
  it('setGridZoom 正常值', () => {
    useUIStore.getState().setGridZoom(1.5);
    expect(useUIStore.getState().gridZoom).toBe(1.5);
  });

  it('setGridZoom 低于 0.5 被 clamp 到 0.5', () => {
    useUIStore.getState().setGridZoom(0.1);
    expect(useUIStore.getState().gridZoom).toBe(0.5);
  });

  it('setGridZoom 高于 3.0 被 clamp 到 3.0', () => {
    useUIStore.getState().setGridZoom(5);
    expect(useUIStore.getState().gridZoom).toBe(3.0);
  });
});

describe('useUIStore — 多选模式', () => {
  beforeEach(() => {
    useUIStore.getState().exitMultiSelect();
  });

  it('enterMultiSelect 带初始 ID', () => {
    useUIStore.getState().enterMultiSelect('proj-1');
    const { multiSelectMode, selectedProjectIds } = useUIStore.getState();
    expect(multiSelectMode).toBe(true);
    expect(selectedProjectIds).toEqual(['proj-1']);
  });

  it('toggleProjectSelect 添加/移除', () => {
    useUIStore.getState().enterMultiSelect('a');
    useUIStore.getState().toggleProjectSelect('b');
    expect(useUIStore.getState().selectedProjectIds).toEqual(['a', 'b']);

    useUIStore.getState().toggleProjectSelect('a');
    expect(useUIStore.getState().selectedProjectIds).toEqual(['b']);
  });

  it('selectAll 覆盖全部', () => {
    useUIStore.getState().enterMultiSelect();
    useUIStore.getState().selectAll(['x', 'y', 'z']);
    expect(useUIStore.getState().selectedProjectIds).toEqual(['x', 'y', 'z']);
  });

  it('exitMultiSelect 清空', () => {
    useUIStore.getState().enterMultiSelect('a');
    useUIStore.getState().exitMultiSelect();
    expect(useUIStore.getState().multiSelectMode).toBe(false);
    expect(useUIStore.getState().selectedProjectIds).toEqual([]);
  });
});

describe('useUIStore — storageMode 持久化', () => {
  it('setStorageMode 写入 localStorage', () => {
    useUIStore.getState().setStorageMode('direct');
    expect(useUIStore.getState().storageMode).toBe('direct');
    expect(localStorage.getItem(STORAGE_MODE_KEY)).toBe('direct');
  });

  it('setStorageMode(null) 清除 localStorage', () => {
    useUIStore.getState().setStorageMode('import');
    useUIStore.getState().setStorageMode(null);
    expect(useUIStore.getState().storageMode).toBeNull();
    expect(localStorage.getItem(STORAGE_MODE_KEY)).toBeNull();
  });

  it('loadStorageMode 读取已保存的值', () => {
    localStorage.setItem(STORAGE_MODE_KEY, 'import');
    expect(loadStorageMode()).toBe('import');
  });

  it('loadStorageMode 无值时返回 null', () => {
    localStorage.removeItem(STORAGE_MODE_KEY);
    expect(loadStorageMode()).toBeNull();
  });
});

describe('useUIStore — panelWidth 边界', () => {
  it('setPanelWidth 正常值', () => {
    useUIStore.getState().setPanelWidth(400);
    expect(useUIStore.getState().panelWidth).toBe(400);
  });

  it('setPanelWidth 低于 MIN 被 clamp', () => {
    useUIStore.getState().setPanelWidth(100);
    expect(useUIStore.getState().panelWidth).toBe(MIN_PANEL_WIDTH);
  });

  it('setPanelWidth 高于 MAX 被 clamp', () => {
    useUIStore.getState().setPanelWidth(1000);
    expect(useUIStore.getState().panelWidth).toBe(MAX_PANEL_WIDTH);
  });
});

describe('useUIStore — toggleBottomNav', () => {
  it('expanded ↔ collapsed 切换', () => {
    useUIStore.setState({ bottomNav: 'expanded' });
    useUIStore.getState().toggleBottomNav();
    expect(useUIStore.getState().bottomNav).toBe('collapsed');

    useUIStore.getState().toggleBottomNav();
    expect(useUIStore.getState().bottomNav).toBe('expanded');
  });
});
