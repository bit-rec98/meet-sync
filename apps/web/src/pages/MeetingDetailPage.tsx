import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { ButtonLink } from '../components/ButtonLink';
import { ConfirmPanel } from '../components/ConfirmPanel';
import { usePageTitle } from '../components/usePageTitle';
import { useAuth } from '../auth/useAuth';
import type { ErrorTextKey } from '../forms/failure';
import { InviteesSection } from '../meetings/InviteesSection';
import { describeActionFailure, describeLoadFailure } from '../meetings/meetingErrors';
import { MeetingBadges } from '../meetings/MeetingBadges';
import { canEdit, isActive } from '../meetings/time';
import { useFlashNotice, withNotice } from '../meetings/useFlashNotice';
import { useMeetingsApi } from '../meetings/useMeetingsApi';
import { useMeetingText } from '../meetings/useMeetingText';
import { useResource } from '../meetings/useResource';

type Confirmation = 'cancel' | 'leave';

/** A message about something that just happened on this page. Stored as data so it can be translated when shown. */
type Notice =
  { kind: 'cancelled' } | { kind: 'invited'; name: string } | { kind: 'removed'; name: string };

export function MeetingDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const api = useMeetingsApi();
  const text = useMeetingText();
  const navigate = useNavigate();
  const flash = useFlashNotice();
  const { state, reload } = useResource(`meeting:${id}`, () => api.get(id));

  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [actionError, setActionError] = useState<ErrorTextKey | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const meetingTitle = state.status === 'success' ? state.data.title : t('meetings.title');
  usePageTitle(meetingTitle);

  // Declining a confirmation puts focus back on the button that asked for it.
  useEffect(() => {
    if (confirming === null) triggerRef.current?.focus();
  }, [confirming]);

  function ask(kind: Confirmation, trigger: HTMLButtonElement): void {
    triggerRef.current = trigger;
    setActionError(null);
    setConfirming(kind);
  }

  async function confirm(kind: Confirmation): Promise<void> {
    setConfirmPending(true);
    setActionError(null);
    try {
      if (kind === 'cancel') {
        await api.cancel(id);
        triggerRef.current = null; // the Cancel button disappears: nothing to return focus to
        setConfirming(null);
        setNotice({ kind: 'cancelled' });
        reload();
      } else {
        await api.removeInvitee(id, user?.id ?? '');
        navigate('/', { state: withNotice('left') });
      }
    } catch (error) {
      setActionError(describeActionFailure(error));
    } finally {
      setConfirmPending(false);
    }
  }

  if (state.status === 'loading') {
    return (
      <div role="status" className="mt-8 text-ink-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-6">
        <Alert variant="error">{t(`errors.${describeLoadFailure(state.error)}`)}</Alert>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Button variant="secondary" onClick={reload}>
            {t('common.retry')}
          </Button>
          <Link to="/" className="font-medium text-link underline">
            {t('meeting.back')}
          </Link>
        </div>
      </div>
    );
  }

  const meeting = state.data;
  const now = new Date();
  const isHost = meeting.role === 'host';
  const active = isActive(meeting, now);
  const detailPath = `/meetings/${encodeURIComponent(meeting.id)}`;

  const noticeText = notice
    ? notice.kind === 'cancelled'
      ? t('meeting.notices.cancelled')
      : t(`meeting.notices.${notice.kind}`, { name: notice.name })
    : flash === 'created' || flash === 'updated'
      ? t(`meeting.notices.${flash}`)
      : null;

  return (
    <article
      aria-labelledby="meeting-title"
      className="mt-6"
      aria-busy={state.refreshing || undefined}
    >
      <Link to="/" className="text-sm font-medium text-link underline">
        {t('meeting.back')}
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <h1 id="meeting-title" className="text-2xl font-semibold">
          {meeting.title}
        </h1>
        <MeetingBadges {...meeting} />
      </div>

      {noticeText ? <Alert variant="info">{noticeText}</Alert> : null}
      {actionError && confirming === null ? (
        <Alert variant="error">{t(`errors.${actionError}`)}</Alert>
      ) : null}

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-sm text-ink-muted">{t('meeting.when')}</dt>
          <dd className="font-medium">
            <time dateTime={meeting.startsAt}>{text.dateTime(meeting.startsAt, 'long')}</time>
          </dd>
          <dd className="text-sm text-ink-muted">
            {t('meetings.timeZoneNote', { zone: text.timeZone })}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">{t('meeting.duration')}</dt>
          <dd className="font-medium">{text.duration(meeting.durationMinutes)}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">{t('meeting.callType')}</dt>
          <dd className="font-medium">
            {meeting.callType === 'video' ? t('meetingForm.video') : t('meetingForm.audio')}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-muted">{t('meeting.host')}</dt>
          <dd className="font-medium">{meeting.host.displayName}</dd>
        </div>
        {meeting.description ? (
          <div className="sm:col-span-2">
            <dt className="text-sm text-ink-muted">{t('meeting.description')}</dt>
            <dd className="whitespace-pre-line">{meeting.description}</dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-6 flex flex-wrap gap-3">
        {isHost && canEdit(meeting, now) ? (
          <ButtonLink to={`${detailPath}/edit`} variant="secondary">
            {t('meeting.edit')}
          </ButtonLink>
        ) : null}
        {isHost && active ? (
          <Button variant="secondary" onClick={(event) => ask('cancel', event.currentTarget)}>
            {t('meeting.cancelMeeting')}
          </Button>
        ) : null}
        {!isHost ? (
          <Button variant="secondary" onClick={(event) => ask('leave', event.currentTarget)}>
            {t('meeting.leave')}
          </Button>
        ) : null}
      </div>

      {confirming ? (
        <ConfirmPanel
          title={t(`meeting.${confirming === 'cancel' ? 'confirmCancel' : 'confirmLeave'}.title`)}
          body={t(`meeting.${confirming === 'cancel' ? 'confirmCancel' : 'confirmLeave'}.body`)}
          confirmLabel={t(
            `meeting.${confirming === 'cancel' ? 'confirmCancel' : 'confirmLeave'}.yes`,
          )}
          cancelLabel={t(
            `meeting.${confirming === 'cancel' ? 'confirmCancel' : 'confirmLeave'}.no`,
          )}
          pending={confirmPending}
          onConfirm={() => void confirm(confirming)}
          onCancel={() => setConfirming(null)}
        >
          {actionError ? <Alert variant="error">{t(`errors.${actionError}`)}</Alert> : null}
        </ConfirmPanel>
      ) : null}

      <InviteesSection
        meeting={meeting}
        canInvite={isHost && active}
        onInvited={(invitee) => {
          setNotice({ kind: 'invited', name: invitee.displayName });
          setActionError(null);
          reload();
        }}
        onRemoved={(invitee) => {
          setNotice({ kind: 'removed', name: invitee.displayName });
          setActionError(null);
          reload();
        }}
        onActionFailed={setActionError}
      />

      {active ? <p className="mt-8 text-sm text-ink-muted">{t('meeting.callsSoon')}</p> : null}
    </article>
  );
}
