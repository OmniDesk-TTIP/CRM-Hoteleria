import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ThemeContext, type Theme } from '@/context/theme.context';

const STORAGE_KEY = 'omnidesk-theme';

const DEFAULT_THEME: Theme = 'dark';

const BROWSER_BAR_COLOR: Record<Theme, string> = {
  dark: '#0F1D28',
  light: '#F5F0E6',
};

const readStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage puede estar bloqueado (modo privado, políticas del navegador), se usa el default
  }
  return DEFAULT_THEME;
};

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BROWSER_BAR_COLOR[theme]);

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      //sin storage el cambio igual funciona
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
