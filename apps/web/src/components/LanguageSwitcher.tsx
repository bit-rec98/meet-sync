import { useTranslation } from 'react-i18next';
import { isLanguage, rememberLanguage } from '../i18n/language';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = isLanguage(i18n.language) ? i18n.language : 'en';

  return (
    <div>
      <label htmlFor="language-select" className="sr-only">
        {t('common.language')}
      </label>
      <select
        id="language-select"
        value={current}
        onChange={(event) => {
          const choice = event.target.value;
          if (isLanguage(choice)) {
            void i18n.changeLanguage(choice);
            rememberLanguage(choice); // only an explicit choice is remembered
          }
        }}
        className="rounded-lg border border-control-edge bg-field px-2 py-1.5 text-sm text-ink"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="es" lang="es">
          Español
        </option>
      </select>
    </div>
  );
}
