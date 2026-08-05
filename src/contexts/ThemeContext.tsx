import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'membook-theme';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark'; // 实际生效的主题
  setMode: (mode: ThemeMode) => void;
  toggle: () => void; // 切换 light ↔ dark
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

function loadMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') return 'dark';
    // 'system' 已废弃，回退到 light
    if (stored === 'light' || stored === 'system') return 'light';
  } catch { /* ignore */ }
  return 'light';
}

function saveMode(mode: ThemeMode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(loadMode);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(loadMode()));

  // 应用 data-theme 到 html 元素
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setMode = useCallback((newMode: ThemeMode) => {
    saveMode(newMode);
    setModeState(newMode);
    setResolved(resolveTheme(newMode));
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next: ThemeMode = prev === 'light' ? 'dark' : 'light';
      saveMode(next);
      setResolved(resolveTheme(next));
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
