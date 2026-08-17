import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TEXTURE_BACKGROUNDS } from '../../../types';
import type { AlbumPage, BackgroundApply, BackgroundApplyScope } from '../../../types';
import type { GradientPreset } from '../../../constants/colorPalette';
import { ColorPalette } from './ColorPalette';
import { isTauri, readFileToDataUrl, blobToDataUrl } from '../../../utils/tauri';
import { logger } from '../../../utils/logger';

/**
 * 背景选择器组件
 * 三个 Tab：颜色（纯色/渐变复用 ColorPalette 与形状/文字统一）、纹理、图片（支持上传）。
 * 顶部提供「应用范围」选择器，区分当前页 / 普通页面 / 封面 / 封底 / 全部页面，
 * 避免封面/封底与普通页面混为一谈全部改动。
 * 底色经 onApplyBg/onApplyByScope 写入 page.background（hex / linear-gradient css / texture-xxx），
 * 背景图片写入 page.backgroundImage（dataURL，随相册持久化）。
 */

type BgTab = 'color' | 'texture' | 'image';

interface BackgroundPickerProps {
  currentPage?: AlbumPage;
  onApplyBg: (apply: BackgroundApply) => void;
  onApplyByScope: (scope: BackgroundApplyScope, apply: BackgroundApply) => void;
}

// 纹理预览生成（CSS 背景图案）
const TEXTURE_STYLES: Record<string, React.CSSProperties> = {
  'texture-ricepaper': { backgroundColor: '#F5F0E8', backgroundImage: 'radial-gradient(circle, #E8E0D0 1px, transparent 1px)', backgroundSize: '8px 8px' },
  'texture-kraft': { backgroundColor: '#C4A882' },
  'texture-dots': { backgroundColor: '#F9FAFB', backgroundImage: 'radial-gradient(circle, #D1D5DB 1px, transparent 1px)', backgroundSize: '12px 12px' },
  'texture-grid': { backgroundColor: '#F9FAFB', backgroundImage: 'linear-gradient(#E5E7EB 1px, transparent 1px), linear-gradient(90deg, #E5E7EB 1px, transparent 1px)', backgroundSize: '16px 16px' },
  'texture-stripes': { backgroundColor: '#FAFAFA', backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 4px, #E5E7EB 4px, #E5E7EB 5px)' },
  'texture-linen': { backgroundColor: '#F0EDE8', backgroundImage: 'linear-gradient(0deg, transparent 50%, rgba(0,0,0,0.02) 50%), linear-gradient(90deg, transparent 50%, rgba(0,0,0,0.02) 50%)', backgroundSize: '4px 4px' },
};

export function BackgroundPicker({ currentPage, onApplyBg, onApplyByScope }: BackgroundPickerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<BgTab>('color');
  const [scope, setScope] = useState<BackgroundApplyScope>('current');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bg = currentPage?.background || '#FFFFFF';
  const bgImage = currentPage?.backgroundImage;
  const bgImageFit = currentPage?.backgroundImageFit ?? 'cover';

  const handleApply = (apply: BackgroundApply) => {
    if (scope === 'current') onApplyBg(apply);
    else onApplyByScope(scope, apply);
  };

  // 颜色功能：复用 ColorPalette（纯色/渐变与形状、文字的选色完全统一）
  const handleColor = (color: string) => handleApply({ background: color });
  const handleGradient = (preset: GradientPreset) => handleApply({ background: preset.css });

  // 纹理：底色写入 texture-xxx，渲染层按纹理图案填充
  const handleTexture = (value: string) => handleApply({ background: value });

  // 上传背景图片：Tauri 用文件对话框 + fs 读取转 dataURL；浏览器用 file input
  const handleUpload = async (file?: File) => {
    try {
      setUploading(true);
      let dataUrl: string | null = null;
      if (file) {
        dataUrl = await blobToDataUrl(file);
      } else if (isTauri()) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          multiple: false,
          title: t('editor.tools.background.pickImage'),
          filters: [{ name: t('editor.tools.background.imageFilter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
        });
        if (typeof selected === 'string') {
          dataUrl = await readFileToDataUrl(selected);
        }
      }
      if (dataUrl) {
        handleApply({ backgroundImage: dataUrl, backgroundImageFit: 'cover' });
      }
    } catch (err) {
      logger.warn('[BackgroundPicker] 上传背景图片失败', err);
    } finally {
      setUploading(false);
    }
  };

  // 点击上传：Tauri 用文件对话框；浏览器端触发隐藏 file input
  const handleClickUpload = () => {
    if (isTauri()) handleUpload();
    else fileInputRef.current?.click();
  };

  const handleRemoveImage = () => handleApply({ backgroundImage: undefined, backgroundImageFit: 'cover' });

  return (
    <div className="space-y-3">
      {/* Tab 切换 */}
      <div className="flex bg-[var(--color-surface-hover)] rounded-[var(--radius-md)] p-0.5">
        {([
          { key: 'color', label: t('editor.tools.background.tabColor') },
          { key: 'texture', label: t('editor.tools.background.tabTexture') },
          { key: 'image', label: t('editor.tools.background.tabImage') },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-1 px-2 rounded-[var(--radius-sm)] text-[11px] font-[500] cursor-pointer transition-colors border-none
              ${tab === key
                ? 'bg-white text-[var(--color-gray-800)] shadow-[var(--shadow-sm)]'
                : 'bg-transparent text-[var(--color-gray-400)] hover:text-[var(--color-gray-600)]'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 应用范围（置于颜色选择之前，区分当前页/普通页/封面/封底/全部） */}
      <div>
        <div className="text-[10px] font-[500] text-[var(--color-gray-400)] mb-1">{t('editor.tools.background.applyScope')}</div>
        <div className="grid grid-cols-5 gap-1">
          {([
            { key: 'current', label: t('editor.tools.background.scopeCurrent') },
            { key: 'normal', label: t('editor.tools.background.scopeNormal') },
            { key: 'cover', label: t('editor.tools.background.scopeCover') },
            { key: 'back', label: t('editor.tools.background.scopeBack') },
            { key: 'all', label: t('editor.tools.background.scopeAll') },
          ] as const).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              className={`py-1 rounded-[var(--radius-sm)] border text-[10px] font-[500] cursor-pointer transition-colors
                ${scope === key
                  ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                  : 'border-[var(--color-border)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)] hover:text-[var(--color-gray-700)]'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 颜色：复用 ColorPalette（纯色 + 渐变，与形状/文字统一） */}
      {tab === 'color' && (
        <ColorPalette
          selectedColor={bg.startsWith('texture-') ? '#FFFFFF' : bg}
          onColorChange={handleColor}
          onGradientChange={handleGradient}
        />
      )}

      {/* 纹理 */}
      {tab === 'texture' && (
        <div className="grid grid-cols-4 gap-2">
          {TEXTURE_BACKGROUNDS.map((item) => (
            <button
              key={item.value}
              onClick={() => handleTexture(item.value)}
              className={`aspect-square rounded-[var(--radius-md)] border-2 cursor-pointer hover:scale-105 transition-all
                ${bg === item.value
                  ? 'border-[var(--color-brand)] scale-105 shadow-[var(--shadow-card-hover)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-gray-300)]'
                }`}
              style={TEXTURE_STYLES[item.value] || { backgroundColor: '#fff' }}
              title={item.name}
            />
          ))}
        </div>
      )}

      {/* 图片：上传 + 预览 + 填充方式 + 移除 */}
      {tab === 'image' && (
        <div className="space-y-2">
          {bgImage ? (
            <>
              <div
                className="w-full aspect-video rounded-[var(--radius-md)] border border-[var(--color-border)] overflow-hidden relative"
                style={{ background: '#F8F9FA' }}
              >
                <img
                  src={bgImage}
                  alt={t('editor.tools.background.preview')}
                  className={`w-full h-full ${bgImageFit === 'cover' ? 'object-cover' : 'object-contain'}`}
                  draggable={false}
                />
              </div>
              {/* 填充方式切换 */}
              <div className="flex gap-1.5">
                {(['cover', 'contain'] as const).map((fit) => (
                  <button
                    key={fit}
                    onClick={() => handleApply({ backgroundImageFit: fit })}
                    className={`flex-1 py-1.5 rounded-[var(--radius-md)] border text-[11px] font-[500] cursor-pointer transition-colors
                      ${bgImageFit === fit
                        ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-surface-selected)]'
                        : 'border-[var(--color-border)] text-[var(--color-gray-500)] hover:border-[var(--color-gray-300)]'
                      }`}
                  >
                    {fit === 'cover' ? t('editor.tools.background.fitCover') : t('editor.tools.background.fitContain')}
                  </button>
                ))}
              </div>
              <button
                onClick={handleRemoveImage}
                className="w-full py-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] text-[11px] font-[500] text-[var(--color-gray-500)] cursor-pointer transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                {t('editor.tools.background.removeImage')}
              </button>
            </>
          ) : (
            <button
              onClick={handleClickUpload}
              disabled={uploading}
              className="w-full py-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-primary-400)] bg-[var(--color-surface-selected)] text-[var(--color-primary-700)] hover:bg-[var(--color-primary-50)] cursor-pointer transition-colors flex flex-col items-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <path d="M12 16V4m0 0l-4 4m4-4l4 4" />
                <path d="M20 16v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3" />
              </svg>
              <span className="text-[11px] font-[500]">
                {uploading ? t('editor.tools.background.uploading') : t('editor.tools.background.uploadImage')}
              </span>
            </button>
          )}
          {/* 隐藏 FileInput：浏览器端回退上传 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
}