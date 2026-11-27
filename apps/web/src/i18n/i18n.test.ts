import { afterEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from './index';
import { detectLanguage, rememberLanguage } from './language';
import { en } from './locales/en';
import { es } from './locales/es';

/** Every text with its key path, e.g. "login.title". */
function flatten(tree: object, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]): [string, string][] =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flatten(value, `${prefix}${key}.`),
  );
}

const placeholdersOf = (text: string): string[] =>
  [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1] ?? '').sort();

describe('translations', () => {
  const english = new Map(flatten(en));
  const spanish = new Map(flatten(es));

  it('have the same keys in English and Spanish', () => {
    expect([...spanish.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('have no empty texts', () => {
    for (const [key, text] of [...english, ...spanish]) {
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('use the same {{placeholders}} in both languages', () => {
    for (const [key, text] of english) {
      expect(placeholdersOf(spanish.get(key) ?? ''), key).toEqual(placeholdersOf(text));
    }
  });
});

describe('createI18n', () => {
  it('translates in the requested language and interpolates values', () => {
    expect(createI18n('en').t('nav.signedInAs', { name: 'Ana' })).toBe('Signed in as Ana');
    expect(createI18n('es').t('nav.signedInAs', { name: 'Ana' })).toBe('Sesión iniciada como Ana');
  });

  it('chooses singular and plural forms by count in both languages', () => {
    expect(createI18n('en').t('meetings.invitees', { count: 1 })).toBe('1 invitee');
    expect(createI18n('en').t('meetings.invitees', { count: 0 })).toBe('0 invitees');
    expect(createI18n('en').t('meetings.invitees', { count: 5 })).toBe('5 invitees');
    expect(createI18n('es').t('meetings.invitees', { count: 1 })).toBe('1 invitado');
    expect(createI18n('es').t('meetings.invitees', { count: 5 })).toBe('5 invitados');
  });

  it('keeps the html lang attribute in step with the language', async () => {
    const i18n = createI18n('es');
    expect(document.documentElement.lang).toBe('es');
    await i18n.changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('does not treat markup in interpolated values specially', () => {
    // React escapes when rendering; the i18n layer must not double-escape names such as "A & B".
    expect(createI18n('en').t('nav.signedInAs', { name: 'A & B' })).toBe('Signed in as A & B');
  });
});

describe('detectLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  const browserLanguages = (languages: string[]): void => {
    vi.stubGlobal('navigator', { languages, language: languages[0] ?? 'en' });
  };

  it('uses the first supported browser language, ignoring region', () => {
    browserLanguages(['fr-FR', 'es-AR', 'en-US']);
    expect(detectLanguage()).toBe('es');
    browserLanguages(['en-GB']);
    expect(detectLanguage()).toBe('en');
  });

  it('falls back to English when nothing supported is preferred', () => {
    browserLanguages(['fr-FR', 'de']);
    expect(detectLanguage()).toBe('en');
    browserLanguages([]);
    expect(detectLanguage()).toBe('en');
  });

  it('prefers the language the user chose before over the browser setting', () => {
    browserLanguages(['es-AR']);
    rememberLanguage('en');
    expect(detectLanguage()).toBe('en');
  });

  it('ignores a stored value that is not a supported language', () => {
    browserLanguages(['es']);
    window.localStorage.setItem('meetsync.language', '<script>');
    expect(detectLanguage()).toBe('es');
  });

  it('keeps working when storage is unavailable', () => {
    browserLanguages(['es']);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(detectLanguage()).toBe('es');
    expect(() => rememberLanguage('en')).not.toThrow();
    vi.restoreAllMocks();
  });
});
