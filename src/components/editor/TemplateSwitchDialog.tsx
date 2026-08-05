/**
 * TemplateSwitchDialog — 模板切换选择对话框（PRD 3.3.3 场景 2）
 *
 * 当已有照片数量（N）多于新模板槽位数（M）时弹出，
 * 让用户选择要保留的 M 张照片，未选中的回到照片列表。
 */
import { useState, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { findTemplateById } from '../../types';
import type { AlbumPage, Photo } from '../../types';
import { useTranslation } from 'react-i18next';

interface TemplateSwitchDialogProps {
  open: boolean;
  currentPage: AlbumPage;
  targetTemplateId: string;
  filledPhotos: Photo[];
  onConfirm: (selectedPhotoIds: string[]) => void;
  onCancel: () => void;
}

export function TemplateSwitchDialog({
  open,
  currentPage: _currentPage,
  targetTemplateId,
  filledPhotos,
  onConfirm,
  onCancel,
}: TemplateSwitchDialogProps) {
  const { t } = useTranslation();
  const targetTemplate = useMemo(
    () => findTemplateById(targetTemplateId),
    [targetTemplateId],
  );

  const M = targetTemplate?.slots.length ?? 0;

  // 默认勾选前 M 张
  const [selected, setSelected] = useState<Set<string>>(() => {
    const ids = filledPhotos.slice(0, M).map((p) => p.id);
    return new Set(ids);
  });

  // 当 dialog 关闭时重置选择状态
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSelected(new Set(filledPhotos.slice(0, M).map((p) => p.id)));
    }
  }

  const togglePhoto = (photoId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        // 已达上限不允许继续添加
        if (next.size >= M) return prev;
        next.add(photoId);
      }
      return next;
    });
  };

  const N = filledPhotos.length;
  const canConfirm = selected.size > 0 && selected.size <= M;

  if (!targetTemplate) return null;

  return (
    <Modal open={open} onClose={onCancel} title={t('editor.templateSwitch.title')} maxWidth="480px"
      footer={
        <div className="flex justify-end gap-2 pt-4 border-t border-[var(--color-border-light)]">
          <Button variant="secondary" onClick={onCancel}>{t('editor.templateSwitch.cancel')}</Button>
          <Button variant="primary" disabled={!canConfirm} onClick={() => onConfirm(Array.from(selected))}>{t('editor.templateSwitch.confirm')}</Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* 说明 */}
        <div className="text-[var(--text-body-sm)] text-[var(--color-gray-600)] leading-relaxed">
          {t('editor.templateSwitch.description', { name: targetTemplate.name, M: M, N: N })}
        </div>

        {/* 照片列表 */}
        <div className="max-h-[320px] overflow-y-auto space-y-1.5 -mx-1 px-1">
          {filledPhotos.map((photo, idx) => {
            const isChecked = selected.has(photo.id);
            const isDisabled = !isChecked && selected.size >= M;

            return (
              <label
                key={photo.id}
                className={`
                  flex items-center gap-3 p-2 rounded-[var(--radius-md)] cursor-pointer
                  transition-colors select-none
                  ${isChecked
                    ? 'bg-[var(--color-surface-selected)] ring-1 ring-[var(--color-brand)]'
                    : isDisabled
                      ? 'opacity-40 cursor-not-allowed hover:bg-transparent'
                      : 'hover:bg-[var(--color-surface-hover)]'
                  }
                `}
              >
                {/* 序号 */}
                <span className="w-5 text-center text-[var(--text-caption)] text-[var(--color-gray-400)] shrink-0 font-[500]">
                  {idx + 1}
                </span>

                {/* 缩略图 */}
                <div className="w-12 h-12 rounded-[var(--radius-sm)] overflow-hidden bg-[var(--color-gray-100)] shrink-0">
                  <img
                    src={photo.src}
                    alt={photo.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    draggable={false}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>

                {/* 名称 */}
                <span className="flex-1 min-w-0 text-[var(--text-body-sm)] text-[var(--color-gray-700)] truncate">
                  {photo.name}
                </span>

                {/* 复选框 */}
                <div
                  className={`
                    w-5 h-5 rounded-[var(--radius-xs)] border-2 shrink-0 flex items-center justify-center
                    transition-all duration-100
                    ${isChecked
                      ? 'bg-[var(--color-brand)] border-[var(--color-brand)]'
                      : isDisabled
                        ? 'border-[var(--color-gray-200)] bg-[var(--color-gray-50)]'
                        : 'border-[var(--color-gray-300)] bg-white'
                    }
                  `}
                  onClick={(e) => {
                    e.preventDefault();
                    if (!isDisabled) togglePhoto(photo.id);
                  }}
                >
                  {isChecked && (
                    <svg viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                      <path d="M2.5 6l2.5 2.5 4.5-5" />
                    </svg>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {/* 提示 */}
        {selected.size < M && (
          <p className="text-[var(--text-caption)] text-[var(--color-warning)]">
            {t('editor.templateSwitch.needMore', { count: M - selected.size })}
          </p>
        )}

        </div>
    </Modal>
  );
}
