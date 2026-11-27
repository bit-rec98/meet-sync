import type { Media } from '@meet-sync/signaling-protocol';
import type { StartFailure } from './types';

/**
 * What to ask the browser for. Echo cancellation and noise suppression matter in a call; the video is
 * modest (360p, 24 fps) because every participant sends a separate copy to each other participant.
 */
export function localMediaConstraints(media: Media): { audio: unknown; video: unknown } {
  return {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video:
      media === 'video'
        ? {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 24 },
            facingMode: 'user',
          }
        : false,
  };
}

/** Turns what `getUserMedia` throws into a failure the screen can explain. */
export function classifyMediaError(error: unknown): StartFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no_device';
    default:
      return 'media_failed';
  }
}
