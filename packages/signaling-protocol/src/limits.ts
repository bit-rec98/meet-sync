/** Where the signaling WebSocket is served, on the API host. */
export const SIGNALING_PATH = '/api/v1/ws';

/** A ticket for opening the WebSocket is valid for this long and works once. */
export const TICKET_TTL_SECONDS = 30;

/** Largest message the server accepts. Session descriptions are the biggest, around 10-20 KiB. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
export const MAX_SDP_LENGTH = 32 * 1024;
export const MAX_CANDIDATE_LENGTH = 2048;

/**
 * WebSocket close codes. 1000-1015 are defined by the protocol; 4000-4999 are free for
 * applications, which is where the reasons specific to MeetSync live.
 */
export const CLOSE_CODES = {
  normal: 1000,
  goingAway: 1001,
  policyViolation: 1008,
  messageTooBig: 1009,
  /** Something failed on the server's side. */
  internalError: 1011,
  /** The same user joined again, from another tab or after reconnecting. */
  replaced: 4001,
  /** The host removed this user from the meeting. */
  removed: 4002,
  meetingCancelled: 4003,
  /** The user may not join (any more): the meeting closed, was cancelled, or access was lost. */
  notAllowed: 4004,
  roomFull: 4005,
} as const;
