import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { MeetingSummary } from '../api/meetingsApi';
import { MeetingBadges } from './MeetingBadges';
import { useMeetingText } from './useMeetingText';

export function MeetingCard({ meeting }: { meeting: MeetingSummary }) {
  const { t } = useTranslation();
  const text = useMeetingText();

  return (
    <li className="rounded-xl border border-edge bg-surface/90 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">
          <Link to={`/meetings/${encodeURIComponent(meeting.id)}`} className="hover:underline">
            {meeting.title}
          </Link>
        </h2>
        <MeetingBadges {...meeting} />
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        <time dateTime={meeting.startsAt}>{text.dateTime(meeting.startsAt, 'short')}</time>
        {' · '}
        {text.duration(meeting.durationMinutes)}
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        {meeting.role === 'host'
          ? t('meetings.invitees', { count: meeting.inviteeCount })
          : t('meetings.hostedBy', { name: meeting.host.displayName })}
      </p>
    </li>
  );
}
