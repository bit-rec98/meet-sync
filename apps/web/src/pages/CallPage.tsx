import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { CallControls } from '../calls/CallControls';
import type { EndReason } from '../calls/types';
import { useCall } from '../calls/useCall';
import { VideoTile } from '../calls/VideoTile';
import { Alert } from '../components/Alert';
import { Button } from '../components/Button';
import { usePageTitle } from '../components/usePageTitle';
import type { Meeting } from '../api/meetingsApi';
import { describeLoadFailure } from '../meetings/meetingErrors';
import { canJoin, isActive, joinOpensAt } from '../meetings/time';
import { useMeetingsApi } from '../meetings/useMeetingsApi';
import { useMeetingText } from '../meetings/useMeetingText';
import { useResource } from '../meetings/useResource';

/** Ending reasons after which joining again can work. The others are decisions about this person. */
const CAN_REJOIN: ReadonlySet<EndReason> = new Set([
  'left',
  'replaced',
  'server_shutdown',
  'connection_lost',
  'room_full',
]);

export function CallPage() {
  const { id = '' } = useParams();
  // One screen per meeting: moving to another meeting's call starts again from the lobby.
  return <CallScreen key={id} meetingId={id} />;
}

function CallScreen({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const api = useMeetingsApi();
  const { state: meetingState, reload } = useResource(`meeting:${meetingId}`, () =>
    api.get(meetingId),
  );
  const meetingTitle = meetingState.status === 'success' ? meetingState.data.title : t('app.name');
  usePageTitle(meetingTitle);

  if (meetingState.status === 'loading') {
    return (
      <div role="status" className="mt-8 text-ink-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (meetingState.status === 'error') {
    return (
      <div className="mt-6">
        <Alert variant="error">{t(`errors.${describeLoadFailure(meetingState.error)}`)}</Alert>
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

  return <CallRoom meeting={meetingState.data} />;
}

function CallRoom({ meeting }: { meeting: Meeting }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const text = useMeetingText();
  const call = useCall(meeting.id);
  const { state } = call;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // When the call ends, the reason is the most important thing on the screen: announce it.
  useEffect(() => {
    if (state.phase === 'ended') headingRef.current?.focus();
  }, [state.phase]);

  const detailPath = `/meetings/${encodeURIComponent(meeting.id)}`;
  const selfName = user?.displayName ?? '';
  const backLink = (
    <Link to={detailPath} className="text-sm font-medium text-link underline">
      {t('call.back')}
    </Link>
  );

  if (state.phase === 'ended' && state.endReason) {
    return (
      <section aria-labelledby="call-ended" className="mt-6">
        {backLink}
        <h1
          id="call-ended"
          ref={headingRef}
          tabIndex={-1}
          className="mt-3 text-2xl font-semibold outline-none"
        >
          {t('call.ended.heading')}
        </h1>
        <p className="mt-2" role="status">
          {t(`call.ended.reasons.${state.endReason}`)}
        </p>
        {CAN_REJOIN.has(state.endReason) ? (
          <div className="mt-4">
            <Button onClick={call.reset}>{t('call.ended.rejoin')}</Button>
          </div>
        ) : null}
      </section>
    );
  }

  if (state.phase === 'in-call') {
    const people = state.peers.length + 1;
    const announcement = state.lastRoomEvent
      ? t(`call.announce.${state.lastRoomEvent.kind}`, { name: state.lastRoomEvent.name })
      : '';
    return (
      <section aria-labelledby="call-title" className="mt-6">
        {backLink}
        <h1 id="call-title" className="mt-3 text-2xl font-semibold">
          {meeting.title}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {state.peers.length === 0
            ? t('call.room.alone')
            : t('call.room.count', { count: people })}
        </p>

        <ul
          aria-label={t('call.room.label')}
          className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          <VideoTile
            isSelf
            name={selfName}
            stream={state.localStream}
            showVideo={state.hasCamera && state.cameraEnabled}
            microphoneEnabled={state.microphoneEnabled}
          />
          {state.peers.map((peer) => (
            <VideoTile
              key={peer.id}
              name={peer.displayName}
              stream={peer.stream}
              showVideo={peer.videoEnabled && peer.stream !== null}
              microphoneEnabled={peer.audioEnabled}
              connection={peer.connection}
            />
          ))}
        </ul>

        <CallControls
          microphoneEnabled={state.microphoneEnabled}
          cameraEnabled={state.cameraEnabled}
          hasCamera={state.hasCamera}
          onToggleMicrophone={call.toggleMicrophone}
          onToggleCamera={call.toggleCamera}
          onLeave={call.leave}
        />

        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </section>
    );
  }

  // The lobby, and the moment while connecting (the buttons wait, the camera light may be on).
  const starting = state.phase === 'starting';
  const now = new Date();
  const joinable = canJoin(meeting, now);
  const videoMeeting = meeting.callType === 'video';

  const unavailable =
    meeting.status === 'cancelled'
      ? t('call.lobby.cancelled')
      : !isActive(meeting, now)
        ? t('call.lobby.over')
        : t('call.lobby.notOpenYet', {
            time: text.dateTime(joinOpensAt(meeting).toISOString(), 'long'),
          });

  return (
    <section aria-labelledby="call-title" className="mt-6">
      {backLink}
      <h1 id="call-title" className="mt-3 text-2xl font-semibold">
        {meeting.title}
      </h1>

      {state.startFailure ? (
        <Alert variant="error">{t(`call.startFailures.${state.startFailure}`)}</Alert>
      ) : null}

      {joinable ? (
        <div className="mt-6 max-w-xl">
          <h2 className="text-lg font-semibold">{t('call.lobby.heading')}</h2>
          <p className="mt-2 text-ink-muted">
            {videoMeeting ? t('call.lobby.introVideo') : t('call.lobby.introAudio')}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {videoMeeting ? (
              <>
                <Button pending={starting} onClick={() => call.start('video')}>
                  {starting ? t('call.lobby.connecting') : t('call.lobby.joinVideo')}
                </Button>
                <Button variant="secondary" disabled={starting} onClick={() => call.start('audio')}>
                  {t('call.lobby.joinWithMicrophone')}
                </Button>
              </>
            ) : (
              <Button pending={starting} onClick={() => call.start('audio')}>
                {starting ? t('call.lobby.connecting') : t('call.lobby.joinAudio')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-6">{unavailable}</p>
      )}
    </section>
  );
}
