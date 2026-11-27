import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function Brand() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="inline-flex items-center gap-2 text-lg font-semibold">
      {/* Decorative: the name next to it already says what this is. */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7" fill="none">
        <rect width="24" height="24" rx="6" fill="var(--color-accent)" />
        <rect x="5" y="8" width="9" height="8" rx="2" fill="white" />
        <path d="m14 11 5-2.5v7L14 13z" fill="white" />
      </svg>
      {t('app.name')}
    </Link>
  );
}
