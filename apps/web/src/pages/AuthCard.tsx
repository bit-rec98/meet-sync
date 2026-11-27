import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type AuthCardProps = { title: string; children: ReactNode };

/** The frame shared by the login and registration pages: product tagline above a card. */
export function AuthCard({ title, children }: AuthCardProps) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="auth-title" className="mx-auto mt-6 w-full max-w-md sm:mt-12">
      <p className="bg-linear-to-r from-link to-violet-300 bg-clip-text text-3xl font-bold tracking-tight text-transparent">
        {t('app.tagline')}
      </p>
      <p className="mt-2 text-ink-muted">{t('app.description')}</p>
      <div className="mt-6 rounded-2xl border border-edge bg-surface/90 p-6 shadow-xl">
        <h1 id="auth-title" className="text-xl font-semibold">
          {title}
        </h1>
        {children}
      </div>
    </section>
  );
}
