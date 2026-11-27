import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { PeerConnectionStatus, StreamLike } from './types';

type VideoTileProps = {
  name: string;
  stream: StreamLike | null;
  /** The user's own tile: muted (you do not need to hear yourself) and mirrored, like a mirror. */
  isSelf?: boolean;
  /** Whether there is a picture to show; otherwise the name is shown on its own. */
  showVideo: boolean;
  microphoneEnabled: boolean;
  /** Only for other people: how the connection to them is going. */
  connection?: PeerConnectionStatus;
};

/**
 * One participant. The media element is always present, even without a picture, because it is also
 * what plays that person's voice.
 */
export function VideoTile({
  name,
  stream,
  isSelf = false,
  showVideo,
  microphoneEnabled,
  connection,
}: VideoTileProps) {
  const { t } = useTranslation();
  const mediaRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = mediaRef.current;
    if (!element) return;
    // Set as a property: React does not reliably apply `muted` as one.
    element.muted = isSelf;
    element.srcObject = stream as MediaStream | null;
  }, [stream, isSelf]);

  const label = isSelf ? t('call.tile.you', { name }) : name;
  const problems = [
    !microphoneEnabled ? t('call.tile.microphoneOff') : null,
    !showVideo ? t('call.tile.cameraOff') : null,
    connection === 'connecting' ? t('call.tile.connecting') : null,
    connection === 'failed' ? t('call.tile.failed') : null,
  ].filter((text): text is string => text !== null);

  return (
    <li className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-control-edge bg-surface">
      <video
        ref={mediaRef}
        autoPlay
        playsInline
        aria-hidden="true"
        className={
          showVideo
            ? `size-full object-cover ${isSelf ? '-scale-x-100' : ''}`
            : 'sr-only' /* keeps playing the voice without a picture */
        }
      />
      {!showVideo ? (
        <span
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-full bg-accent text-2xl font-semibold text-white"
        >
          {Array.from(name.trim())[0]?.toUpperCase() ?? '?'}
        </span>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-2 bg-black/70 px-3 py-1.5 text-sm text-white">
        <span className="font-medium">{label}</span>
        {problems.length > 0 ? <span className="text-white/80">{problems.join(' · ')}</span> : null}
      </div>
    </li>
  );
}
