// In a mesh call every participant sends a separate video stream to each of the others, so the
// total upload grows with the number of people. Each stream gets a share of a fixed budget instead
// (ADR-001: quality is constrained as the room grows), within sensible limits.

const UPLOAD_BUDGET_BPS = 1_200_000;
export const MIN_VIDEO_BITRATE_BPS = 150_000;
export const MAX_VIDEO_BITRATE_BPS = 800_000;

/** The ceiling for the video sent to each of `remotePeerCount` other participants, in bits per second. */
export function maxVideoBitrate(remotePeerCount: number): number {
  if (remotePeerCount <= 1) return MAX_VIDEO_BITRATE_BPS;
  const share = Math.floor(UPLOAD_BUDGET_BPS / remotePeerCount);
  return Math.min(MAX_VIDEO_BITRATE_BPS, Math.max(MIN_VIDEO_BITRATE_BPS, share));
}
