'use client';

// Tema tercihi: 'light' (varsayılan, 12 §4.3), 'dark', 'system'. localStorage "theme" anahtarında.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { THEME_STORAGE_KEY } from './theme-script';

export { THEME_STORAGE_KEY };

export type ThemePreference = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();

function read(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'dark' || v === 'system' || v === 'light') return v;
  } catch {
    // localStorage yoksa varsayılan
  }
  const attr = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
  return attr === 'dark' || attr === 'system' ? attr : 'light';
}

function apply(pref: ThemePreference): void {
  const d = document.documentElement;
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  d.setAttribute('data-theme', pref);
  d.classList.toggle('dark', dark);
  d.classList.toggle('light', !dark);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // yok say
  }
  apply(pref);
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Tema tercihi ve değiştirici. Sistem tercihi değişirse 'system' modunda uygulanır. */
export function useTheme(): { theme: ThemePreference; setTheme: (t: ThemePreference) => void } {
  const theme = useSyncExternalStore(subscribe, read, () => 'light' as ThemePreference);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => setThemePreference(t), []);
  return { theme, setTheme };
}
