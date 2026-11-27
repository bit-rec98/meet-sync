import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** Sets the browser tab title, which screen readers announce when the page changes. */
export function usePageTitle(title: string): void {
  const { t } = useTranslation();
  const name = t('app.name');
  useEffect(() => {
    document.title = title === name ? name : `${title} · ${name}`;
  }, [title, name]);
}
