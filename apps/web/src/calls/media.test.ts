import { describe, expect, it } from 'vitest';
import { classifyMediaError, localMediaConstraints } from './media';

describe('localMediaConstraints', () => {
  it('asks for audio with echo cancellation and noise suppression', () => {
    expect(localMediaConstraints('audio').audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
    expect(localMediaConstraints('video').audio).toMatchObject({ echoCancellation: true });
  });

  it('asks for no video in an audio call, and modest video in a video call', () => {
    expect(localMediaConstraints('audio').video).toBe(false);
    expect(localMediaConstraints('video').video).toMatchObject({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24 },
    });
  });
});

describe('classifyMediaError', () => {
  const failure = (name: string) => Object.assign(new Error('x'), { name });

  it('recognizes a refused permission', () => {
    for (const name of ['NotAllowedError', 'PermissionDeniedError', 'SecurityError']) {
      expect(classifyMediaError(failure(name)), name).toBe('permission_denied');
    }
  });

  it('recognizes a missing camera or microphone', () => {
    for (const name of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']) {
      expect(classifyMediaError(failure(name)), name).toBe('no_device');
    }
  });

  it('treats anything else as a general media problem', () => {
    expect(classifyMediaError(failure('NotReadableError'))).toBe('media_failed');
    expect(classifyMediaError(new Error('boom'))).toBe('media_failed');
    expect(classifyMediaError('text')).toBe('media_failed');
    expect(classifyMediaError(null)).toBe('media_failed');
  });
});
