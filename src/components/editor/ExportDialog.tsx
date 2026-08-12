import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import type { ExportOptions, ExportFormat, ExportResult } from '../../utils/exportEngine';
import { exportToPNG, exportToJPG, exportToPDF, cancelExport } from '../../utils/exportEngine';
import { useDraggable } from '../../hooks/useDraggable';
import { useDialogHotkeys } from '../../hooks/useDialogHotkeys';
import { logger } from '../../utils/logger';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const isTauri = () => !!(window as any).__TAURI_INTERNALS__;

/* ══════════════════════════ 导出进度浮窗（居中显示） ══════════════════════════ */

function ExportFloatWindow({
  current, total, progress, onCancel,
}: {
  current: number; total: number; progress: number;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
      <div
        className="w-[360px] bg-white rounded-[var(--radius-lg)] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-[var(--color-border-light)] overflow-hidden"
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-[var(--color-gray-50)] border-b border-[var(--color-border-light)] select-none"
        >
          <span className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]">{t('editor.exportDialog.exportAlbum')}</span>
          <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">{total > 0 ? `${current}/${total}` : '...'}</span>
        </div>

        {/* 进度 */}
        <div className="px-3 py-3 space-y-2">
          <p className="text-[var(--text-body-sm)] text-[var(--color-gray-600)]">
            {t('editor.exportDialog.exportingPage', { current, total })}
          </p>
          <div className="w-full bg-[var(--color-gray-200)] rounded-full h-2">
            <div
              className="bg-[var(--color-primary-600)] h-2 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
          <p className="text-[var(--text-caption)] text-[var(--color-gray-400)] text-right">
            {progress}%
          </p>
        </div>

        {/* 取消 */}
        <div className="px-3 pb-3 flex justify-end">
          <button
            onClick={onCancel}
            className="h-8 px-4 text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-600)] bg-[var(--color-gray-100)] rounded-[var(--radius-md)] hover:bg-[var(--color-gray-200)] transition-colors border-none cursor-pointer"
          >
            {t('editor.exportDialog.cancelExport')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ 导出结果浮窗 ══════════════════════════ */

function ExportResultWindow({
  result, onClose, onOpenFile,
}: {
  result: ExportResult;
  onClose: () => void;
  onOpenFile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
      <div className="w-[420px] max-w-full bg-white rounded-[var(--radius-xl)] shadow-[0_12px_40px_rgba(0,0,0,0.2)] border border-[var(--color-border-light)] overflow-hidden">
        <div className="px-5 pt-5 pb-4 text-center">
          {result.success ? (
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--color-success-light)] flex items-center justify-center mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-success-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M5 12l5 5 9-9" />
              </svg>
            </div>
          ) : (
            <div className="w-12 h-12 mx-auto rounded-full bg-[var(--color-error-light)] flex items-center justify-center mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--color-error-dark)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          )}

          <h3 className="text-[var(--text-body)] font-[700] text-[var(--color-gray-800)]">
            {result.success ? t('editor.exportDialog.exportSuccess') : result.cancelled ? t('editor.exportDialog.exportCancelled') : t('editor.exportDialog.exportFailed')}
          </h3>

          <p className="text-[var(--text-caption)] text-[var(--color-gray-500)] mt-1.5 break-all px-1">
            {result.fileName}
          </p>

          {result.path && (
            <div className="mt-3 p-2.5 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] text-left">
              <p className="text-[11px] text-[var(--color-gray-400)] mb-0.5">{t('editor.exportDialog.saveLocation')}</p>
              <p className="text-[12px] text-[var(--color-gray-700)] break-all font-mono leading-relaxed">{result.path}</p>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="mt-3 text-left">
              <p className="text-[11px] text-[var(--color-warning-dark)] font-[600] mb-1">{t('editor.exportDialog.pageIssues')}</p>
              <ul className="max-h-[100px] overflow-y-auto text-[11px] text-[var(--color-gray-500)] space-y-0.5">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w.pageLabel}：{w.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] bg-[var(--color-gray-100)] hover:bg-[var(--color-gray-200)] transition-colors border-none cursor-pointer"
          >
            {t('editor.exportDialog.done')}
          </button>
          {result.success && result.path && (
            <button
              onClick={onOpenFile}
              className="flex-1 h-9 rounded-[var(--radius-md)] text-[var(--text-body-sm)] font-[600] text-white bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)] transition-colors border-none cursor-pointer"
            >
              {t('editor.exportDialog.openFile')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════ 设置弹窗 ══════════════════════════ */

export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const [pageRange, setPageRange] = useState<'all' | 'range'>('all');
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [quality, setQuality] = useState(90);
  const [dpi, setDpi] = useState(300);
  const [bleed, setBleed] = useState(0);
  const [spineWidth, setSpineWidth] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [exportPath, setExportPath] = useState('');
  const [fileName, setFileName] = useState('');
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const pages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);
  const addToast = useUIStore((s) => s.addToast);
  const drag = useDraggable(isOpen && !isExporting);
  const cancellingRef = useRef(false);

  const defaultName = (document.getElementById('project-title-input') as HTMLInputElement)?.value?.trim() || t('editor.exportDialog.defaultAlbumName');
  const pageMM = { w: albumSize?.width || 210, h: albumSize?.height || 280 };
  const pageSizeLabel = `${pageMM.w}×${pageMM.h} mm`;
  const ext = format === 'pdf' ? '.pdf' : format === 'jpg' ? '.jpg' : '.png';
  const fullFileName = (fileName || defaultName) + ext;

  const pixelW = Math.round(pageMM.w / 25.4 * dpi);
  const pixelH = Math.round(pageMM.h / 25.4 * dpi);
  const pixelCount = pixelW * pixelH;
  const exportPages = pageRange === 'all' ? pages.length : Math.min(endPage - startPage + 1, pages.length);

  const estSize = (() => {
    const pp = pixelCount * exportPages;
    switch (format) {
      case 'png': return pp * 0.35;
      case 'jpg': return pp * (quality / 100) * 0.12;
      case 'pdf': return pp * 0.25 + 5000;
      default: return pp * 0.3;
    }
  })();

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const dpiOptions = [
    { value: 72, label: '72 DPI', desc: t('editor.exportDialog.dpi72Desc'), px: `${Math.round(pageMM.w/25.4*72)}×${Math.round(pageMM.h/25.4*72)} px` },
    { value: 150, label: '150 DPI', desc: t('editor.exportDialog.dpi150Desc'), px: `${Math.round(pageMM.w/25.4*150)}×${Math.round(pageMM.h/25.4*150)} px` },
    { value: 300, label: '300 DPI', desc: t('editor.exportDialog.dpi300Desc'), px: `${Math.round(pageMM.w/25.4*300)}×${Math.round(pageMM.h/25.4*300)} px` },
    { value: 600, label: '600 DPI', desc: t('editor.exportDialog.dpi600Desc'), px: `${Math.round(pageMM.w/25.4*600)}×${Math.round(pageMM.h/25.4*600)} px` },
  ];

  const handleBrowse = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const dir = await open({ directory: true, title: t('editor.exportDialog.selectExportDir') });
      if (dir) setExportPath(dir as string);
    } catch { /* ignore */ }
  }, [t]);

  const handleCancel = useCallback(() => {
    if (cancellingRef.current) return;
    cancellingRef.current = true;
    cancelExport();
    setIsExporting(false);
    setProgress(0);
    cancellingRef.current = false;
    addToast({ type: 'info', message: t('editor.exportDialog.cancelledToast') });
  }, [addToast, t]);

  const handleExport = useCallback(async () => {
    const hasAnyPhoto = pages.some(p => p.placements.some(pl => pl.photoId !== null));
    if (!hasAnyPhoto) {
      addToast({ type: 'warning', message: t('editor.exportDialog.noPhotosToast') });
      return;
    }

    const totalPagesForUI = pageRange === 'all' ? pages.length : Math.max(0, endPage - startPage + 1);
    setIsExporting(true);
    setProgress(0);
    setCurrentPage(0);
    setTotalPages(totalPagesForUI);
    setExportResult(null);
    cancellingRef.current = false;

    const options: ExportOptions = {
      format,
      quality,
      dpi,
      pageRange: pageRange === 'all' ? { start: 1, end: pages.length } : { start: startPage, end: endPage },
      projectName: (fileName || defaultName),
      outputPath: exportPath || undefined,
      bleed,
      spineWidth,
      onProgress: (current, total) => {
        setCurrentPage(current);
        setTotalPages(total);
        setProgress(Math.round((current / total) * 100));
      }
    };

    try {
      let result: ExportResult;
      if (format === 'pdf') {
        result = await exportToPDF(options);
      } else if (format === 'png') {
        result = await exportToPNG(options);
      } else {
        result = await exportToJPG(options);
      }

      setExportResult(result);

      if (!result.cancelled) {
        if (result.warnings.length > 0) {
          const warningPages = result.warnings.map(w => w.pageLabel).join('、');
          addToast({ type: 'warning', message: t('editor.exportDialog.exportCompleteToast', { pages: warningPages }) });
        } else if (result.success) {
          addToast({ type: 'success', message: t('editor.exportDialog.exportSuccessToast', { fileName: result.fileName }) });
        }
      }
    } catch (error) {
      logger.error('Export failed:', error);
      setExportResult({
        success: false,
        path: null,
        fileName: fullFileName,
        warnings: [],
        cancelled: false,
      });
      addToast({ type: 'error', message: t('editor.exportDialog.exportFailedToast') });
    } finally {
      setIsExporting(false);
      setProgress(0);
    }
  }, [format, quality, dpi, bleed, spineWidth, pageRange, startPage, endPage, pages.length, defaultName, fileName, fullFileName, exportPath, addToast, t]);

  const handleOpenFile = useCallback(async () => {
    if (!exportResult?.path) return;
    if (!isTauri()) return;
    try {
      // shell:allow-open 在 Tauri v2.1+ 已弃用，改用自定义 Rust 命令打开文件
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_file', { path: exportResult.path });
    } catch (err) {
      console.error('[Export] open file failed:', err);
      addToast({ type: 'error', message: t('editor.exportDialog.openFileFailed') });
    }
  }, [exportResult?.path, addToast, t]);

  const handleResultClose = useCallback(() => {
    setExportResult(null);
    onClose();
  }, [onClose]);

  // Enter 确认 / Esc 取消快捷键：仅在设置面板可见时生效（导出中/结果态不响应 Enter）
  useDialogHotkeys({
    onConfirm: handleExport,
    onCancel: onClose,
    enabled: isOpen && !isExporting && !exportResult,
    confirmDisabled: isExporting,
  });

  if (!isOpen && !isExporting && !exportResult) return null;

  const primaryCss = 'var(--color-primary-600)';

  return (
    <>
      {/* 导出中：居中浮窗 */}
      {isExporting && (
        <ExportFloatWindow
          current={currentPage}
          total={totalPages}
          progress={progress}
          onCancel={handleCancel}
        />
      )}

      {/* 导出结果：居中浮窗 */}
      {exportResult && !isExporting && (
        <ExportResultWindow
          result={exportResult}
          onClose={handleResultClose}
          onOpenFile={handleOpenFile}
        />
      )}

      {/* 设置弹窗（导出中和有结果时隐藏） */}
      {isOpen && !isExporting && !exportResult && (
        <div className="fixed inset-0 bg-black/40 z-[var(--z-overlay)]">
          <div ref={drag.ref}
            className="absolute bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] w-[520px] max-h-[90vh] flex flex-col"
            style={{ left: drag.pos.x || '50%', top: drag.pos.y || '50%', transform: 'translate(-50%, -50%)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-light)] cursor-grab active:cursor-grabbing"
              onMouseDown={drag.onDown}>
              <div>
                <h2 className="text-[var(--text-body)] font-[700] text-[var(--color-gray-800)]">{t('editor.exportDialog.exportAlbum')}</h2>
                <p className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{pageSizeLabel} · {pixelW}×{pixelH} px · {fmtSize(estSize)}</p>
              </div>
              <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-gray-400)] hover:bg-[var(--color-gray-100)] hover:text-[var(--color-gray-600)] transition-colors border-none cursor-pointer">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0">
              {/* Format Tabs */}
              <div className="flex mx-4 mt-3 bg-[var(--color-gray-100)] rounded-[var(--radius-md)] p-0.5">
                {(['pdf', 'png', 'jpg'] as ExportFormat[]).map((fmt) => (
                  <button key={fmt}
                    className={`flex-1 py-1.5 text-[var(--text-body-sm)] font-[500] rounded-[var(--radius-sm)] transition-colors border-none cursor-pointer ${
                      format === fmt ? 'bg-white text-[var(--color-gray-800)] shadow-[var(--shadow-xs)]' : 'bg-transparent text-[var(--color-gray-500)] hover:text-[var(--color-gray-700)]'
                    }`}
                    onClick={() => setFormat(fmt)}>
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="px-4 py-3 space-y-3.5">
                {/* File Name & Path */}
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1">{t('editor.exportDialog.fileName')}</label>
                    <div className="flex items-center">
                      <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={defaultName}
                        className="flex-1 h-9 px-3 bg-white border border-[var(--color-border)] rounded-l-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-800)] outline-none focus:border-[var(--color-primary-400)] transition-all" />
                      <span className="h-9 px-3 flex items-center bg-[var(--color-gray-50)] border border-l-0 border-[var(--color-border)] rounded-r-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-500)]">{ext}</span>
                    </div>
                  </div>
                  {isTauri() && (
                    <div>
                      <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1">{t('editor.exportDialog.exportLocation')}</label>
                      <div className="flex items-center gap-2">
                        <input type="text" value={exportPath} readOnly placeholder={t('editor.exportDialog.defaultDownloadDir')}
                          className="flex-1 h-9 px-3 bg-[var(--color-gray-50)] border border-[var(--color-border)] rounded-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-500)] outline-none" />
                        <button onClick={handleBrowse}
                          className="h-9 px-3 text-[var(--text-body-sm)] font-[500] text-[var(--color-primary-600)] bg-[var(--color-primary-50)] rounded-[var(--radius-md)] hover:bg-[var(--color-primary-100)] transition-colors border-none cursor-pointer">{t('editor.exportDialog.browse')}</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* DPI */}
                <div>
                  <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.exportDialog.outputResolution')}</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {dpiOptions.map((opt) => (
                      <button key={opt.value}
                        className={`px-2.5 py-2 rounded-[var(--radius-sm)] text-left border cursor-pointer transition-colors ${
                          dpi === opt.value
                            ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]'
                            : 'border-[var(--color-border)] bg-white hover:border-[var(--color-primary-300)]'
                        }`}
                        onClick={() => setDpi(opt.value)}>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[var(--text-body-sm)] font-[600] ${dpi === opt.value ? 'text-[var(--color-primary-700)]' : 'text-[var(--color-gray-700)]'}`}>{opt.label}</span>
                          <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">{opt.px}</span>
                        </div>
                        <p className={`text-[var(--text-caption)] mt-0.5 ${dpi === opt.value ? 'text-[var(--color-primary-500)]' : 'text-[var(--color-gray-400)]'}`}>{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quality */}
                {format === 'jpg' && (
                  <div>
                    <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1">
                      {t('editor.exportDialog.imageQuality')} · <span className="text-[var(--color-primary-600)]">{quality}%</span>
                    </label>
                    <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))}
                      className="w-full h-1 rounded-full appearance-none bg-[var(--color-gray-200)] outline-none accent-[var(--color-primary-600)] cursor-pointer" />
                  </div>
                )}

                {/* 印刷增强：出血 + 书脊（仅 PDF） */}
                {format === 'pdf' && (
                  <div className="pt-2 border-t border-[var(--color-border-light)]">
                    <div className="text-[12px] font-[600] text-[var(--color-gray-700)] mb-2">{t('editor.exportDialog.printEnhance')}</div>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-600)] mb-1">{t('editor.print.bleed')} · <span className="text-[var(--color-primary-600)]">{bleed} mm</span></label>
                        <input type="range" min={0} max={10} step={1} value={bleed}
                          onChange={(e) => setBleed(Number(e.target.value))}
                          className="w-full accent-[var(--color-brand)]" />
                        <p className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-0.5">{t('editor.print.bleedHint')}</p>
                      </div>
                      <div>
                        <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-600)] mb-1">{t('editor.print.spine')} · <span className="text-[var(--color-primary-600)]">{spineWidth} mm</span></label>
                        <input type="range" min={0} max={20} step={1} value={spineWidth}
                          onChange={(e) => setSpineWidth(Number(e.target.value))}
                          className="w-full accent-[var(--color-brand)]" />
                        <p className="text-[var(--text-nano)] text-[var(--color-gray-400)] mt-0.5">{t('editor.print.spineHint')}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Page Range */}
                <div>
                  <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.exportDialog.pageRange')}</label>
                  <div className="flex items-center gap-2">
                    <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors flex-1 ${
                      pageRange === 'all' ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                    }`}>
                      <input type="radio" name="pageRange" checked={pageRange === 'all'} onChange={() => setPageRange('all')} className="accent-[var(--color-primary-600)] w-3 h-3" />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{t('editor.exportDialog.allPages', { count: pages.length })}</span>
                    </label>
                    <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] border cursor-pointer transition-colors flex-1 ${
                      pageRange === 'range' ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                    }`}>
                      <input type="radio" name="pageRange" checked={pageRange === 'range'} onChange={() => setPageRange('range')} className="accent-[var(--color-primary-600)] w-3 h-3" />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{t('editor.exportDialog.customRange')}</span>
                    </label>
                  </div>
                  {pageRange === 'range' && (
                    <div className="flex items-center gap-2 mt-2">
                      <input type="number" min={1} max={pages.length} value={startPage} onChange={(e) => setStartPage(Number(e.target.value))}
                        className="w-14 h-8 px-1.5 text-center border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--text-body-sm)] outline-none focus:border-[var(--color-primary-400)]" />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-500)]">{t('editor.exportDialog.to')}</span>
                      <input type="number" min={1} max={pages.length} value={endPage} onChange={(e) => setEndPage(Number(e.target.value))}
                        className="w-14 h-8 px-1.5 text-center border border-[var(--color-border)] rounded-[var(--radius-sm)] text-[var(--text-body-sm)] outline-none focus:border-[var(--color-primary-400)]" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 px-4 py-4 border-t border-[var(--color-border-light)] bg-white shrink-0">
              <button onClick={onClose} disabled={isExporting}
                className="h-9 px-4 text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-600)] bg-[var(--color-gray-100)] rounded-[var(--radius-md)] hover:bg-[var(--color-gray-200)] transition-colors border-none cursor-pointer disabled:opacity-50">{t('editor.exportDialog.cancel')}</button>
              <button onClick={handleExport} disabled={isExporting}
                className="h-9 px-5 text-[var(--text-body-sm)] font-[600] text-white rounded-[var(--radius-md)] transition-all border-none cursor-pointer disabled:opacity-50"
                style={{ background: isExporting ? 'var(--color-gray-400)' : `linear-gradient(135deg, ${primaryCss}, #4834D4)` }}>{t('editor.exportDialog.startExport')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
