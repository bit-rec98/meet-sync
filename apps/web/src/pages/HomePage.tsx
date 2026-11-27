import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/useAuth';
import { usePageTitle } from '../components/usePageTitle';

/** The signed-in start page. Step 2 of the UI replaces the placeholder with the user's meetings. */
export function HomePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  usePageTitle(t('app.name'));

  return (
    <section className="mt-8">
      <h1 className="text-2xl font-semibold">
        {t('home.greeting', { name: user?.displayName ?? '' })}
      </h1>
      <p className="mt-2 text-ink-muted">{t('home.placeholder')}</p>
    </section>
  );
}
