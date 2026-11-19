import { useSyncExternalStore } from 'react';
import { DEFAULT_BAG_PREFS, type BagPrefs } from '@shared/bags';

export type ThemePref = 'system' | 'light' | 'dark';

export interface Prefs {
  bags: BagPrefs;
  currency: string;
  theme: ThemePref;
  /** Last searched airports, to prefill the form. */
  lastOrigin: string | null;
  lastDestination: string | null;
  /** How the search form asks for dates: every date in a window, or exact ones. */
  dateMode: 'any' | 'exact';
  /** Last used trip length (nights) and look-ahead (days) for flexible searches. */
  tripDays: number;
  windowDays: number;
}

const KEY = 'ftm:prefs';
const DEFAULTS: Prefs = {
  bags: DEFAULT_BAG_PREFS,
  currency: 'USD',
  theme: 'system',
  lastOrigin: null,
  lastDestination: null,
  dateMode: 'any',
  tripDays: 7,
  windowDays: 180,
};

function read(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return { ...DEFAULTS, ...stored, bags: { ...DEFAULTS.bags, ...stored.bags } };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function applyTheme(theme: ThemePref) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  if (root.dataset.theme === next) return;
  // Every colour changes at once; switch transitions off for a frame so nothing fades or lags behind.
  root.classList.add('theme-switching');
  root.dataset.theme = next;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('theme-switching');
    });
  });
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(current.theme));
window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return;
  current = read();
  applyTheme(current.theme);
  listeners.forEach((notify) => notify());
});

export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode or storage full: the preference still applies for this session.
  }
  if (patch.theme) applyTheme(current.theme);
  listeners.forEach((notify) => notify());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => current,
  );
}

/** The theme actually on screen, for code that must pick concrete colours. */
export function useResolvedTheme(): 'light' | 'dark' {
  const { theme } = usePrefs();
  const systemDark = useSyncExternalStore(
    (notify) => {
      const media = matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', notify);
      return () => media.removeEventListener('change', notify);
    },
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
