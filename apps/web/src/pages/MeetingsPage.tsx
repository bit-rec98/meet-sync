import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import type { MeetingView } from '../api/meetingsApi';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { ButtonLink } from '../components/ButtonLink';
import { Pagination } from '../components/Pagination';
import { usePageTitle } from '../components/usePageTitle';
import { describeLoadFailure } from '../meetings/meetingErrors';
import { MeetingCard } from '../meetings/MeetingCard';
import { useFlashNotice } from '../meetings/useFlashNotice';
import { useMeetingsApi } from '../meetings/useMeetingsApi';
import { useMeetingText } from '../meetings/useMeetingText';
import { useResource } from '../meetings/useResource';

const PAGE_SIZE = 20;
const MAX_PAGE = 100_000;

const VIEWS: readonly MeetingView[] = ['upcoming', 'past'];

/** The view and page come from the address, so they survive reloads and the back button. */
function readParams(params: URLSearchParams): { view: MeetingView; page: number } {
  const view = VIEWS.find((candidate) => candidate === params.get('view')) ?? 'upcoming';
  const parsed = Number(params.get('page'));
  const page = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PAGE ? parsed : 1;
  return { view, page };
}

function address(view: MeetingView, page: number): string {
  const params = new URLSearchParams();
  if (view !== 'upcoming') params.set('view', view);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

export function MeetingsPage() {
  const { t } = useTranslation();
  const api = useMeetingsApi();
  const text = useMeetingText();
  const notice = useFlashNotice();
  const [searchParams] = useSearchParams();
  const { view, page } = readParams(searchParams);
  usePageTitle(t('meetings.title'));

  const offset = (page - 1) * PAGE_SIZE;
  const { state, reload } = useResource(`list:${view}:${page}`, () =>
    api.list({ when: view, limit: PAGE_SIZE, offset }),
  );

  return (
    <section aria-labelledby="meetings-title" className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="meetings-title" className="text-2xl font-semibold">
          {t('meetings.title')}
        </h1>
        <ButtonLink to="/meetings/new">{t('meetings.new')}</ButtonLink>
      </div>

      {notice === 'left' || notice === 'cancelled' ? (
        <Alert variant="info">{t(`meeting.notices.${notice}`)}</Alert>
      ) : null}

      <nav aria-label={t('meetings.viewsLabel')} className="mt-4">
        <ul className="flex gap-2">
          {VIEWS.map((candidate) => (
            <li key={candidate}>
              <Link
                to={address(candidate, 1)}
                aria-current={candidate === view ? 'page' : undefined}
                className={`inline-block rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  candidate === view
                    ? 'border-link bg-surface text-ink'
                    : 'border-control-edge text-ink-muted hover:bg-surface'
                }`}
              >
                {t(`meetings.views.${candidate}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-3 text-sm text-ink-muted">
        {t('meetings.timeZoneNote', { zone: text.timeZone })}
      </p>

      {state.status === 'loading' ? (
        <div role="status" className="mt-8 text-ink-muted">
          {t('common.loading')}
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div className="mt-6">
          <Alert variant="error">{t(`errors.${describeLoadFailure(state.error)}`)}</Alert>
          <Button variant="secondary" className="mt-3" onClick={reload}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {state.status === 'success' ? (
        <>
          {state.data.total === 0 ? (
            <div className="mt-8 rounded-xl border border-edge bg-surface/90 p-6 text-center">
              <p className="text-ink-muted">
                {view === 'upcoming' ? t('meetings.emptyUpcoming') : t('meetings.emptyPast')}
              </p>
              {view === 'upcoming' ? (
                <ButtonLink to="/meetings/new" className="mt-4">
                  {t('meetings.schedule')}
                </ButtonLink>
              ) : null}
            </div>
          ) : (
            <ul className="mt-6 grid gap-3">
              {state.data.items.map((meeting) => (
                <MeetingCard key={meeting.id} meeting={meeting} />
              ))}
            </ul>
          )}
          <Pagination
            offset={state.data.offset}
            limit={state.data.limit}
            total={state.data.total}
            hrefForPage={(target) => address(view, target)}
          />
        </>
      ) : null}
    </section>
  );
}
