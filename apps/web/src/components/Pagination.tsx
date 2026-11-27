import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

type PaginationProps = {
  offset: number;
  limit: number;
  total: number;
  /** The address of a page (1 is the first), so pages can be linked, bookmarked and go back. */
  hrefForPage: (page: number) => string;
};

const LINK =
  'rounded-lg border border-control-edge px-3 py-1.5 text-sm font-medium hover:bg-surface';
const DISABLED = 'rounded-lg border border-edge px-3 py-1.5 text-sm text-ink-muted';

export function Pagination({ offset, limit, total, hrefForPage }: PaginationProps) {
  const { t } = useTranslation();
  if (total <= limit && offset === 0) return null;

  const page = Math.floor(offset / limit) + 1;
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <nav
      aria-label={t('meetings.pagination.label')}
      className="mt-6 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-ink-muted">
        {t('meetings.pagination.range', { from, to, total })}
      </p>
      <div className="flex gap-2">
        {hasPrevious ? (
          <Link to={hrefForPage(page - 1)} rel="prev" className={LINK}>
            {t('meetings.pagination.previous')}
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED}>
            {t('meetings.pagination.previous')}
          </span>
        )}
        {hasNext ? (
          <Link to={hrefForPage(page + 1)} rel="next" className={LINK}>
            {t('meetings.pagination.next')}
          </Link>
        ) : (
          <span aria-disabled="true" className={DISABLED}>
            {t('meetings.pagination.next')}
          </span>
        )}
      </div>
    </nav>
  );
}
