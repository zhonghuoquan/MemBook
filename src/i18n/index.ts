/**
 * MemBook — i18n 国际化初始化
 *
 * 基于 i18next + react-i18next。
 * - 默认语言：zh-CN（简体中文）
 * - 备选语言：en-US（英文）
 * - 语言检测顺序：localStorage > navigator.language > 默认
 * - 持久化：用户选择的语言存入 localStorage，下次启动自动恢复
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';

/** localStorage 键名 */
export const LANGUAGE_STORAGE_KEY = 'membook-language';

/** 支持的语言列表 */
export const SUPPORTED_LANGUAGES = [
  { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
] as const;

/** 默认语言 */
export const DEFAULT_LANGUAGE = 'zh-CN';

/** 从 localStorage 读取用户选择的语言 */
function detectLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  } catch { /* ignore */ }
  // 根据浏览器语言自动选择
  const navLang = navigator.language;
  if (navLang.startsWith('zh')) return 'zh-CN';
  if (navLang.startsWith('en')) return 'en-US';
  return DEFAULT_LANGUAGE;
}

/** 切换语言并持久化 */
export function changeLanguage(code: string): void {
  i18n.changeLanguage(code);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch { /* ignore */ }
}

/** 获取当前语言 */
export function getCurrentLanguage(): string {
  return i18n.language || DEFAULT_LANGUAGE;
}

/** 是否为中文环境 */
export function isChinese(): boolean {
  return getCurrentLanguage().startsWith('zh');
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': { translation: zhCN },
      'en-US': { translation: enUS },
    },
    lng: detectLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
      // React 已默认转义，避免双重转义
      escapeValue: false,
    },
    // 开发环境打印缺失 key 警告
    saveMissing: import.meta.env.DEV,
    missingKeyHandler: (_lngs, _ns, key) => {
      console.warn(`[i18n] Missing key: ${key}`);
    },
  });

export default i18n;
