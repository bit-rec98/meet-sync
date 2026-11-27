import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Language } from './language';
import { en, type Translations } from './locales/en';
import { es } from './locales/es';

// Makes t('login.title') type-checked: a misspelled key is a compile error.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Translations };
  }
}

/** A fresh i18n instance. The app creates one; tests create their own to stay independent. */
export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();
  const applyDocumentLanguage = (code: string): void => {
    document.documentElement.lang = code;
  };

  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    resources: { en: { translation: en }, es: { translation: es } },
    initAsync: false, // resources are bundled, so there is nothing to wait for
    interpolation: { escapeValue: false }, // React already escapes rendered text
  });

  applyDocumentLanguage(instance.language);
  instance.on('languageChanged', applyDocumentLanguage);
  return instance;
}
