/**
 * LibraryPickerDialog - 项目库选择弹窗
 *
 * 用于"扫描项目库"功能：从 IndexedDB 加载项目列表，用户选择后回调。
 * 选择后由 OrganizePanel 负责加载该项目的 Photo[] 并转换为 PhotoFileInfo[]。
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AlbumProject } from '../../../types';
import { listProjects, loadPhotos } from '../../../db';
import { logger } from '../../../utils/logger';

interface LibraryPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (project: AlbumProject) => void;
}

/** 格式化日期显示为 YYYY-MM-DD */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

/** 相册类型 emoji 映射 */
function albumTypeIcon(type?: string): string {
  const map: Record<string, string> = {
    travel: '✈️', family: '👨‍👩‍👧', wedding: '💒', growth: '🌱', pet: '🐾', other: '📷',
  };
  return map[type || ''] || '📷';
}

export function LibraryPickerDialog({ open, onClose, onSelect }: LibraryPickerDialogProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<AlbumProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [photoCounts, setPhotoCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');

  // 弹窗打开时加载项目列表 + 各项目照片数量
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch('');
    setPhotoCounts({});
    listProjects()
      .then(async (list) => {
        setProjects(list);
        // 并行加载各项目的照片数量
        const counts: Record<string, number> = {};
        await Promise.all(
          list.map(async (p) => {
            try {
              const photos = await loadPhotos(p.id);
              counts[p.id] = photos.length;
            } catch {
              counts[p.id] = 0;
            }
          }),
        );
        setPhotoCounts(counts);
      })
      .catch((err) => logger.warn('[LibraryPicker] 加载失败:', err))
      .finally(() => setLoading(false));
  }, [open]);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = search.trim()
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('home.organize.libraryPicker.ariaLabel')}
    >
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* 内容区 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-[var(--color-brand)]">
              <rect x="2" y="2" width="12" height="12" rx="1" />
              <circle cx="6" cy="6" r="1.2" />
              <circle cx="10" cy="6" r="1.2" />
              <circle cx="6" cy="10" r="1.2" />
              <circle cx="10" cy="10" r="1.2" />
            </svg>
            <h2 className="text-lg font-[700] text-[var(--color-text-primary)]">{t('home.organize.libraryPicker.title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[var(--color-gray-100)] transition-colors cursor-pointer border-none"
            aria-label={t('home.organize.libraryPicker.closeAriaLabel')}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-4 h-4 text-[var(--color-gray-500)]">
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-6 py-3 border-b border-[var(--color-border)]">
          <div className="relative">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-gray-400)]">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('home.organize.libraryPicker.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--color-border)] text-sm
                         focus:outline-none focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand)]/20
                         placeholder:text-[var(--color-gray-400)]"
            />
          </div>
        </div>

        {/* 项目列表 */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <svg className="w-8 h-8 animate-spin text-[var(--color-brand)]" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span className="ml-3 text-sm text-[var(--color-gray-500)]">{t('home.organize.libraryPicker.loading')}</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-gray-100)] flex items-center justify-center mb-4">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-[var(--color-gray-400)]">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
              </div>
              {projects.length === 0 ? (
                <>
                  <p className="text-[var(--color-gray-600)] font-[600] mb-1">{t('home.organize.libraryPicker.noProjectsTitle')}</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{t('home.organize.libraryPicker.noProjectsDesc')}</p>
                </>
              ) : (
                <>
                  <p className="text-[var(--color-gray-600)] font-[600] mb-1">{t('home.organize.libraryPicker.noMatchTitle')}</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{t('home.organize.libraryPicker.noMatchDesc')}</p>
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((project) => {
                const count = photoCounts[project.id] ?? 0;
                return (
                  <button
                    key={project.id}
                    onClick={() => {
                      onSelect(project);
                      onClose();
                    }}
                    className="group text-left p-4 rounded-xl border border-[var(--color-border)]
                               hover:border-[var(--color-brand)] hover:shadow-md hover:-translate-y-px
                               transition-all duration-200 bg-white cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[var(--color-brand-bg)] flex items-center justify-center text-xl shrink-0">
                        {albumTypeIcon(project.albumType)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-[700] text-[var(--color-text-primary)] truncate">{project.name}</div>
                        <div className="text-xs text-[var(--color-text-secondary)] mt-0.5 flex items-center gap-2">
                          <span className="text-[var(--color-brand)] font-[600]">{t('home.organize.libraryPicker.photoCount', { count })}</span>
                          <span className="text-[var(--color-border)]">·</span>
                          <span>{formatDate(project.updatedAt)}</span>
                        </div>
                      </div>
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[var(--color-gray-300)] group-hover:text-[var(--color-brand)] transition-colors shrink-0 mt-0.5">
                        <path d="M6 4l4 4-4 4" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-6 py-3 border-t border-[var(--color-border)]">
          <p className="text-xs text-[var(--color-text-tertiary)] text-center">
            {t('home.organize.libraryPicker.footerHint')}
          </p>
        </div>
      </div>
    </div>
  );
}
