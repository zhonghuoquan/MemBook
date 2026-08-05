/**
 * 去重工具 — 三级哈希（size → 头部4KB → 全量 SHA256）
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  deduplicatePhotos,
  formatBytes,
  isTauri,
  type PhotoFileInfo,
  type DedupeResult,
  type ToolProgress,
} from '../../../photo-tools';
import { ToolCard, ProgressBar, PrimaryButton, type ToolProps } from './shared';

export function DedupeTool({ photos, sourceMode, onPhotosUpdate, addToast }: ToolProps) {
  const { t } = useTranslation();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [result, setResult] = useState<DedupeResult | null>(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // photos 变化时清除旧结果（修复：第二次导入文件夹后旧结果残留）
  useEffect(() => {
    setResult(null);
    setConfirmMode(false);
    setProgress(null);
  }, [photos]);

  const handleStart = async () => {
    if (photos.length < 2) return;
    abortRef.current = new AbortController();
    setRunning(true);
    setResult(null);
    setConfirmMode(false);

    try {
      const res = await deduplicatePhotos(photos, {
        signal: abortRef.current.signal,
        onProgress: setProgress,
      });
      setResult(res);
      if (res.totalGroups > 0) {
        addToast({
          type: 'info',
          message: t('home.organize.dedupe.toastFound', { groups: res.totalGroups, count: res.duplicateCount, size: formatBytes(res.freedBytes) }),
        });
      } else {
        addToast({ type: 'success', message: t('home.organize.dedupe.toastNoDuplicates') });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        addToast({ type: 'error', message: t('home.organize.dedupe.toastDedupeFailed', { message: (err as Error).message }) });
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleCancel = () => abortRef.current?.abort();

  const handleDelete = async () => {
    if (!result || deleting) return;
    setDeleting(true);
    const toDelete: PhotoFileInfo[] = [];
    for (const g of result.groups) {
      for (let i = 0; i < g.files.length; i++) {
        if (i !== g.keepIndex) toDelete.push(g.files[i]);
      }
    }

    let ok = 0, fail = 0;
    try {
      if (sourceMode === 'library') {
        // 库内模式：仅从列表移除（不删 DB，用户可重新加载项目恢复）
        for (const f of toDelete) {
          if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
          ok++;
        }
      } else if (isTauri()) {
        const { remove } = await import('@tauri-apps/plugin-fs');
        for (const f of toDelete) {
          try {
            if (f.path) { await remove(f.path); ok++; } else fail++;
          } catch { fail++; }
        }
      } else {
        // Web 模式：释放 blob URL + 从列表移除
        for (const f of toDelete) {
          if (f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
          ok++;
        }
      }

      // 从 photos 列表中移除已删文件
      const deleteIds = new Set(toDelete.map((f) => f.id));
      onPhotosUpdate((prev) => prev.filter((p) => !deleteIds.has(p.id)));

      addToast({
        type: fail > 0 ? 'warning' : 'success',
        message: fail > 0 ? t('home.organize.dedupe.toastDeletedWithFail', { ok, fail }) : t('home.organize.dedupe.toastDeleted', { ok }),
      });
      setResult(null);
      setConfirmMode(false);
    } catch (err) {
      addToast({ type: 'error', message: t('home.organize.dedupe.toastDeleteFailed', { message: (err as Error).message }) });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ToolCard
      title={t('home.organize.dedupe.title')}
      description={t('home.organize.dedupe.description')}
      color="orange"
      icon={
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
          <path d="M9 2a7 7 0 105.293 11.707l3.707 3.707" />
          <path d="M15 15l3 3" />
          <line x1="18" y1="9" x2="12" y2="15" />
        </svg>
      }
    >
      {!result && !running && (
        <PrimaryButton onClick={handleStart} disabled={photos.length < 2}>
          {t('home.organize.dedupe.startScan')}
        </PrimaryButton>
      )}

      {running && (
        <div>
          <ProgressBar progress={progress} />
          <button onClick={handleCancel} className="mt-2 px-3 py-1.5 rounded text-xs border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
            {t('home.organize.dedupe.cancel')}
          </button>
        </div>
      )}

      {result && result.totalGroups > 0 && (
        <DedupeResults
          result={result}
          confirmMode={confirmMode}
          onToggleConfirm={() => setConfirmMode(!confirmMode)}
          onDelete={handleDelete}
          deleting={deleting}
        />
      )}

      {result && result.totalGroups === 0 && (
        <div className="mt-2 px-3 py-2 rounded-lg bg-green-50 text-green-700 text-sm">{t('home.organize.dedupe.noDuplicatesResult')}</div>
      )}
    </ToolCard>
  );
}

function DedupeResults({
  result, confirmMode, onToggleConfirm, onDelete, deleting,
}: {
  result: DedupeResult;
  confirmMode: boolean;
  onToggleConfirm: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="mt-3 space-y-3">
      <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-orange-50 text-sm">
        <span className="text-orange-800">
          {t('home.organize.dedupe.foundSummary', { groups: result.totalGroups, count: result.duplicateCount })}
        </span>
        <span className="text-orange-600 font-mono text-xs">{t('home.organize.dedupe.canFree', { size: formatBytes(result.freedBytes) })}</span>
      </div>

      <div className="max-h-[300px] overflow-auto space-y-2 pr-1">
        {result.groups.map((g) => (
          <div key={g.groupId} className="rounded-lg border border-[var(--color-border)] overflow-hidden">
            <button onClick={() => toggle(g.groupId)} className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-[var(--color-surface-hover)] border-none cursor-pointer bg-transparent">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" className={`w-3 h-3 text-[var(--color-gray-400)] transition-transform ${expanded.has(g.groupId) ? 'rotate-90' : ''}`}>
                <path d="M4 2l4 4-4 4" />
              </svg>
              <span className="font-mono text-xs text-[var(--color-gray-500)]">{g.hashShort}</span>
              <span className="text-xs text-[var(--color-text-secondary)]">{t('home.organize.dedupe.filesCount', { count: g.files.length, size: formatBytes(g.fileSize) })}</span>
            </button>
            {expanded.has(g.groupId) && (
              <div className="px-3 pb-2 space-y-1">
                {g.files.map((f, i) => (
                  <div key={f.id} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${i === g.keepIndex ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
                    <span>{i === g.keepIndex ? '✅' : '❌'}</span>
                    <span className="truncate flex-1 min-w-0">{f.relativePath || f.name}</span>
                    {i === g.keepIndex && <span className="shrink-0 text-green-600">{t('home.organize.dedupe.keep')}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        {!confirmMode ? (
          <PrimaryButton variant="danger" onClick={onToggleConfirm}>
            {t('home.organize.dedupe.confirmDeleteButton', { count: result.duplicateCount })}
          </PrimaryButton>
        ) : (
          <>
            <PrimaryButton variant="danger" onClick={onDelete} loading={deleting}>
              {t('home.organize.dedupe.confirmExecuteDelete')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={onToggleConfirm} disabled={deleting}>
              {t('home.organize.dedupe.backToPreview')}
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
}
