/**
 * Things that happen to meetings through the REST API that the live connections must hear about:
 * a cancelled meeting ends its call, and a person who is removed (or leaves) is disconnected.
 * This small hub keeps the REST routes and the signaling server independent of each other.
 */
export type MeetingEvents = {
  onMeetingCancelled(listener: (meetingId: string) => void): void;
  onInviteeRemoved(listener: (meetingId: string, userId: string) => void): void;
  meetingCancelled(meetingId: string): void;
  inviteeRemoved(meetingId: string, userId: string): void;
};

/**
 * @param reportError called when a listener throws; the REST request that triggered the event
 *   must not fail because of it, since the change itself has already been saved.
 */
export function createMeetingEvents(
  reportError: (error: unknown) => void = () => undefined,
): MeetingEvents {
  const cancelled: ((meetingId: string) => void)[] = [];
  const removed: ((meetingId: string, userId: string) => void)[] = [];

  function run(listeners: readonly (() => void)[]): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        reportError(error);
      }
    }
  }

  return {
    onMeetingCancelled: (listener) => void cancelled.push(listener),
    onInviteeRemoved: (listener) => void removed.push(listener),
    meetingCancelled: (meetingId) => run(cancelled.map((listener) => () => listener(meetingId))),
    inviteeRemoved: (meetingId, userId) =>
      run(removed.map((listener) => () => listener(meetingId, userId))),
  };
}
