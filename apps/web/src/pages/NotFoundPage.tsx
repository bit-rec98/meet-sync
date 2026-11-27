import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePageTitle } from '../components/usePageTitle';

export function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t('notFound.title'));

  return (
    <section className="mt-12">
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="mt-2 text-ink-muted">{t('notFound.description')}</p>
      <Link to="/" className="mt-4 inline-block font-medium text-link underline">
        {t('notFound.backHome')}
      </Link>
    </section>
  );
}
