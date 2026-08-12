/**
 * OrganizePanel - 照片整理面板（多路径标签版）
 *
 * 支持同时打开多个路径（如同浏览器标签页），最多 MAX_TABS 个：
 * - 顶部标签栏展示每个已打开的路径，当前路径高亮，右侧提供关闭按钮
 * - 点击标签切换当前操作的路径，工具区始终作用于激活标签
 * - 「+ 添加路径」按钮打开新的文件夹并新增标签
 * - 关闭标签时释放该路径在 Web 模式下的 blob URL
 *
 * 持久化（localStorage）：
 * - 已打开的路径元信息持久化，切换页面返回后自动恢复并重新扫描
 * - 最近打开的 10 个路径作为历史，空状态下提供快捷重开入口
 *
 * 主面板负责：数据源选择（文件夹/库）、扫描、重新扫描
 * 四个工具（去重/归类/改EXIF/转换）由 organize/ 子组件实现
 */

import { useState, useCallback, useRef, useEffect, useMemo, startTransition } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import {
  isTauri,
  formatBytes,
  readExifDateWithFallback,
  type PhotoFileInfo,
  type ToolProgress,
  type DataSourceMode,
  type DedupeResult,
} from '../../photo-tools';
import { useUIStore } from '../../store';
import { ProgressBar, ToolCard, AddToAlbumButton, IMAGE_EXTS, getExt, extToMimeType, FEATURE_COLORS, countByExt, type ToolProps } from './organize/shared';
import { DedupeTool } from './organize/DedupeTool';
import { OrganizeTool } from './organize/OrganizeTool';
import { ExifTool } from './organize/ExifTool';
import { ConvertTool } from './organize/ConvertTool';
import { SimilarTool } from './organize/SimilarTool';
import { ScreenshotTool } from './organize/ScreenshotTool';
import { RenameTool } from './organize/RenameTool';
import { FaceClusterTool } from './organize/FaceClusterTool';
import { TimelineView } from './organize/TimelineView';
import { CalendarView } from './organize/CalendarView';
import { AlbumBridgeDialog } from './organize/AlbumBridgeDialog';
import { LibraryPickerDialog } from './organize/LibraryPickerDialog';
import { ToolSidebar, type ToolId, type ToolStatus } from './organize/ToolSidebar';
import { loadPhotos } from '../../db';
import type { AlbumProject, Photo } from '../../types';
import { logger } from '../../utils/logger';
import { STORAGE_KEYS } from '../../config/appConfig';

const MAX_TABS = 20;
/** 历史路径最多保存条数 */
const MAX_HISTORY = 10;

const SUPPORTED_FOLDER_EXTS = new Set([
  ...IMAGE_EXTS, '.raw', '.cr2', '.nef', '.arw', '.dng',
]);

/**
 * 扩展 Window 以支持 File System Access API 的 showDirectoryPicker。
 * 仅在 Web 模式下使用（Tauri 模式走插件对话框）。
 */
interface WindowWithDirectoryPicker {
  showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
}

/** 单个已打开路径标签 */
interface PathTab {
  id: string;
  /** 文件夹名（短名，用于标签展示） */
  name: string;
  /** Tauri 文件夹根路径（Web 模式为 null） */
  rootPath: string | null;
  /** Web 端文件夹句柄（Tauri 模式为 null） */
  folderHandle: FileSystemDirectoryHandle | null;
  /** 数据来源模式：'folder' = 文件夹扫描，'library' = 项目库内照片 */
  sourceMode: DataSourceMode;
  /** 库内模式：项目 ID（用于重新加载） */
  projectId?: string;
  photos: PhotoFileInfo[];
  scanning: boolean;
  scanProgress: ToolProgress | null;
}

/** 持久化的标签元信息（不含运行时数据，用于跨页面恢复） */
interface PersistedTab {
  id: string;
  name: string;
  /** folder 模式：Tauri 路径；library 模式：null */
  rootPath: string | null;
  sourceMode: DataSourceMode;
  /** library 模式：项目 ID */
  projectId?: string;
}

/** 历史路径条目（最近打开过的路径，用于快捷重开） */
interface HistoryEntry {
  /** folder 模式：Tauri 路径；library 模式：项目 ID */
  path: string;
  name: string;
  sourceMode: DataSourceMode;
  /** 最近打开时间戳，用于排序 */
  openedAt: number;
}

function folderBaseName(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const parts = norm.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

// ── localStorage 持久化辅助 ──────────────────────────────

/** 读取持久化的标签元信息 */
function loadPersistedTabs(): PersistedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ORGANIZE_TABS);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 过滤掉无效条目（缺关键字段）
    return arr.filter(
      (t): t is PersistedTab =>
        t && typeof t.id === 'string' && typeof t.name === 'string' &&
        (t.sourceMode === 'folder' || t.sourceMode === 'library'),
    );
  } catch {
    return [];
  }
}

/** 保存标签元信息（仅可序列化字段） */
function savePersistedTabs(tabs: PathTab[]): void {
  try {
    const persisted: PersistedTab[] = tabs.map((t) => ({
      id: t.id,
      name: t.name,
      rootPath: t.rootPath,
      sourceMode: t.sourceMode,
      projectId: t.projectId,
    }));
    localStorage.setItem(STORAGE_KEYS.ORGANIZE_TABS, JSON.stringify(persisted));
  } catch { /* ignore quota errors */ }
}

/** 读取历史路径列表 */
function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ORGANIZE_HISTORY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (e): e is HistoryEntry =>
        e && typeof e.path === 'string' && typeof e.name === 'string' &&
        (e.sourceMode === 'folder' || e.sourceMode === 'library'),
    );
  } catch {
    return [];
  }
}

/**
 * 记录一条历史路径（去重，保留最近 MAX_HISTORY 个）。
 * 同 path 的旧记录会被移到最前并更新时间戳。
 */
function addHistory(entry: HistoryEntry): HistoryEntry[] {
  const list = loadHistory().filter((e) => e.path !== entry.path);
  list.unshift(entry);
  const trimmed = list.slice(0, MAX_HISTORY);
  try {
    localStorage.setItem(STORAGE_KEYS.ORGANIZE_HISTORY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
  return trimmed;
}

/** 移除指定路径的历史记录 */
function removeHistoryEntry(path: string): HistoryEntry[] {
  const list = loadHistory().filter((e) => e.path !== path);
  try {
    localStorage.setItem(STORAGE_KEYS.ORGANIZE_HISTORY, JSON.stringify(list));
  } catch { /* ignore */ }
  return list;
}

/**
 * 从 localStorage 恢复可恢复的标签元信息为 PathTab（带运行时占位）。
 * 仅恢复 Tauri 端的 folder 标签和 library 标签（Web 端 folderHandle 无法序列化恢复）。
 * 同步执行，供 useState 初始化使用，避免在 effect 中同步 setState。
 */
function restoreTabsFromStorage(): PathTab[] {
  const persisted = loadPersistedTabs();
  const restorable = persisted.filter(
    (p) => p.sourceMode === 'library' || (p.sourceMode === 'folder' && p.rootPath && isTauri()),
  );
  if (restorable.length === 0) return [];
  return restorable.map((p) => ({
    id: p.id,
    name: p.name,
    rootPath: p.rootPath,
    folderHandle: null,
    sourceMode: p.sourceMode,
    projectId: p.projectId,
    photos: [],
    scanning: true,
    scanProgress: { phase: 'scanning', current: 0, total: 0, message: i18n.t('organize.scan.restoring') } as ToolProgress,
  }));
}

/**
 * 将库内 Photo 记录转换为 PhotoFileInfo（供整理工具使用）。
 * - blobId 优先取 originalBlobId（高清原图），用于去重/EXIF/转换读取原始数据
 * - Tauri direct 模式且有 relativePath 时，设置 path 以便直接读文件
 */
function photoToFileInfo(p: Photo): PhotoFileInfo {
  const ext = getExt(p.name);
  return {
    id: p.id,
    name: p.name,
    size: p.fileSize ?? 0,
    ext,
    mimeType: extToMimeType(ext),
    photoId: p.id,
    blobId: p.originalBlobId || p.blobId,
    dateTaken: p.date,
    gpsLon: p.longitude,
    gpsLat: p.latitude,
    width: p.width,
    height: p.height,
    path: p.relativePath && isTauri() && p.storageMode === 'direct' ? p.relativePath : undefined,
  };
}

interface OrganizePanelProps {
  /** 当前整理面板是否处于可见（激活）状态；仅当用户真正进入“照片整理”页时才触发恢复扫描 */
  active?: boolean;
}

export function OrganizePanel({ active = false }: OrganizePanelProps) {
  const { t } = useTranslation();
  const addToast = useUIStore((s) => s.addToast);

  // ---- 多路径标签状态 ----
  // 使用 lazy initializer 在初始化时同步恢复 localStorage 中的标签，避免 effect 中 setState
  const [tabs, setTabs] = useState<PathTab[]>(restoreTabsFromStorage);
  // activeTabId 初始指向第一个恢复的标签（若有）
  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const restored = restoreTabsFromStorage();
    return restored.length > 0 ? restored[0].id : null;
  });
  // 最近打开过的路径历史（用于 EmptyState 快捷重开）
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  // 工具执行中状态汇总：记录哪些工具名处于 busy（任一非空即锁定标签切换）
  // 修复：原 busyTabId 单值会被多个工具的 onBusyChange(false) 覆盖，改用 Set 按工具名汇总
  const [busyTools, setBusyTools] = useState<Set<string>>(new Set());
  const isAnyToolBusy = busyTools.size > 0;

  // ── 工具状态追踪（扫描中/已完成），用于侧栏按钮状态指示 ──
  const [toolStatuses, setToolStatuses] = useState<Map<ToolId, ToolStatus>>(new Map());
  // ── 已访问工具集合（懒挂载：首次切换到某工具时才渲染，之后保持挂载以保留状态） ──
  const [visitedTools, setVisitedTools] = useState<Set<ToolId>>(new Set(['dedupe']));

  // ── 视图模式 + 一键成册联动状态 ──
  // activeTool 取代原 viewMode：左侧导航选中的工具 ID（dedupe/organize/.../timeline/calendar）
  // 默认 'dedupe'（首个智能整理工具），保证进入面板后右侧工作区有内容
  const [activeTool, setActiveTool] = useState<ToolId>('dedupe');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [albumBridgeOpen, setAlbumBridgeOpen] = useState(false);
  // 时间线 → 日历跳转的初始月份（跳转后清空，避免后续切换日历视图时仍定位到旧月份）
  const [calendarInitialView, setCalendarInitialView] = useState<{ year: number; month: number } | undefined>();

  // 去重结果按标签持久化（提升到面板级别，切换标签不丢失）
  // key = tabId, value = { result, overrides }
  const [dedupeStates, setDedupeStates] = useState<
    Map<string, { result: DedupeResult | null; overrides: Record<string, Set<number>> }>
  >(new Map());
  const activeDedupeState = activeTabId
    ? (dedupeStates.get(activeTabId) ?? { result: null, overrides: {} })
    : { result: null, overrides: {} };

  /** 更新当前标签的去重状态（result + overrides 一起更新，避免分步调用导致中间态） */
  const setDedupeState = useCallback(
    (tabId: string, result: DedupeResult | null, overrides: Record<string, Set<number>>) => {
      setDedupeStates((prev) => {
        const next = new Map(prev);
        if (result === null && Object.keys(overrides).length === 0) {
          next.delete(tabId);
        } else {
          next.set(tabId, { result, overrides });
        }
        return next;
      });
    },
    [],
  );

  /** 清除指定标签的去重状态（关闭标签 / 重新扫描时调用） */
  const clearDedupeState = useCallback((tabId: string) => {
    setDedupeStates((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const scanningAny = tabs.some((t) => t.scanning);

  // ── “一键分析”状态：自动依次运行 去重 → 人脸识别 → 相似照片分析 ──
  const AUTO_ANALYZE_TOOLS: ToolId[] = ['dedupe', 'faceCluster', 'similar'];
  // 当前“一键分析”进行到的工具（'idle' 表示未在运行）
  const [autoAnalyzeStep, setAutoAnalyzeStep] = useState<ToolId | 'idle'>('idle');
  // 触发令牌：每次推进/启动都递增，各工具据此自动开始
  const [autoAnalyzeToken, setAutoAnalyzeToken] = useState(0);
  const [autoAnalyzeRunning, setAutoAnalyzeRunning] = useState(false);
  // 记录本轮“一键分析”中已真正开始运行的工具（用于区分“尚未开始”与“已完成”）
  const autoAnalyzeStartedRef = useRef<Set<ToolId>>(new Set());

  /** 点击“一键分析”：按顺序触发 去重 → 人脸识别 → 相似照片分析 */
  const handleOneClickAnalyze = useCallback(() => {
    const photos = activeTab?.photos ?? [];
    if (photos.length === 0) {
      addToast({ type: 'warning', message: t('organize.autoAnalyze.empty', '请先添加照片路径') });
      return;
    }
    if (autoAnalyzeRunning || isAnyToolBusy) {
      addToast({ type: 'warning', message: t('organize.autoAnalyze.busy', '已有工具正在运行，请稍候') });
      return;
    }
    autoAnalyzeStartedRef.current = new Set();
    setAutoAnalyzeRunning(true);
    setAutoAnalyzeStep('dedupe');
    setAutoAnalyzeToken((n) => n + 1);
    setActiveTool('dedupe');
    addToast({ type: 'info', message: t('organize.autoAnalyze.start', '开始一键分析：去重 → 人脸识别 → 相似照片') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, autoAnalyzeRunning, isAnyToolBusy, addToast, t]);

  // “一键分析”推进：当前目标工具真正开始并完成后，才自动切到下一个工具
  useEffect(() => {
    if (!autoAnalyzeRunning || autoAnalyzeStep === 'idle') return;
    const current = autoAnalyzeStep;
    // 当前工具正在运行 → 标记已开始，等待完成
    if (busyTools.has(current)) {
      autoAnalyzeStartedRef.current.add(current);
      return;
    }
    // 当前工具尚未真正开始（自动触发有异步延迟）→ 等待它开始；若始终未开始则兜底跳过
    if (!autoAnalyzeStartedRef.current.has(current)) {
      const timer = setTimeout(() => {
        // 4 秒后仍未开始（如照片数量不满足该工具运行条件）→ 视为跳过，继续下一步
        const idx = AUTO_ANALYZE_TOOLS.indexOf(current);
        if (idx >= 0 && idx < AUTO_ANALYZE_TOOLS.length - 1) {
          const next = AUTO_ANALYZE_TOOLS[idx + 1];
          setAutoAnalyzeStep(next);
          setAutoAnalyzeToken((n) => n + 1);
          setActiveTool(next);
        } else {
          setAutoAnalyzeRunning(false);
          setAutoAnalyzeStep('idle');
          autoAnalyzeStartedRef.current = new Set();
        }
      }, 4000);
      return () => clearTimeout(timer);
    }
    // 当前工具已完成 → 推进到下一个
    const idx = AUTO_ANALYZE_TOOLS.indexOf(current);
    if (idx === -1) return;
    if (idx >= AUTO_ANALYZE_TOOLS.length - 1) {
      // 全部完成
      setAutoAnalyzeRunning(false);
      setAutoAnalyzeStep('idle');
      autoAnalyzeStartedRef.current = new Set();
      addToast({ type: 'success', message: t('organize.autoAnalyze.done', '一键分析完成') });
      return;
    }
    const next = AUTO_ANALYZE_TOOLS[idx + 1];
    setAutoAnalyzeStep(next);
    setAutoAnalyzeToken((n) => n + 1);
    setActiveTool(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAnalyzeRunning, autoAnalyzeStep, busyTools, addToast, t]);

  // 选中照片列表（从 activeTab.photos 中按 ID 过滤，用于一键成册联动）
  const selectedPhotos = useMemo(() => {
    if (selectedPhotoIds.size === 0 || !activeTab) return [];
    return activeTab.photos.filter((p) => selectedPhotoIds.has(p.id));
  }, [selectedPhotoIds, activeTab]);

  // 切换标签时清空选中状态 + 重置工具状态（不同标签的照片集不同，旧结果无效）
  useEffect(() => {
    setSelectedPhotoIds(new Set());
    setVisitedTools(new Set([activeTool]));
    setToolStatuses(new Map());
  }, [activeTabId]);

  // 访问新工具时加入 visitedTools（懒挂载：首次访问才渲染，之后保持挂载保留状态）
  useEffect(() => {
    setVisitedTools((prev) => {
      if (prev.has(activeTool)) return prev;
      const next = new Set(prev);
      next.add(activeTool);
      return next;
    });
  }, [activeTool]);

  // 日历初始视图清理：CalendarView 在 mount 时通过 useState lazy initializer 消费 initialView，
  // 消费后立即清除，避免后续 CalendarView 重新挂载（如切到 tools 再切回 calendar）时仍跳转到旧月份
  useEffect(() => {
    if (!calendarInitialView) return;
    const id = setTimeout(() => setCalendarInitialView(undefined), 0);
    return () => clearTimeout(id);
  }, [calendarInitialView]);

  // 用 ref 跟踪 tabs，避免在释放 blob URL 时闭包过期
  // 必须在 effect 中同步，禁止在 render 期间更新 ref（React 19 严格规则）
  const tabsRef = useRef<PathTab[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  /** 更新指定标签 */
  const setTabState = useCallback(
    (id: string, updater: (tab: PathTab) => PathTab) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
    },
    [],
  );

  /** 释放指定标签的 blob URL（Web 模式） */
  const releaseTabBlobUrls = useCallback((tab: PathTab) => {
    tab.photos.forEach((p) => {
      if (p.thumbUrl) URL.revokeObjectURL(p.thumbUrl);
    });
  }, []);

  // ── 持久化：tabs 变化时保存路径元信息 ──
  useEffect(() => {
    savePersistedTabs(tabs);
  }, [tabs]);

  // 恢复 useEffect 已下移至 scanFolderTauri 声明之后（避免 TDZ 引用错误）
  const restoredRef = useRef(false);

  // ── 统一数据读取函数（传给子工具） ──────────────────────

  const readPhotoData = useCallback(
    async (photo: PhotoFileInfo, length?: number): Promise<ArrayBuffer | null> => {
      try {
        if (isTauri() && photo.path) {
          const { readFile } = await import('@tauri-apps/plugin-fs');
          const buf = await readFile(photo.path);
          // Tauri readFile 返回 Uint8Array，提取底层 ArrayBuffer
          const ab =
            buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength
              ? buf.buffer
              : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          return length ? ab.slice(0, Math.min(length, ab.byteLength)) : ab;
        }
        if (photo.thumbUrl) {
          const resp = await fetch(photo.thumbUrl);
          const buf = await resp.arrayBuffer();
          return length ? buf.slice(0, length) : buf;
        }
        // library 模式：通过 blobId 从 IndexedDB 读取照片数据
        if (photo.blobId) {
          const { readPhotoFromDB } = await import('../../engine/storage/import-store');
          const url = await readPhotoFromDB(photo.blobId);
          if (url) {
            const resp = await fetch(url);
            const buf = await resp.arrayBuffer();
            return length ? buf.slice(0, length) : buf;
          }
        }
      } catch (err) {
        logger.warn('[readPhotoData]', err);
      }
      return null;
    },
    [],
  );

  /**
   * 子工具更新指定标签 photos 列表的回调
   * 不依赖 activeTabId 闭包，而是通过 setTabs 函数式更新作用于当前激活标签，
   * 避免工具执行中切换标签后数据写错 tab。
   */
  const onPhotosUpdate = useCallback(
    (updater: (prev: PhotoFileInfo[]) => PhotoFileInfo[]) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId ? { ...t, photos: updater(t.photos) } : t,
        ),
      );
    },
    [activeTabId],
  );

  // ── 扫描文件夹 ────────────────────────────────────────

  /** Tauri 端扫描文件夹（写入指定标签） */
  const scanFolderTauri = useCallback(async (folderPath: string, tabId: string) => {
    const scanningMsg = t('organize.scan.scanningFolder');
    setTabState(tabId, (tab) => ({
      ...tab,
      scanning: true,
      photos: [],
      scanProgress: { phase: 'scanning', current: 0, total: 0, message: scanningMsg },
    }));

    // Rust 端扫描进度事件监听器（在 finally 中统一清理，防止 invoke 失败时泄漏）
    let unlisten: (() => void) | null = null;
    // rAF 节流变量提到 try 外，catch 中也需要 cancel
    let pendingProgress: { current: number; message: string } | null = null;
    let rafId = 0;
    // scanDone 标志：扫描结束后阻止延迟 flush 的 rAF 覆盖 scanProgress: null
    let scanDone = false;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // 监听 Rust 端实时推送的扫描进度事件
      // Rust 端已节流（每 50 张 emit 一次），前端再用 rAF 合并密集事件
      // 防止事件风暴导致 React 频繁重渲染
      const flushProgress = () => {
        rafId = 0;
        if (scanDone || !pendingProgress) return;
        const { current, message } = pendingProgress;
        pendingProgress = null;
        setTabState(tabId, (tab) => ({
          ...tab,
          scanProgress: {
            phase: 'scanning',
            current,
            total: 0,
            message: t('organize.scan.scannedCount', { count: current, name: message }),
          },
        }));
      };

      unlisten = await listen<{ current: number; message: string }>(
        'organize://scan-progress',
        (event) => {
          if (scanDone) return;
          pendingProgress = event.payload;
          if (rafId === 0) {
            rafId = requestAnimationFrame(flushProgress);
          }
        },
      );

      // 一次性 IPC 调用 Rust 端 scan_photos_with_exif：
      // Rust 端递归遍历 + 用 kamadak-exif 读取 EXIF 日期/GPS
      // 相比 JS 方案（每文件 4 次 IPC + exifr 解析），性能提升 10-50 倍
      setTabState(tabId, (tab) => ({
        ...tab,
        scanProgress: {
          phase: 'scanning',
          current: 0,
          total: 0,
          message: t('organize.scan.scanning', { folder: folderPath }),
        },
      }));

      interface RustPhotoScanItem {
        path: string;
        name: string;
        size: number;
        ext: string;
        relative_path: string;
        date_taken: string | null;
        gps_lat: number | null;
        gps_lon: number | null;
        needs_js_fallback: boolean;
      }

      const rustResults: RustPhotoScanItem[] = await invoke('scan_photos_with_exif', {
        folderPath,
      });

      // 收集 needs_js_fallback 的文件：kamadak-exif 解析失败（如美图秀秀非标准 IFD 链）
      // 用 exifr 重新解析（exifr 更宽松，能跳过损坏的 IFD 链）
      // 并发化（8 worker）避免大量 fallback 文件串行 IO 卡顿
      const fallbackItems = rustResults.filter((r) => r.needs_js_fallback);
      const fallbackDates = new Map<string, { date?: string; lat?: number; lon?: number }>();

      if (fallbackItems.length > 0) {
        const { open } = await import('@tauri-apps/plugin-fs');
        const FALLBACK_CONCURRENCY = 8;
        let fbNextIdx = 0;
        const fbWorker = async () => {
          while (true) {
            const idx = fbNextIdx++;
            if (idx >= fallbackItems.length) break;
            const item = fallbackItems[idx];
            try {
              const fh = await open(item.path, { read: true });
              try {
                const headBuf = new Uint8Array(Math.min(65536, item.size));
                const bytesRead = await fh.read(headBuf);
                const validBuf = bytesRead && bytesRead > 0
                  ? (bytesRead < headBuf.length ? headBuf.subarray(0, bytesRead) : headBuf)
                  : null;
                if (validBuf) {
                  const dateStr = await readExifDateWithFallback(validBuf, item.name);
                  fallbackDates.set(item.path, { date: dateStr ?? undefined });
                }
              } finally {
                try { await fh.close(); } catch { /* ignore */ }
              }
            } catch {
              // exifr 也失败，静默处理
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(FALLBACK_CONCURRENCY, fallbackItems.length) }, () => fbWorker()),
        );
      }

      const results: PhotoFileInfo[] = rustResults.map((r) => {
        const fb = fallbackDates.get(r.path);
        return {
          id: r.path,
          name: r.name,
          size: r.size,
          ext: r.ext,
          mimeType: extToMimeType(r.ext),
          path: r.path,
          relativePath: r.relative_path,
          dateTaken: r.date_taken ?? fb?.date,
          gpsLat: r.gps_lat ?? fb?.lat,
          gpsLon: r.gps_lon ?? fb?.lon,
        };
      });

      // 标记扫描结束：阻止延迟 flush 的 rAF 覆盖 scanProgress: null
      scanDone = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pendingProgress = null;

      // 大量照片（如 1000+）一次性 setState 会触发重渲染所有工具卡片，
      // 用 startTransition 标记低优先级，让 React 优先处理用户交互（滚动/点击）
      startTransition(() => {
        setTabState(tabId, (tab) => ({ ...tab, photos: results, scanProgress: null }));
      });
      addToast({ type: 'success', message: t('organize.scan.scanComplete', { count: results.length }) });
    } catch (err) {
      scanDone = true;
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      pendingProgress = null;
      setTabState(tabId, (tab) => ({ ...tab, scanProgress: null }));
      addToast({ type: 'error', message: t('organize.scan.scanFailed', { message: (err as Error).message }) });
    } finally {
      // 统一清理事件监听器（无论成功或失败）
      if (unlisten) {
        try { unlisten(); } catch { /* ignore */ }
      }
      setTabState(tabId, (tab) => ({ ...tab, scanning: false }));
    }
  }, [setTabState, addToast, t]);

  // ── 恢复：仅当用户真正进入“照片整理”面板时才触发已恢复标签的异步重新扫描 ──
  // 背景：本面板在主页中“始终挂载”（仅用 CSS 隐藏，避免切换 Tab 时丢失所选路径）。
  // 若在组件挂载时就自动恢复扫描，那么每次从编辑/相册返回主页（面板重新挂载）
  // 都会在用户停留在相册页时突然弹出“扫描完成”提示，令人困惑。
  // 故改为：仅当 active 变为 true（用户主动进入照片整理页）时，才扫描一次并提示结果。
  // 仅执行一次（用 ref 守卫，React 18 StrictMode 双调用下也安全）
  useEffect(() => {
    if (restoredRef.current) return;
    if (!active) return;
    restoredRef.current = true;

    const restoredTabs = tabsRef.current;
    if (restoredTabs.length === 0) return;

    // 异步触发每个标签的重新扫描
    void (async () => {
      for (const tab of restoredTabs) {
        if (tab.sourceMode === 'library' && tab.projectId) {
          try {
            const photos = await loadPhotos(tab.projectId);
            const fileInfos = photos.map(photoToFileInfo);
            setTabState(tab.id, (t) => ({ ...t, photos: fileInfos, scanning: false, scanProgress: null }));
          } catch (err) {
            logger.warn('[OrganizePanel] 恢复库标签失败', err);
            setTabState(tab.id, (t) => ({ ...t, scanning: false, scanProgress: null }));
          }
        } else if (tab.sourceMode === 'folder' && tab.rootPath) {
          await scanFolderTauri(tab.rootPath, tab.id);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  /** Web 端扫描文件夹（写入指定标签） */
  const scanFolderWeb = useCallback(async (handle: FileSystemDirectoryHandle, tabId: string) => {
    const scanningMsg = t('organize.scan.scanningFolder');
    setTabState(tabId, (tab) => ({
      ...tab,
      scanning: true,
      photos: [],
      scanProgress: { phase: 'scanning', current: 0, total: 0, message: scanningMsg },
    }));

    // rAF 节流：合并密集的进度更新，避免每发现一个文件就 setState
    let pendingCount = 0;
    let rafId = 0;
    const flushProgress = () => {
      rafId = 0;
      if (pendingCount === 0) return;
      const current = pendingCount;
      setTabState(tabId, (tab) => ({
        ...tab,
        scanProgress: {
          phase: 'scanning',
          current,
          total: current,
          message: t('organize.scan.photosFound', { count: current }),
        },
      }));
    };

    try {
      const results: PhotoFileInfo[] = [];
      let count = 0;

      async function walk(dirHandle: FileSystemDirectoryHandle, relativePrefix = ''): Promise<void> {
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const ext = getExt(entry.name);
            if (!SUPPORTED_FOLDER_EXTS.has(ext)) continue;

            count++;
            // rAF 节流：累积计数，在下一帧统一 flush
            pendingCount = count;
            if (rafId === 0) {
              rafId = requestAnimationFrame(flushProgress);
            }

            try {
              const file = await (entry as FileSystemFileHandle).getFile();
              // 只读前 64KB 用于 EXIF 解析（EXIF 段在文件头部）
              let dateTaken: string | undefined;
              try {
                const headBuf = await file.slice(0, 65536).arrayBuffer();
                const dateStr = await readExifDateWithFallback(headBuf, entry.name);
                if (dateStr) dateTaken = dateStr;
              } catch {
                // EXIF 解析失败静默处理
              }
              // fallback：文件修改时间（lastModified）作为最后手段
              // 虽然不如 EXIF 拍摄日期准确，但比完全没有日期信息好
              if (!dateTaken && file.lastModified > 0) {
                dateTaken = new Date(file.lastModified).toISOString();
              }

              results.push({
                id: `${relativePrefix}${entry.name}`,
                name: entry.name,
                size: file.size,
                ext,
                mimeType: file.type || extToMimeType(ext),
                thumbUrl: URL.createObjectURL(file),
                relativePath: relativePrefix ? `${relativePrefix}${entry.name}` : entry.name,
                dateTaken,
              });
            } catch {
              // 跳过
            }
          } else if (entry.kind === 'directory') {
            await walk(entry as FileSystemDirectoryHandle, `${relativePrefix}${entry.name}/`);
          }
        }
      }

      await walk(handle);
      // 扫描结束 cancel 待执行的 rAF（进度已由最终 setTabState 覆盖）
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      startTransition(() => {
        setTabState(tabId, (tab) => ({ ...tab, photos: results, scanProgress: null }));
      });
      addToast({ type: 'success', message: t('organize.scan.scanComplete', { count: results.length }) });
    } catch (err) {
      setTabState(tabId, (tab) => ({ ...tab, scanProgress: null }));
      addToast({ type: 'error', message: t('organize.scan.scanFailed', { message: (err as Error).message }) });
    } finally {
      setTabState(tabId, (tab) => ({ ...tab, scanning: false }));
    }
  }, [setTabState, addToast, t]);

  // ── 操作入口 ──────────────────────────────────────────

  /** 打开新路径：新增一个标签并扫描（不替换现有标签） */
  const handleSelectFolder = async () => {
    if (tabs.length >= MAX_TABS) {
      addToast({ type: 'warning', message: t('organize.tabs.maxTabsReached', { max: MAX_TABS }) });
      return;
    }

    if (isTauri()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({ directory: true, multiple: false, title: t('organize.selectPhotoFolder') });
        if (selected && typeof selected === 'string') {
          const id = crypto.randomUUID();
          setTabs((prev) => [
            ...prev,
            {
              id,
              name: folderBaseName(selected),
              rootPath: selected,
              folderHandle: null,
              sourceMode: 'folder' as const,
              photos: [],
              scanning: false,
              scanProgress: null,
            },
          ]);
          setActiveTabId(id);
          await scanFolderTauri(selected, id);
          // 记录到历史（去重，保留最近 10 个）
          setHistory(addHistory({
            path: selected,
            name: folderBaseName(selected),
            sourceMode: 'folder',
            openedAt: Date.now(),
          }));
        }
      } catch (err) {
        addToast({ type: 'error', message: t('organize.selectFolderFailed', { message: (err as Error).message }) });
      }
    } else {
      try {
        const w = window as unknown as WindowWithDirectoryPicker;
        const handle = await w.showDirectoryPicker!({ mode: 'read' });
        const id = crypto.randomUUID();
        setTabs((prev) => [
          ...prev,
          {
            id,
            name: handle.name,
            rootPath: null,
            folderHandle: handle,
            sourceMode: 'folder' as const,
            photos: [],
            scanning: false,
            scanProgress: null,
          },
        ]);
        setActiveTabId(id);
        await scanFolderWeb(handle, id);
        // Web 端 folderHandle 无法序列化，不记录历史（无法快捷重开）
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          addToast({ type: 'error', message: t('organize.selectFolderFailed', { message: (err as Error).message }) });
        }
      }
    }
  };

  /** 关闭指定标签（释放其 blob URL 并切换激活标签） */
  const closeTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab) releaseTabBlobUrls(tab);
      clearDedupeState(id);

      const idx = tabsRef.current.findIndex((t) => t.id === id);
      const remaining = tabsRef.current.filter((t) => t.id !== id);
      setTabs(remaining);

      setActiveTabId((prevActive) => {
        if (prevActive !== id) return prevActive;
        if (remaining.length === 0) return null;
        return remaining[Math.max(0, idx - 1)].id;
      });
    },
    [releaseTabBlobUrls, clearDedupeState],
  );

  /** 复制路径到剪贴板 */
  const handleCopyPath = useCallback(async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      addToast({ type: 'success', message: t('organize.pathCopied') });
    } catch {
      addToast({ type: 'error', message: t('organize.copyFailed') });
    }
  }, [addToast, t]);

  /** 在系统文件管理器中打开对应路径的文件夹（仅 Tauri folder 模式） */
  const handleOpenFolder = useCallback(async (path: string) => {
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // 调用 Rust 端 open_folder 命令（Windows: explorer.exe / macOS: open / Linux: xdg-open）
      await invoke('open_folder', { path });
    } catch (err) {
      logger.warn('[openFolder]', err);
      addToast({ type: 'error', message: t('organize.openFolderFailed') });
    }
  }, [addToast, t]);

  /** 重新扫描当前激活标签 */
  const handleRescan = useCallback(async () => {
    const tab = tabsRef.current.find((tt) => tt.id === activeTabId);
    if (!tab) return;
    // 重新扫描后旧的去重结果失效，清除持久化状态
    clearDedupeState(tab.id);
    // library 模式：重新从 DB 加载照片
    if (tab.sourceMode === 'library' && tab.projectId) {
      const reloadingMsg = t('organize.reloadingProjectPhotos');
      setTabState(tab.id, (tabState) => ({
        ...tabState,
        scanning: true,
        scanProgress: { phase: 'scanning', current: 0, total: 0, message: reloadingMsg },
      }));
      try {
        const photos = await loadPhotos(tab.projectId);
        const fileInfos = photos.map(photoToFileInfo);
        setTabState(tab.id, (tabState) => ({ ...tabState, photos: fileInfos, scanProgress: null }));
        addToast({ type: 'success', message: t('organize.reloadedPhotos', { count: fileInfos.length }) });
      } catch (err) {
        setTabState(tab.id, (tabState) => ({ ...tabState, scanProgress: null }));
        addToast({ type: 'error', message: t('organize.reloadFailed', { message: (err as Error).message }) });
      } finally {
        setTabState(tab.id, (tabState) => ({ ...tabState, scanning: false }));
      }
      return;
    }
    // folder 模式：释放旧 blob URL 后重新扫描
    releaseTabBlobUrls(tab);
    if (isTauri() && tab.rootPath) {
      await scanFolderTauri(tab.rootPath, tab.id);
    } else if (tab.folderHandle) {
      await scanFolderWeb(tab.folderHandle, tab.id);
    }
  }, [activeTabId, clearDedupeState, t, setTabState, addToast, releaseTabBlobUrls, scanFolderTauri, scanFolderWeb]);

  // ── 扫描项目库 ──────────────────────────────────────────

  const [libPickerOpen, setLibPickerOpen] = useState(false);

  const handleScanLibrary = () => {
    if (tabs.length >= MAX_TABS) {
      addToast({ type: 'warning', message: t('organize.tabs.maxTabsReached', { max: MAX_TABS }) });
      return;
    }
    setLibPickerOpen(true);
  };

  /** 选择项目后，从 IndexedDB 加载照片并创建 library 标签 */
  const handleLibrarySelect = useCallback(async (project: AlbumProject) => {
    const id = crypto.randomUUID();
    const loadingMsg = t('organize.loadingProjectPhotos');
    setTabs((prev) => [
      ...prev,
      {
        id,
        name: project.name,
        rootPath: null,
        folderHandle: null,
        sourceMode: 'library' as const,
        projectId: project.id,
        photos: [],
        scanning: true,
        scanProgress: { phase: 'scanning', current: 0, total: 0, message: loadingMsg },
      },
    ]);
    setActiveTabId(id);
    try {
      const photos = await loadPhotos(project.id);
      const fileInfos = photos.map(photoToFileInfo);
      setTabState(id, (tabState) => ({ ...tabState, photos: fileInfos, scanProgress: null }));
      addToast({ type: 'success', message: t('organize.loadedPhotos', { count: fileInfos.length }) });
      // 记录到历史
      setHistory(addHistory({
        path: project.id,
        name: project.name,
        sourceMode: 'library',
        openedAt: Date.now(),
      }));
    } catch (err) {
      setTabState(id, (tabState) => ({ ...tabState, scanProgress: null }));
      addToast({ type: 'error', message: t('organize.loadFailed', { message: (err as Error).message }) });
    } finally {
      setTabState(id, (tabState) => ({ ...tabState, scanning: false }));
    }
  }, [addToast, setTabState, t]);

  /** 从历史快捷打开一个路径（Tauri folder 或 library） */
  const handleOpenHistory = useCallback(
    async (entry: HistoryEntry) => {
      if (tabsRef.current.length >= MAX_TABS) {
        addToast({ type: 'warning', message: t('organize.tabs.maxTabsReached', { max: MAX_TABS }) });
        return;
      }
      // 已打开则切到该标签
      const existing = tabsRef.current.find(
        (t) =>
          (t.sourceMode === 'folder' && t.rootPath === entry.path) ||
          (t.sourceMode === 'library' && t.projectId === entry.path),
      );
      if (existing) {
        setActiveTabId(existing.id);
        addToast({ type: 'info', message: t('organize.pathAlreadyOpen') });
        return;
      }

      if (entry.sourceMode === 'folder' && isTauri()) {
        const id = crypto.randomUUID();
        setTabs((prev) => [
          ...prev,
          {
            id,
            name: entry.name,
            rootPath: entry.path,
            folderHandle: null,
            sourceMode: 'folder' as const,
            photos: [],
            scanning: false,
            scanProgress: null,
          },
        ]);
        setActiveTabId(id);
        await scanFolderTauri(entry.path, id);
        setHistory(addHistory({ ...entry, openedAt: Date.now() }));
      } else if (entry.sourceMode === 'library') {
        // 从历史恢复 library 标签：需要重新查找项目（可能已删除）
        try {
          const { listProjects } = await import('../../db');
          const projects = await listProjects();
          const project = projects.find((p) => p.id === entry.path);
          if (!project) {
            addToast({ type: 'error', message: t('organize.projectNotFound') });
            setHistory(removeHistoryEntry(entry.path));
            return;
          }
          await handleLibrarySelect(project);
        } catch (err) {
          addToast({ type: 'error', message: t('organize.openFailed', { message: (err as Error).message }) });
        }
      }
    },
    [addToast, handleLibrarySelect, scanFolderTauri, t],
  );

  /** 从历史列表移除一条记录 */
  const handleRemoveHistory = useCallback((path: string) => {
    setHistory(removeHistoryEntry(path));
  }, []);

  // 工具 busy 状态回调（按工具名汇总，稳定引用避免 effect 反复触发）
  // 修复：原内联箭头函数每次渲染新引用 + 4 工具共享导致 last-writer-wins 覆盖
  // 同时追踪 toolStatuses：busy=true → 'running'，busy=false 且之前是 'running' → 'done'
  const handleBusyChange = useCallback((toolName: string, busy: boolean) => {
    setBusyTools((prev) => {
      const next = new Set(prev);
      if (busy) next.add(toolName);
      else next.delete(toolName);
      return next;
    });
    setToolStatuses((prev) => {
      const next = new Map(prev);
      const tid = toolName as ToolId;
      if (busy) {
        next.set(tid, 'running');
      } else if (next.get(tid) === 'running') {
        next.set(tid, 'done');
      }
      return next;
    });
  }, []);

  // 子工具共享 props（基于激活标签）
  // useMemo 稳定引用：扫描进度更新不会重建此对象，避免工具组件不必要重渲染
  const toolProps = useMemo<ToolProps>(() => ({
    photos: activeTab?.photos ?? [],
    rootPath: activeTab?.rootPath ?? null,
    sourceMode: activeTab?.sourceMode ?? 'folder',
    readPhotoData,
    onPhotosUpdate,
    addToast,
    onRescan: handleRescan,
    tabId: activeTabId ?? undefined,
    onBusyChange: handleBusyChange,
  }), [
    activeTab?.photos, activeTab?.rootPath, activeTab?.sourceMode,
    readPhotoData, onPhotosUpdate, addToast, handleRescan, activeTabId, handleBusyChange,
  ]);

  // ── 渲染 ──────────────────────────────────────────────

  const hasData = tabs.length > 0;

  // 工具卡片区 useMemo：扫描进度更新不触发工具组件重渲染
  // 关键：不依赖 activeTab 对象引用（扫描时 setTabState 会重建 tab 对象），
  // 只依赖 hasData + toolProps（已 memo 化）+ 去重状态
  const hasActiveTab = !!activeTab;

  // 工具是否需要"加入相册"按钮（仅浏览类工具支持照片选择→加入相册）
  const showAlbumButton = activeTool === 'timeline' || activeTool === 'calendar';

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      {/* 顶部数据源选择 */}
      <section className={`shrink-0 mb-4 ${hasData ? '' : 'flex-1 flex flex-col overflow-auto custom-scrollbar'}`}>
        <header className="flex items-center gap-4 mb-4">
          <div className="shrink-0">
            <h2 className="text-[1.875rem] font-[700] text-[var(--color-text-primary)] leading-tight tracking-tight">{t('organize.title')}</h2>
            <p className="text-[var(--text-caption)] text-[var(--color-text-tertiary)] mt-0.5">{t('organize.subtitle')}</p>
          </div>
        </header>

        {hasData ? (
          <>
            {/* 路径标签栏 */}
            {/* 多路径时标签可横向滚动，标签名称按需截断（非激活标签更窄），全部标签保持可见 */}
            <div className="flex items-stretch gap-1.5 overflow-x-auto overflow-y-hidden pb-1 mb-4 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const count = tab.photos.length;
                // 任一工具执行中时禁用切换到其他标签（防止异步操作中途切换导致状态丢失/数据错配）
                const isLockedByBusy = isAnyToolBusy && tab.id !== activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={() => { if (!isLockedByBusy) setActiveTabId(tab.id); }}
                    title={isLockedByBusy ? t('organize.tabBusyLock') : (tab.rootPath || tab.name)}
                    className={`group flex items-center gap-1.5 pl-2.5 pr-1 py-1.5 rounded-lg border shrink-0 transition-all ${
                      isActive ? 'min-w-[120px]' : 'min-w-[68px]'
                    } ${
                      isLockedByBusy
                        ? 'cursor-not-allowed opacity-50 bg-white border-[var(--color-border)] text-[var(--color-gray-400)]'
                        : isActive
                          ? 'bg-[var(--color-brand)] border-[var(--color-brand)] text-white shadow-[0_2px_8px_rgba(108,99,255,0.25)] cursor-pointer'
                          : 'bg-white border-[var(--color-border)] text-[var(--color-gray-700)] hover:border-[var(--color-brand)] cursor-pointer'
                    }`}
                  >
                    {tab.sourceMode === 'library' ? (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[var(--color-gray-400)]'}`}>
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <circle cx="6" cy="6" r="1.2" />
                        <circle cx="10" cy="6" r="1.2" />
                        <circle cx="6" cy="10" r="1.2" />
                        <circle cx="10" cy="10" r="1.2" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-[var(--color-gray-400)]'}`}>
                        <path d="M14 11V5a2 2 0 00-2-2H8l-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2z" />
                      </svg>
                    )}
                    <span className={`text-sm font-[600] min-w-0 truncate ${isActive ? 'max-w-[180px]' : 'max-w-[80px]'}`}>{tab.name}</span>
                    {count > 0 && (
                      <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-[var(--color-gray-100)] text-[var(--color-gray-500)]'
                      }`}>{count}</span>
                    )}
                    {tab.scanning && (
                      <svg className="w-3.5 h-3.5 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                    )}
                    {/* 删除当前路径按钮（标签最右侧，hover 时显示，节省标签宽度） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      title={t('organize.closePath')}
                      className={`shrink-0 w-5 h-5 rounded flex items-center justify-center transition-all
                                  opacity-60 group-hover:opacity-100
                                  ${isActive
                                    ? 'hover:bg-white/20 text-white/80 hover:text-white'
                                    : 'hover:bg-[var(--color-gray-100)] text-[var(--color-gray-400)] hover:text-red-500'}`}
                    >
                      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3 h-3">
                        <path d="M3 3l8 8M11 3l-8 8" />
                      </svg>
                    </button>
                  </div>
                );
              })}

              {tabs.length < MAX_TABS ? (
                <>
                  {/* 「添加路径」浅色主按钮：浅品牌底 + 品牌色文字，区别于“选中”实底颜色 */}
                  <button
                    onClick={handleSelectFolder}
                    disabled={scanningAny}
                    className="group shrink-0 flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-lg border border-[var(--color-brand)]/30
                               bg-[var(--color-brand-bg)] text-[var(--color-brand)]
                               hover:bg-white hover:border-[var(--color-brand)]/60 hover:shadow-[0_2px_10px_rgba(108,99,255,0.14)]
                               text-sm font-[600] cursor-pointer transition-all disabled:opacity-50 disabled:hover:shadow-none disabled:cursor-not-allowed"
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-3.5 h-3.5 group-hover:rotate-90 transition-transform duration-200">
                      <path d="M7 3v8M3 7h8" />
                    </svg>
                    {t('organize.tabs.addPath')}
                  </button>
                  {/* 「项目库」浅色次按钮：浅灰底 + 图标色块，区别于“选中”实底颜色 */}
                  <button
                    onClick={handleScanLibrary}
                    disabled={scanningAny}
                    className="group shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--color-border)]
                               bg-[var(--color-surface-panel)] text-[var(--color-gray-600)] hover:border-[var(--color-brand)]/40 hover:text-[var(--color-brand)]
                               hover:bg-white hover:shadow-[0_2px_10px_rgba(108,99,255,0.10)]
                               text-sm font-[600] cursor-pointer transition-all disabled:opacity-50 disabled:hover:shadow-none"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <circle cx="6" cy="6" r="1.2" />
                      <circle cx="10" cy="6" r="1.2" />
                      <circle cx="6" cy="10" r="1.2" />
                      <circle cx="10" cy="10" r="1.2" />
                    </svg>
                    {t('organize.library')}
                  </button>
                </>
              ) : (
                <span className="shrink-0 text-xs text-[var(--color-gray-400)] px-2">{t('organize.maxTabsReachedShort', { max: MAX_TABS })}</span>
              )}
            </div>

            {/* 当前路径 + 统计 + 重新扫描（同一行） */}
            {activeTab && (
              <div className="mb-3">
                {/* 路径 + 统计（含格式张数）+ 重新扫描（同一行，路径框可缩短让位给统计） */}
                <div className="flex items-center gap-3">
                  {/* 路径显示（左侧，可截断）+ 复制/打开文件夹按钮 */}
                  {activeTab.sourceMode === 'library' ? (
                    <div className="min-w-0 flex-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg
                                    bg-[var(--color-brand-bg)] border border-[var(--color-brand)]/30">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-[var(--color-brand)]">
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <circle cx="6" cy="6" r="1.2" />
                        <circle cx="10" cy="6" r="1.2" />
                        <circle cx="6" cy="10" r="1.2" />
                        <circle cx="10" cy="10" r="1.2" />
                      </svg>
                      <span className="text-xs text-[var(--color-brand)] font-[600] truncate">{t('organize.libraryPrefix', { name: activeTab.name })}</span>
                    </div>
                  ) : activeTab.rootPath ? (
                    <div className="min-w-0 flex-1 inline-flex items-start gap-1 px-2 py-1.5 rounded-lg
                                    bg-[var(--color-surface-panel)] border border-[var(--color-border)]">
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0 text-[var(--color-gray-500)] mt-0.5">
                        <path d="M14 11V5a2 2 0 00-2-2H8l-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2z" />
                      </svg>
                      <span className="text-xs text-[var(--color-gray-600)] flex-1 min-w-0 break-all leading-relaxed">{activeTab.rootPath}</span>
                      {/* 复制路径按钮 */}
                      <button
                        onClick={() => handleCopyPath(activeTab.rootPath!)}
                        title={t('organize.copyPath')}
                        className="shrink-0 w-6 h-6 mt-0.5 rounded flex items-center justify-center text-[var(--color-gray-400)]
                                   hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] transition-colors cursor-pointer"
                      >
                        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <path d="M6 1.5h5a1.5 1.5 0 011.5 1.5v5" />
                        </svg>
                      </button>
                      {/* 打开文件夹按钮（仅 Tauri folder 模式） */}
                      {isTauri() && (
                        <button
                          onClick={() => handleOpenFolder(activeTab.rootPath!)}
                          title={t('organize.openFolder')}
                          className="shrink-0 w-6 h-6 mt-0.5 rounded flex items-center justify-center text-[var(--color-gray-400)]
                                     hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-brand)] transition-colors cursor-pointer"
                        >
                          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                            <path d="M2 4a1 1 0 011-1h3l1.5 1.5H11a1 1 0 011 1V11a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" />
                            <path d="M7 8l-1.5 1.5L7 11M11 8l1.5 1.5L11 11" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ) : null}

                  {/* 统计 + 各格式张数 + 重新扫描（右侧，不收缩） */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* 总张数 + 总大小 */}
                    <span className="text-sm text-[var(--color-text-secondary)] whitespace-nowrap">
                      <strong className="text-[var(--color-brand)]">{activeTab.photos.length}</strong> {t('organize.photoUnit', { count: activeTab.photos.length })}
                      <span className="mx-1.5 text-[var(--color-border)]">·</span>
                      {formatBytes(activeTab.photos.reduce((sum, p) => sum + p.size, 0))}
                    </span>
                    {/* 各格式类型张数（紧跟总张数后面，同一行） */}
                    {activeTab.photos.length > 0 && countByExt(activeTab.photos).map(({ ext, count }) => (
                      <span key={ext} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--color-surface-panel)] border border-[var(--color-border)]/50 font-mono text-xs">
                        <span className="text-[var(--color-gray-600)]">{ext}</span>
                        <span className="text-[var(--color-brand)] font-[600]">{count}</span>
                      </span>
                    ))}
                    {!activeTab.scanning && (
                      <button
                        onClick={handleRescan}
                        className="px-3 py-1.5 rounded-lg text-sm font-[600]
                                   bg-white border border-[var(--color-border)]
                                   hover:bg-[var(--color-surface-hover)]
                                   cursor-pointer flex items-center gap-1.5"
                      >
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                          <path d="M13.5 8a5.5 5.5 0 11-1.6-3.9" />
                          <path d="M13.5 3v3h-3" />
                        </svg>
                        {t('organize.rescan')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <ProgressBar progress={activeTab?.scanProgress ?? null} />
          </>
        ) : (
          <EmptyState
            onSelectFolder={handleSelectFolder}
            onScanLibrary={handleScanLibrary}
            scanning={scanningAny}
            history={history}
            onOpenHistory={handleOpenHistory}
            onRemoveHistory={handleRemoveHistory}
          />
        )}
      </section>

      {/* 左侧功能导航 + 右侧工作区（操作当前激活路径） */}
      {hasData && hasActiveTab && (
        <div className="flex-1 min-h-0 flex gap-4">
          {/* 左侧功能导航栏：一键分析按钮 + 工具列表 */}
          <div className="w-[210px] shrink-0 flex flex-col gap-3 min-h-0">
            {/* 一键分析：自动依次运行 去重 → 人脸识别 → 相似照片分析 */}
            <button
              type="button"
              onClick={handleOneClickAnalyze}
              disabled={autoAnalyzeRunning || isAnyToolBusy || (activeTab?.photos.length ?? 0) === 0}
              className={`group shrink-0 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-[700] transition-all border-none cursor-pointer ${
                autoAnalyzeRunning
                  ? 'bg-[var(--color-brand-bg)] text-[var(--color-brand)]'
                  : 'bg-gradient-to-br from-[var(--color-brand)] to-[#8b5cf6] text-white shadow-[0_3px_12px_rgba(108,99,255,0.28)] hover:shadow-[0_5px_18px_rgba(108,99,255,0.38)] hover:brightness-110'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none`}
              title={t('organize.autoAnalyze.title', '一键分析：自动运行 去重 → 人脸识别 → 相似照片分析')}
            >
              {autoAnalyzeRunning ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  {t('organize.autoAnalyze.running', '正在分析…')}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                    {/* 主体四角星（自动分析） */}
                    <path d="M12 2.5c.45 3.8 1.7 5.05 5.5 5.5-3.8.45-5.05 1.7-5.5 5.5-.45-3.8-1.7-5.05-5.5-5.5 3.8-.45 5.05-1.7 5.5-5.5z" />
                    {/* 辅助小星点 */}
                    <path d="M19.5 13c.28 2.4 1.1 3.22 3.5 3.5-2.4.28-3.22 1.1-3.5 3.5-.28-2.4-1.1-3.22-3.5-3.5 2.4-.28 3.22-1.1 3.5-3.5z" />
                    <path d="M4.8 15.2c.22 1.9.88 2.56 2.8 2.8-1.92.24-2.58.9-2.8 2.8-.22-1.9-.88-2.56-2.8-2.8 1.92-.24 2.58-.9 2.8-2.8z" />
                  </svg>
                  {t('organize.autoAnalyze.title', '一键分析')}
                </>
              )}
            </button>
            <ToolSidebar
              activeTool={activeTool}
              toolStatuses={toolStatuses}
              onSelect={(id) => {
                setActiveTool(id);
                // 切换工具时清空选中（不同工具的选择上下文不同，避免误操作）
                setSelectedPhotoIds(new Set());
              }}
            />
          </div>

          {/* 右侧工作区：无外层标题框，直接渲染工具内容（ToolCard 自带色块标题） */}
          <div className="flex-1 min-w-0 flex flex-col relative">
            {/* 加入相册浮动按钮（仅 timeline/calendar 显示，固定在右上角） */}
            {showAlbumButton && (
              <div className="absolute top-2 right-3 z-20">
                <AddToAlbumButton
                  count={selectedPhotoIds.size}
                  onClick={() => {
                    if (selectedPhotoIds.size === 0) {
                      addToast({
                        type: 'warning',
                        message: t('home.organize.albumBridge.selectPhotosFirst', {
                          defaultValue: '请先选择照片',
                        }),
                      });
                      return;
                    }
                    setAlbumBridgeOpen(true);
                  }}
                />
              </div>
            )}
            {/* 工作区内容：每个工具独立滚动容器，hidden 隐藏非活跃工具以保留状态 */}
            {visitedTools.has('dedupe') && (
              <div className={activeTool === 'dedupe' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <DedupeTool
                  key={`dedupe-${activeTabId}`}
                  {...toolProps}
                  dedupeResult={activeDedupeState.result}
                  dedupeOverrides={activeDedupeState.overrides}
                  onDedupeStateChange={(result, overrides) => { if (activeTabId) setDedupeState(activeTabId, result, overrides); }}
                  autoRunToken={autoAnalyzeToken}
                  isAutoRunTarget={autoAnalyzeStep === 'dedupe'}
                />
              </div>
            )}
            {visitedTools.has('organize') && (
              <div className={activeTool === 'organize' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <OrganizeTool key={`organize-${activeTabId}`} {...toolProps} />
              </div>
            )}
            {visitedTools.has('faceCluster') && (
              <div className={activeTool === 'faceCluster' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <FaceClusterTool key={`faceCluster-${activeTabId}`} {...toolProps} autoRunToken={autoAnalyzeToken} isAutoRunTarget={autoAnalyzeStep === 'faceCluster'} />
              </div>
            )}
            {visitedTools.has('similar') && (
              <div className={activeTool === 'similar' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <SimilarTool key={`similar-${activeTabId}`} {...toolProps} autoRunToken={autoAnalyzeToken} isAutoRunTarget={autoAnalyzeStep === 'similar'} />
              </div>
            )}
            {visitedTools.has('screenshot') && (
              <div className={activeTool === 'screenshot' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <ScreenshotTool key={`screenshot-${activeTabId}`} {...toolProps} />
              </div>
            )}
            {visitedTools.has('exif') && (
              <div className={activeTool === 'exif' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <ExifTool key={`exif-${activeTabId}`} {...toolProps} />
              </div>
            )}
            {visitedTools.has('rename') && (
              <div className={activeTool === 'rename' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <RenameTool key={`rename-${activeTabId}`} {...toolProps} />
              </div>
            )}
            {visitedTools.has('convert') && (
              <div className={activeTool === 'convert' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <ConvertTool key={`convert-${activeTabId}`} {...toolProps} />
              </div>
            )}
            {visitedTools.has('timeline') && (
              <div className={activeTool === 'timeline' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <ToolCard
                  title={t('home.organize.sidebar.timeline', '时间线')}
                  description={t('home.organize.sidebar.timelineDesc', '按月份或路径分组浏览照片')}
                  color="indigo"
                  icon={
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                      <line x1="4" y1="4" x2="4" y2="16" />
                      <circle cx="4" cy="6" r="1.5" fill="currentColor" />
                      <circle cx="4" cy="11" r="1.5" fill="currentColor" />
                      <line x1="8" y1="6" x2="16" y2="6" />
                      <line x1="8" y1="11" x2="14" y2="11" />
                      <line x1="8" y1="14" x2="12" y2="14" />
                    </svg>
                  }
                >
                  <TimelineView
                    key={`timeline-${activeTabId}`}
                    photos={activeTab?.photos ?? []}
                    readPhotoData={readPhotoData}
                    onSelectionChange={setSelectedPhotoIds}
                    sourceMode={activeTab?.sourceMode ?? 'folder'}
                    onPhotosUpdate={onPhotosUpdate}
                    addToast={addToast}
                    onViewInCalendar={(year, month) => {
                      setSelectedPhotoIds(new Set());
                      setCalendarInitialView({ year, month });
                      setActiveTool('calendar');
                    }}
                  />
                </ToolCard>
              </div>
            )}
            {visitedTools.has('calendar') && (
              <div className={activeTool === 'calendar' ? 'flex-1 min-h-0 overflow-y-auto custom-scrollbar' : 'hidden'}>
                <ToolCard
                  title={t('home.organize.sidebar.calendar', '日历')}
                  description={t('home.organize.sidebar.calendarDesc', '按日期浏览照片')}
                  color="cyan"
                  icon={
                    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                      <rect x="3" y="4" width="14" height="13" rx="1" />
                      <line x1="3" y1="8" x2="17" y2="8" />
                      <line x1="7" y1="2" x2="7" y2="6" />
                      <line x1="13" y1="2" x2="13" y2="6" />
                    </svg>
                  }
                >
                  <CalendarView
                    key={`calendar-${activeTabId}`}
                    photos={activeTab?.photos ?? []}
                    readPhotoData={readPhotoData}
                    selectedIds={selectedPhotoIds}
                    onSelectionChange={setSelectedPhotoIds}
                    initialView={calendarInitialView}
                    sourceMode={activeTab?.sourceMode ?? 'folder'}
                    onPhotosUpdate={onPhotosUpdate}
                    addToast={addToast}
                  />
                </ToolCard>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 一键成册联动对话框 */}
      <AlbumBridgeDialog
        open={albumBridgeOpen}
        onClose={() => setAlbumBridgeOpen(false)}
        photos={selectedPhotos}
        sourceMode={activeTab?.sourceMode ?? 'folder'}
        addToast={addToast}
        readPhotoData={readPhotoData}
      />

      {/* 项目库选择弹窗 */}
      <LibraryPickerDialog
        open={libPickerOpen}
        onClose={() => setLibPickerOpen(false)}
        onSelect={handleLibrarySelect}
      />
    </div>
  );
}

// ── 空状态：引导式入口 + 4 个马卡龙色功能卡 + 最近打开 ──────────────────────────────

function EmptyState({
  onSelectFolder,
  onScanLibrary,
  scanning,
  history,
  onOpenHistory,
  onRemoveHistory,
}: {
  onSelectFolder: () => void;
  onScanLibrary: () => void;
  scanning: boolean;
  history: HistoryEntry[];
  onOpenHistory: (entry: HistoryEntry) => void;
  onRemoveHistory: (path: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col">
      {/* 引导式大卡片入口（替换原来不显眼的小按钮） */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4 mb-3">
        {/* 主推：选择照片文件夹（brand 渐变 + 磨砂质感 + 步骤标号） */}
        <button
          onClick={onSelectFolder}
          disabled={scanning}
          className="group relative overflow-hidden text-left rounded-2xl p-6 cursor-pointer border-none
                     bg-gradient-to-br from-[var(--color-brand)] to-[#8b5cf6]
                     text-white shadow-[0_8px_24px_rgba(108,99,255,0.28)]
                     hover:shadow-[0_12px_32px_rgba(108,99,255,0.38)] hover:-translate-y-0.5
                     transition-all duration-300 disabled:opacity-60 disabled:hover:translate-y-0 disabled:cursor-wait"
        >
          {/* 装饰光斑（增加高端磨砂玻璃质感） */}
          <div className="pointer-events-none absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-10 -left-6 w-28 h-28 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex items-start gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
                <path d="M21 16.5V7a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/25 text-[10px] font-[700]">1</span>
                <span className="text-[10px] font-[600] uppercase tracking-wider text-white/70">{t('organize.emptyState.step1Label')}</span>
              </div>
              <div className="text-[1.25rem] font-[700] leading-tight mb-1">
                {scanning ? t('organize.emptyState.scanning') : t('organize.emptyState.step1Title')}
              </div>
              <div className="text-[13px] text-white/75 leading-relaxed">
                {t('organize.emptyState.step1Desc')}
              </div>
            </div>
            {/* 引导箭头 */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 w-5 h-5 mt-1 text-white/50 group-hover:translate-x-1 group-hover:text-white/90 transition-all">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
        </button>

        {/* 次选：扫描项目库 */}
        <button
          onClick={onScanLibrary}
          disabled={scanning}
          className="group relative overflow-hidden text-left rounded-2xl p-6 cursor-pointer
                     bg-white border border-[var(--color-border)]
                     hover:border-[var(--color-brand)] hover:shadow-[0_8px_24px_rgba(108,99,255,0.12)] hover:-translate-y-0.5
                     transition-all duration-300 disabled:opacity-60 disabled:hover:translate-y-0 disabled:cursor-wait"
        >
          <div className="flex items-start gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-[var(--color-brand-bg)] flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7 text-[var(--color-brand)]">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="16" cy="8" r="1.5" />
                <circle cx="8" cy="16" r="1.5" />
                <circle cx="16" cy="16" r="1.5" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[var(--color-gray-100)] text-[var(--color-gray-500)] text-[10px] font-[700]">2</span>
                <span className="text-[10px] font-[600] uppercase tracking-wider text-[var(--color-text-tertiary)]">{t('organize.emptyState.step2Label')}</span>
              </div>
              <div className="text-[1.25rem] font-[700] leading-tight mb-1 text-[var(--color-text-primary)]">
                {t('organize.emptyState.step2Title')}
              </div>
              <div className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                {t('organize.emptyState.step2Desc')}
              </div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 w-5 h-5 mt-1 text-[var(--color-gray-300)] group-hover:translate-x-1 group-hover:text-[var(--color-brand)] transition-all">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </div>
        </button>
      </div>

      {/* 引导步骤说明 */}
      <div className="flex items-center gap-2 mb-7 text-xs text-[var(--color-text-tertiary)]">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 5v3.5M8 11h.01" />
        </svg>
        <span>{t('organize.emptyState.dataSourceHint')}</span>
      </div>

      {/* 全部功能卡：按分类分组展示（对齐左侧导航栏的最新工具列表） */}
      <div className="space-y-4 mb-6">
        {[
          {
            key: 'browse',
            label: t('organize.emptyState.categoryBrowse'),
            tools: [
              { color: 'indigo' as const, title: t('organize.tools.timeline.title'), desc: t('organize.tools.timeline.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><line x1="4" y1="4" x2="4" y2="16" /><circle cx="4" cy="6" r="1.5" fill="currentColor" /><circle cx="4" cy="11" r="1.5" fill="currentColor" /><line x1="8" y1="6" x2="16" y2="6" /><line x1="8" y1="11" x2="14" y2="11" /><line x1="8" y1="14" x2="12" y2="14" /></svg> },
              { color: 'cyan' as const, title: t('organize.tools.calendar.title'), desc: t('organize.tools.calendar.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="4" width="14" height="13" rx="1" /><line x1="3" y1="8" x2="17" y2="8" /><line x1="7" y1="2" x2="7" y2="6" /><line x1="13" y1="2" x2="13" y2="6" /></svg> },
            ],
          },
          {
            key: 'smart',
            label: t('organize.emptyState.categorySmart'),
            tools: [
              { color: 'coral' as const, title: t('organize.tools.dedupe.title'), desc: t('organize.tools.dedupe.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M9 2a7 7 0 105.293 11.707l3.707 3.707" /><path d="M15 15l3 3" /><line x1="18" y1="9" x2="12" y2="15" /></svg> },
              { color: 'blue' as const, title: t('organize.tools.organize.title'), desc: t('organize.tools.organize.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="4" width="14" height="13" rx="1" /><line x1="3" y1="8" x2="17" y2="8" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="12" y1="2" x2="12" y2="6" /></svg> },
              { color: 'violet' as const, title: t('organize.tools.faceCluster.title'), desc: t('organize.tools.faceCluster.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><circle cx="10" cy="10" r="8" /><circle cx="7.5" cy="8.5" r="0.8" fill="currentColor" /><circle cx="12.5" cy="8.5" r="0.8" fill="currentColor" /><path d="M6.5 12.5c1 1 2.3 1.5 3.5 1.5s2.5-.5 3.5-1.5" /></svg> },
              { color: 'amber' as const, title: t('organize.tools.similar.title'), desc: t('organize.tools.similar.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="2" y="4" width="11" height="11" rx="2" /><rect x="7" y="7" width="11" height="11" rx="2" /></svg> },
              { color: 'teal' as const, title: t('organize.tools.screenshot.title'), desc: t('organize.tools.screenshot.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="3" width="14" height="11" rx="1.5" /><path d="M7 18h6" /><path d="M10 14v4" /><path d="M8 6.5a2 2 0 104 0" /><path d="M8 9.5h4" /></svg> },
            ],
          },
          {
            key: 'metadata',
            label: t('organize.emptyState.categoryMetadata'),
            tools: [
              { color: 'green' as const, title: t('organize.tools.exif.title'), desc: t('organize.tools.exif.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><rect x="3" y="3" width="14" height="14" rx="2" /><line x1="7" y1="7" x2="13" y2="7" /><line x1="7" y1="10" x2="13" y2="10" /><line x1="7" y1="13" x2="10" y2="13" /></svg> },
              { color: 'teal' as const, title: t('organize.tools.rename.title'), desc: t('organize.tools.rename.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M3 14l5-5 3 3-5 5H3v-3z" /><path d="M13 4l2-2 3 3-2 2" /><line x1="11" y1="6" x2="14" y2="9" /></svg> },
              { color: 'pink' as const, title: t('organize.tools.convert.title'), desc: t('organize.tools.convert.shortDesc'), icon: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M4 4h12v12H4z" /><path d="M4 14l4-4 3 3 5-5" /></svg> },
            ],
          },
        ].map((group) => (
          <div key={group.key}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-[700] uppercase tracking-wider text-[var(--color-text-tertiary)]">{group.label}</span>
              <span className="flex-1 h-px bg-[var(--color-border)]/60" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {group.tools.map((tool) => (
                <FeatureCard key={tool.title} color={tool.color} title={tool.title} desc={tool.desc} icon={tool.icon} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 最近打开的路径（快捷重开） */}
      {history.length > 0 && (
        <div className="rounded-2xl border border-[var(--color-border)] bg-white/60 backdrop-blur-sm overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--color-border)]/60">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-[var(--color-gray-400)]">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 4.5v3.5l2 2" />
            </svg>
            <span className="text-[13px] font-[600] text-[var(--color-text-secondary)]">{t('organize.emptyState.recentTitle')}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">{t('organize.emptyState.recentHint')}</span>
          </div>
          <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
            {history.map((entry) => (
              <div
                key={entry.path}
                className="group flex items-center gap-3 px-4 py-2 hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer border-b border-[var(--color-border)]/40 last:border-b-0"
                onClick={() => onOpenHistory(entry)}
              >
                <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center
                                bg-[var(--color-brand-bg)] text-[var(--color-brand)]">
                  {entry.sourceMode === 'library' ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <rect x="2" y="2" width="12" height="12" rx="1" />
                      <circle cx="6" cy="6" r="1.2" />
                      <circle cx="10" cy="6" r="1.2" />
                      <circle cx="6" cy="10" r="1.2" />
                      <circle cx="10" cy="10" r="1.2" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                      <path d="M14 11V5a2 2 0 00-2-2H8l-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2z" />
                    </svg>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-[600] text-[var(--color-text-primary)] truncate">
                    {entry.name}
                    {entry.sourceMode === 'library' && (
                      <span className="ml-1.5 text-[10px] font-[500] px-1.5 py-0.5 rounded bg-[var(--color-brand-bg)] text-[var(--color-brand)]">{t('organize.emptyState.projectBadge')}</span>
                    )}
                  </div>
                  <div className="text-xs text-[var(--color-text-tertiary)] truncate">
                    {entry.sourceMode === 'library' ? t('organize.projectIdPrefix', { id: entry.path.slice(0, 8) }) : entry.path}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs text-[var(--color-brand)] font-[600] mr-1">{t('organize.emptyState.openButton')}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRemoveHistory(entry.path); }}
                    title={t('organize.emptyState.removeFromHistory')}
                    className="w-6 h-6 rounded flex items-center justify-center text-[var(--color-gray-400)]
                               hover:bg-red-50 hover:text-red-500 transition-colors cursor-pointer border-none bg-transparent"
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="w-3 h-3">
                      <path d="M3 3l8 8M11 3l-8 8" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** 马卡龙色功能卡（空状态展示用） */
function FeatureCard({
  color,
  title,
  desc,
  icon,
}: {
  color: keyof typeof FEATURE_COLORS;
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  const c = FEATURE_COLORS[color];
  return (
    <div className={`rounded-2xl p-4 ${c.cardBg} transition-all duration-200 hover:shadow-[var(--shadow-md)] hover:-translate-y-px`}>
      <div className={`w-11 h-11 rounded-xl ${c.iconBg} ${c.text} flex items-center justify-center mb-3`}>
        {icon}
      </div>
      <div className="text-[15px] font-[700] text-[var(--color-gray-800)] tracking-tight">{title}</div>
      <div className="text-xs text-[var(--color-text-secondary)] mt-1 leading-relaxed">{desc}</div>
    </div>
  );
}
