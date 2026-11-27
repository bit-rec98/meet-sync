import type { MeetingDetail, MeetingInvitee, MeetingSummary } from '../services/meetingService.js';

// The shapes returned by the API. Each field is listed explicitly, so a field added to a service
// type is never exposed by accident.

export function toMeetingDto(meeting: MeetingDetail) {
  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    startsAt: meeting.startsAt.toISOString(),
    durationMinutes: meeting.durationMinutes,
    callType: meeting.callType,
    status: meeting.status,
    role: meeting.role,
    host: { id: meeting.host.id, displayName: meeting.host.displayName },
    invitees: meeting.invitees.map(toInviteeDto),
  };
}

export function toMeetingSummaryDto(meeting: MeetingSummary) {
  return {
    id: meeting.id,
    title: meeting.title,
    description: meeting.description,
    startsAt: meeting.startsAt.toISOString(),
    durationMinutes: meeting.durationMinutes,
    callType: meeting.callType,
    status: meeting.status,
    role: meeting.role,
    host: { id: meeting.host.id, displayName: meeting.host.displayName },
    inviteeCount: meeting.inviteeCount,
  };
}

/** `email` is included only when the service provided it (the viewer is the host). */
export function toInviteeDto(invitee: MeetingInvitee) {
  return {
    id: invitee.id,
    displayName: invitee.displayName,
    ...(invitee.email !== undefined ? { email: invitee.email } : {}),
  };
}
