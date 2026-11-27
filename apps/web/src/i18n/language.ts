export const LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof LANGUAGES)[number];

const STORAGE_KEY = 'meetsync.language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language to start with: the one the user chose before, else the first supported language of
 * the browser's preference list, else English. Storage can be unavailable (private mode, blocked
 * cookies), so every access is guarded and the app works without it.
 */
export function detectLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Storage unavailable: fall back to the browser's languages.
  }
  const preferred = navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
  }
  return 'en';
}

/** Remembers an explicit choice of the user (a preference, not a secret). */
export function rememberLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage unavailable: the choice just lasts until the page is closed.
  }
}
