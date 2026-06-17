/**
 * MemBook — 存储方式选择对话框 (PRD 1.4)
 *
 * 首次导入照片时弹出，让用户选择：
 * - 📂 直接访问模式 (File System Access API) — 从原文件夹直接读取
 * - 📥 导入存储模式 (IndexedDB) — 压缩后存入浏览器
 */
import { useState, useEffect } from 'react';
import { supportsDirectAccess } from '../../engine/storage-engine';

interface StoragePickerDialogProps {
  onSelect: (mode: 'direct' | 'import') => void;
  onCancel: () => void;
}

export function StoragePickerDialog({ onSelect, onCancel }: StoragePickerDialogProps) {
  const [canDirect, setCanDirect] = useState(false);

  useEffect(() => {
    setCanDirect(supportsDirectAccess());
  }, []);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] bg-[var(--color-surface-overlay)] flex items-center justify-center p-4"
    >
      <div
        className="bg-white rounded-[var(--radius-xl)] shadow-[var(--shadow-xl)] w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 text-center">
          <h2 className="text-[var(--text-h2)] font-[700] text-[var(--color-gray-900)] mb-1">
            选择照片存储方式
          </h2>
          <p className="text-[var(--text-body-sm)] text-[var(--color-gray-500)]">
            首次导入前请选择照片的存储方式，后续可随时在设置中更改
          </p>
        </div>

        {/* Options */}
        <div className="px-5 pb-4 space-y-3">
          {/* Direct Access */}
          <button
            className={`
              w-full text-left p-4 rounded-[var(--radius-lg)] border-2 transition-all duration-150
              ${canDirect
                ? 'border-[var(--color-border)] hover:border-[var(--color-primary-400)] hover:bg-[var(--color-primary-50)] active:bg-[var(--color-primary-50)] cursor-pointer'
                : 'border-[var(--color-border-light)] bg-[var(--color-gray-25)] cursor-not-allowed opacity-60'
              }
            `}
            onClick={() => canDirect && onSelect('direct')}
            disabled={!canDirect}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-primary-50)] flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 20 20" fill="none" stroke="#6C63FF" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
                  <path d="M3 7V5a2 2 0 0 1 2-2h3.5l1.5 2H15a2 2 0 0 1 2 2v2" />
                  <path d="M3 7h14v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-body)] font-[600] text-[var(--color-gray-900)]">
                    直接访问模式
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-[600] text-[var(--color-primary-700)] bg-[var(--color-primary-50)] rounded-[var(--radius-xs)]">
                    推荐
                  </span>
                </div>
                <p className="text-[var(--text-caption)] text-[var(--color-gray-500)] mt-0.5">
                  直接从你的文件夹读取照片，不复制到浏览器中
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <span className="text-[11px] text-[var(--color-success)]">✓ 导入快，几乎不占浏览器空间</span>
                  <span className="text-[11px] text-[var(--color-success)]">✓ 适合大量照片（几千张以上）</span>
                  <span className="text-[11px] text-[var(--color-warning)]">✗ 删除原文件会影响项目</span>
                  <span className="text-[11px] text-[var(--color-warning)]">✗ 需要 Chrome/Edge 浏览器</span>
                </div>
              </div>
            </div>
          </button>

          {/* Import Store */}
          <button
            className="w-full text-left p-4 rounded-[var(--radius-lg)] border-2 border-[var(--color-border)] hover:border-[var(--color-primary-400)] hover:bg-[var(--color-primary-50)] active:bg-[var(--color-primary-50)] transition-all duration-150 cursor-pointer"
            onClick={() => onSelect('import')}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-info-light)] flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 20 20" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" className="w-5 h-5">
                  <path d="M10 2v12M6 10l4 4 4-4" />
                  <path d="M2 15v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[var(--text-body)] font-[600] text-[var(--color-gray-900)]">
                  导入存储模式
                </span>
                <p className="text-[var(--text-caption)] text-[var(--color-gray-500)] mt-0.5">
                  照片压缩后存入浏览器本地存储
                </p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <span className="text-[11px] text-[var(--color-success)]">✓ 原文件删除不影响项目</span>
                  <span className="text-[11px] text-[var(--color-success)]">✓ 所有浏览器通用</span>
                  <span className="text-[11px] text-[var(--color-warning)]">✗ 导入较慢，占用存储空间</span>
                  <span className="text-[11px] text-[var(--color-warning)]">✗ 每 1000 张约占用 300MB</span>
                </div>
              </div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-[var(--color-gray-25)] border-t border-[var(--color-border-light)] flex items-center justify-between">
          {!canDirect && (
            <span className="text-[var(--text-caption)] text-[var(--color-gray-400)]">
              当前浏览器不支持直接访问模式
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              className="px-4 py-2 text-[var(--text-body-sm)] font-[500] text-[var(--color-gray-600)] border border-[var(--color-border)] rounded-[var(--radius-md)] bg-white hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
              onClick={onCancel}
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
