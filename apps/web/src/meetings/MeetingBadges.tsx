import { useTranslation } from 'react-i18next';
import type { MeetingSummary } from '../api/meetingsApi';
import { Badge } from '../components/Badge';
import { meetingTiming } from './time';

type MeetingBadgesProps = Pick<
  MeetingSummary,
  'role' | 'callType' | 'status' | 'startsAt' | 'durationMinutes'
>;

/** Role, call type, and the state worth noticing (in progress, finished, cancelled). */
export function MeetingBadges(meeting: MeetingBadgesProps) {
  const { t } = useTranslation();
  const timing = meetingTiming(meeting, new Date());

  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={meeting.role === 'host' ? 'accent' : 'neutral'}>
        {t(`meetings.badges.${meeting.role}`)}
      </Badge>
      <Badge>{t(`meetings.badges.${meeting.callType}`)}</Badge>
      {timing === 'cancelled' ? (
        <Badge tone="danger">{t('meetings.badges.cancelled')}</Badge>
      ) : null}
      {timing === 'inProgress' ? (
        <Badge tone="accent">{t('meetings.badges.inProgress')}</Badge>
      ) : null}
      {timing === 'over' ? <Badge>{t('meetings.badges.over')}</Badge> : null}
      {timing === 'ended' ? <Badge>{t('meetings.badges.ended')}</Badge> : null}
    </span>
  );
}
