import { describe, expect, it } from 'vitest';
import { MAX_VIDEO_BITRATE_BPS, MIN_VIDEO_BITRATE_BPS, maxVideoBitrate } from './bitrate';

describe('maxVideoBitrate', () => {
  it('gives a one-to-one call the full ceiling', () => {
    expect(maxVideoBitrate(1)).toBe(MAX_VIDEO_BITRATE_BPS);
    expect(maxVideoBitrate(0)).toBe(MAX_VIDEO_BITRATE_BPS);
  });

  it('shares the upload budget between the streams as people join', () => {
    expect(maxVideoBitrate(2)).toBe(600_000);
    expect(maxVideoBitrate(3)).toBe(400_000); // a full 4-person video room
    expect(maxVideoBitrate(4)).toBe(300_000);
  });

  it('never goes below a usable floor, however many people there are', () => {
    expect(maxVideoBitrate(9)).toBe(MIN_VIDEO_BITRATE_BPS);
    expect(maxVideoBitrate(1000)).toBe(MIN_VIDEO_BITRATE_BPS);
  });

  it('never rises as the room grows', () => {
    let previous = Infinity;
    for (let peers = 1; peers <= 12; peers++) {
      const current = maxVideoBitrate(peers);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('keeps the total upload of a full video room within about a megabit', () => {
    expect(maxVideoBitrate(3) * 3).toBeLessThanOrEqual(1_200_000);
  });
});
