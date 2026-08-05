import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, useUIStore } from '../../store';
import { useDraggable } from '../../hooks/useDraggable';
import { generatePrintPreviewsStream, printPages, type PrintRange, type PrintColor, type PrintDuplex, type PrintOrientation, type PrintPaperSize } from '../../utils/printEngine';
import { ModalGuard } from '../../utils/modal-guard';
import { logger } from '../../utils/logger';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export interface PrinterInfo {
  name: string;
  isDefault: boolean;
}

export function PrintDialog({ isOpen, onClose }: Props) {
  const pages = useEditorStore((s) => s.pages);
  const albumSize = useEditorStore((s) => s.albumSize);
  const addToast = useUIStore((s) => s.addToast);
  const drag = useDraggable(isOpen);
  const { t } = useTranslation();

  const [range, setRange] = useState<PrintRange>('all');
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const [copies, setCopies] = useState(1);
  const [color, setColor] = useState<PrintColor>('color');
  const [duplex, setDuplex] = useState<PrintDuplex>('single');
  const [paperSize, setPaperSize] = useState<PrintPaperSize>('auto');
  const [orientation, setOrientation] = useState<PrintOrientation>('auto');
  const [selectedPrinter, setSelectedPrinter] = useState<string>('');
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);

  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalPreviewPages, setTotalPreviewPages] = useState(0);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isLoadingPrinters, setIsLoadingPrinters] = useState(false);
  const previewAbortRef = useRef(false);
  // 流式生成时收集已生成页面，定期 flush 到 state 避免频繁 re-render
  const pendingUrlsRef = useRef<string[]>([]);
  const flushRafRef = useRef<number | null>(null);

  // 虚拟滚动状态：只渲染可见页 + 前后缓冲页，避免几百页 DOM 同时存在
  const PREVIEW_WIDTH = 360;
  const GAP = 12;
  const BUFFER_PAGES = 3;
  const previewHeight = albumSize ? PREVIEW_WIDTH * (albumSize.height / albumSize.width) : 480;
  const slotHeight = previewHeight + GAP;
  const [visibleStart, setVisibleStart] = useState(0);
  const [visibleEnd, setVisibleEnd] = useState(15);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(-1);

  const totalPages = pages.length;

  useEffect(() => {
    if (!isOpen) return;
    setEndPage(totalPages);
  }, [isOpen, totalPages]);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoadingPrinters(true);
    import('@tauri-apps/api/core')
      .then((m) => m.invoke<PrinterInfo[]>('get_printers'))
      .then((list) => {
        if (!Array.isArray(list)) list = [];
        setPrinters(list);
        const defaultPrinter = list.find((p) => p.isDefault) || list[0];
        if (defaultPrinter) {
          setSelectedPrinter(defaultPrinter.name);
        }
      })
      .catch((err) => {
        logger.error('获取打印机列表失败:', err);
        addToast({ type: 'warning', message: t('editor.print.getPrintersFailed') });
      })
      .finally(() => {
        setIsLoadingPrinters(false);
      });
  }, [isOpen, addToast]);

  useEffect(() => {
    if (isOpen) ModalGuard.open();
    return () => { ModalGuard.close(); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    previewAbortRef.current = false;

    const timer = setTimeout(() => {
      setPreviewLoading(true);
      // 重置流式生成状态
      pendingUrlsRef.current = [];
      setPreviewUrls([]);
      setLoadedCount(0);
      setTotalPreviewPages(0);
      if (flushRafRef.current !== null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }

      // 批量 flush：用 requestAnimationFrame 合并同一帧内多次 onPage 回调，避免每页 re-render
      const flush = () => {
        flushRafRef.current = null;
        if (previewAbortRef.current) return;
        const urls = [...pendingUrlsRef.current];
        setPreviewUrls(urls);
        setLoadedCount(urls.length);
      };

      const onPage = (_pageIndex: number, dataUrl: string) => {
        if (previewAbortRef.current) return;
        pendingUrlsRef.current.push(dataUrl);
        if (flushRafRef.current === null) {
          flushRafRef.current = requestAnimationFrame(flush);
        }
      };

      const onProgress = (_current: number, total: number) => {
        if (previewAbortRef.current) return;
        setTotalPreviewPages(total);
      };

      generatePrintPreviewsStream(
        {
          range,
          startPage,
          endPage,
          color,
          duplex: 'single',
          copies: 1,
          pagesPerSheet: 1,
          paperSize,
          orientation,
        },
        onPage,
        onProgress,
      )
        .then(() => {
          if (previewAbortRef.current) return;
          // 最终 flush 确保所有页面都已写入 state
          if (flushRafRef.current !== null) {
            cancelAnimationFrame(flushRafRef.current);
            flushRafRef.current = null;
          }
          flush();
        })
        .catch((err) => {
          logger.error('打印预览生成失败:', err);
        })
        .finally(() => {
          if (!previewAbortRef.current) setPreviewLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timer);
      previewAbortRef.current = true;
      if (flushRafRef.current !== null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
    };
  }, [isOpen, range, startPage, endPage, color, paperSize, orientation]);

  const handlePrint = useCallback(async () => {
    if (totalPages === 0) {
      addToast({ type: 'warning', message: t('editor.print.noPages') });
      return;
    }
    if (isPrinting) return;
    if (!selectedPrinter) {
      addToast({ type: 'warning', message: t('editor.print.selectPrinter') });
      return;
    }
    setIsPrinting(true);
    try {
      await printPages({
        range,
        startPage,
        endPage,
        color,
        duplex,
        copies,
        pagesPerSheet: 1,
        paperSize,
        orientation,
        printer: selectedPrinter,
        onProgress: () => {},
      });
      addToast({ type: 'success', message: t('editor.print.jobSent') });
      onClose();
    } catch (error) {
      logger.error('打印失败:', error);
      addToast({ type: 'error', message: t('editor.print.printFailedConnection') });
    } finally {
      setIsPrinting(false);
    }
  }, [range, startPage, endPage, color, duplex, copies, paperSize, orientation, selectedPrinter, totalPages, addToast, onClose, isPrinting]);

  const pageSizeLabel = albumSize ? `${albumSize.width}×${albumSize.height} mm` : t('editor.print.unknownSize');

  // 虚拟滚动：根据 scrollTop 计算可见页范围，只渲染可见页 + 前后缓冲页
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;
    // 避免微小滚动触发频繁 setState
    if (Math.abs(scrollTop - lastScrollTopRef.current) < 8) return;
    lastScrollTopRef.current = scrollTop;

    const viewportH = el.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / slotHeight) - BUFFER_PAGES);
    const end = Math.min(
      previewUrls.length,
      Math.ceil((scrollTop + viewportH) / slotHeight) + BUFFER_PAGES,
    );
    setVisibleStart(start);
    setVisibleEnd(end);
  }, [slotHeight, previewUrls.length]);

  // 预览列表长度变化时，重置滚动位置并重新计算可见范围
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      lastScrollTopRef.current = -1;
    }
    setVisibleStart(0);
    setVisibleEnd(15);
  }, [range, startPage, endPage, color, paperSize, orientation]);

  // 预览列表长度变化时，重新计算可见范围（流式追加时）
  useEffect(() => {
    handleScroll();
  }, [previewUrls.length, handleScroll]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[1000] flex items-center justify-center"
      onMouseDown={handleBackdropClick}
      style={{ pointerEvents: 'auto' }}
    >
      <div
        ref={drag.ref}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] w-[900px] max-w-[96vw] h-[680px] max-h-[92vh] flex flex-col"
        style={{
          left: drag.pos.x || '50%',
          top: drag.pos.y || '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border-light)] cursor-grab active:cursor-grabbing shrink-0"
          onMouseDown={drag.onDown}
        >
          <div>
            <h2 className="text-[var(--text-body)] font-[700] text-[var(--color-gray-800)]">{t('editor.print.title')}</h2>
            <p className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{pageSizeLabel} · {t('editor.print.totalPages', { count: totalPages })}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full text-[var(--color-gray-400)] hover:bg-[var(--color-gray-100)] hover:text-[var(--color-gray-600)] transition-colors border-none cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="w-[320px] border-r border-[var(--color-border-light)] flex flex-col shrink-0">
            <div className="flex-1 overflow-y-auto p-4 space-y-4 ps-scroll">
              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.printer')}</label>
                {isLoadingPrinters ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] text-[var(--text-body-sm)] text-[var(--color-gray-500)]">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {t('common.loading')}
                  </div>
                ) : (
                  <select
                    value={selectedPrinter}
                    onChange={(e) => setSelectedPrinter(e.target.value)}
                    className="w-full px-3 py-2.5 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-white text-[var(--text-body-sm)] text-[var(--color-gray-700)] outline-none focus:border-[var(--color-brand)] cursor-pointer"
                  >
                    <option value="" disabled>{t('editor.print.selectPrinter')}</option>
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} {p.isDefault && t('editor.print.defaultPrinter')}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.range')}</label>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'all', label: t('editor.print.allPages') },
                    { value: 'current', label: t('editor.print.currentPage') },
                    { value: 'custom', label: t('editor.print.customRange') },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                        range === opt.value ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="print-range"
                        className="accent-[var(--color-brand)]"
                        checked={range === opt.value}
                        onChange={() => setRange(opt.value as PrintRange)}
                      />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{opt.label}</span>
                    </label>
                  ))}
                </div>
                {range === 'custom' && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] px-2 py-1.5">
                      <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{t('editor.print.from')}</span>
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={startPage}
                        onChange={(e) => setStartPage(Math.max(1, Math.min(totalPages, Number(e.target.value) || 1)))}
                        className="w-10 border-none bg-transparent text-[13px] font-[600] text-[var(--color-gray-800)] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                    </div>
                    <span className="text-[var(--color-gray-400)]">-</span>
                    <div className="flex items-center gap-1 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] px-2 py-1.5">
                      <input
                        type="number"
                        min={1}
                        max={totalPages}
                        value={endPage}
                        onChange={(e) => setEndPage(Math.max(1, Math.min(totalPages, Number(e.target.value) || 1)))}
                        className="w-10 border-none bg-transparent text-[13px] font-[600] text-[var(--color-gray-800)] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{t('editor.print.page')}</span>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.copies')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={copies}
                    onChange={(e) => setCopies(Number(e.target.value))}
                    className="flex-1 h-1.5 rounded-full appearance-none bg-[var(--color-gray-200)] outline-none accent-[var(--color-brand)] cursor-pointer"
                  />
                  <div className="flex items-center gap-0.5 bg-[var(--color-gray-50)] rounded-[var(--radius-md)] px-2 py-1.5 min-w-[48px]">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={copies}
                      onChange={(e) => setCopies(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                      className="w-7 border-none bg-transparent text-[13px] font-[600] text-[var(--color-gray-800)] outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-[var(--text-caption)] text-[var(--color-gray-500)]">{t('editor.print.copiesUnit')}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.color')}</label>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'color', label: t('editor.print.colorFull') },
                    { value: 'grayscale', label: t('editor.print.grayscale') },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                        color === opt.value ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="print-color"
                        className="accent-[var(--color-brand)]"
                        checked={color === opt.value}
                        onChange={() => setColor(opt.value as PrintColor)}
                      />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.duplex')}</label>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'single', label: t('editor.print.singleSide') },
                    { value: 'longEdge', label: t('editor.print.longEdge') },
                    { value: 'shortEdge', label: t('editor.print.shortEdge') },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                        duplex === opt.value ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="print-duplex"
                        className="accent-[var(--color-brand)]"
                        checked={duplex === opt.value}
                        onChange={() => setDuplex(opt.value as PrintDuplex)}
                      />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.paperSize')}</label>
                <select
                  value={paperSize}
                  onChange={(e) => setPaperSize(e.target.value as PrintPaperSize)}
                  className="w-full px-3 py-2.5 border border-[var(--color-border)] rounded-[var(--radius-md)] bg-white text-[var(--text-body-sm)] text-[var(--color-gray-700)] outline-none focus:border-[var(--color-brand)] cursor-pointer"
                >
                  <option value="auto">{t('editor.print.paperAuto')}</option>
                  <option value="a4">A4 (210×297mm)</option>
                  <option value="a3">A3 (297×420mm)</option>
                  <option value="letter">{t('editor.print.paperLetter')}</option>
                  <option value="legal">{t('editor.print.paperLegal')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-700)] mb-1.5">{t('editor.print.orientation')}</label>
                <div className="flex flex-col gap-1.5">
                  {[
                    { value: 'auto', label: t('editor.print.orientationAuto') },
                    { value: 'portrait', label: t('editor.print.portrait') },
                    { value: 'landscape', label: t('editor.print.landscape') },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-md)] border cursor-pointer transition-colors ${
                        orientation === opt.value ? 'border-[var(--color-primary-400)] bg-[var(--color-primary-50)]' : 'border-[var(--color-border)] hover:bg-[var(--color-gray-50)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="print-orientation"
                        className="accent-[var(--color-brand)]"
                        checked={orientation === opt.value}
                        onChange={() => setOrientation(opt.value as PrintOrientation)}
                      />
                      <span className="text-[var(--text-body-sm)] text-[var(--color-gray-700)]">{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 bg-[var(--color-gray-50)] flex flex-col min-w-0">
            <div className="px-4 py-2 border-b border-[var(--color-border-light)] flex items-center justify-between shrink-0">
              <span className="text-[var(--text-body-sm)] font-[600] text-[var(--color-gray-700)]">{t('editor.print.preview')}</span>
              <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
                {previewLoading && totalPreviewPages > 0
                  ? t('editor.print.generating', { loaded: loadedCount, total: totalPreviewPages })
                  : previewLoading
                    ? t('editor.print.generatingSimple')
                    : t('editor.print.totalPages', { count: previewUrls.length })}
              </span>
            </div>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-4 ps-scroll"
            >
              {previewLoading && previewUrls.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[var(--color-gray-400)] text-[var(--text-body-sm)]">
                  {t('editor.print.generatingPreview')}
                </div>
              ) : previewUrls.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[var(--color-gray-400)] text-[var(--text-body-sm)]">
                  {t('editor.print.noPreviewPages')}
                </div>
              ) : (
                <div
                  style={{
                    position: 'relative',
                    height: previewUrls.length * slotHeight,
                  }}
                >
                  {previewUrls.slice(visibleStart, visibleEnd).map((url, i) => {
                    const idx = visibleStart + i;
                    return (
                      <div
                        key={idx}
                        className="absolute left-0 right-0 flex justify-center"
                        style={{ top: idx * slotHeight, height: previewHeight }}
                      >
                        <div
                          className="relative bg-white shadow-[var(--shadow-sm)] rounded-[var(--radius-md)] overflow-hidden"
                          style={{ width: PREVIEW_WIDTH, height: previewHeight }}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt={t('editor.print.pagePreviewAlt', { n: idx + 1 })}
                              className="w-full h-full object-contain"
                              crossOrigin="anonymous"
                            />
                          ) : (
                            <div className="w-full h-full bg-[var(--color-gray-100)] animate-pulse" />
                          )}
                          <div className="absolute bottom-1.5 right-1.5 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded">
                            {t('editor.print.pageNumber', { n: idx + 1 })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-[var(--color-border-light)] bg-[var(--color-gray-25)] rounded-b-[var(--radius-xl)]">
          <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
            {t('editor.print.directSendHint')}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[var(--color-border)] bg-white text-[13px] font-[500] text-[var(--color-gray-600)] cursor-pointer hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handlePrint}
              disabled={isPrinting || previewLoading || previewUrls.length === 0 || !selectedPrinter}
              className="px-5 py-2 rounded-lg border-none bg-[var(--color-brand)] text-white text-[13px] font-[600] cursor-pointer hover:bg-[var(--color-primary-600)] transition-colors shadow-[0_2px_8px_rgba(108,99,255,0.25)] disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isPrinting ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('editor.print.printingButton')}
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6V2h8v4" /><path d="M2 10h12v4H2z" /><path d="M4 10V6h8v4" />
                  </svg>
                  {t('editor.print.printButton')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
