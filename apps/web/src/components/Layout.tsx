import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { Brand } from './Brand';
import { Button } from './Button';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Layout() {
  const { t } = useTranslation();
  const { status, user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-10 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-white"
      >
        {t('common.skipToContent')}
      </a>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          {status === 'authenticated' && user ? (
            <>
              <span className="hidden text-sm text-ink-muted sm:inline">
                {t('nav.signedInAs', { name: user.displayName })}
              </span>
              <Button variant="secondary" onClick={() => void logout()}>
                {t('nav.logout')}
              </Button>
            </>
          ) : null}
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
