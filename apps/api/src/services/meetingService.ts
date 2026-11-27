import { randomUUID } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';
import { isDuplicateEntryError } from '../db/mysqlErrors.js';
import { withTransaction } from '../db/transaction.js';
import { DomainError } from '../errors.js';
import {
  countInvitees,
  deleteInvitee,
  insertInvitee,
  isInvitee,
  listInvitees,
} from '../repositories/meetingInvitees.js';
import {
  findMeetingById,
  insertMeeting,
  listMeetingsForUser,
  updateMeetingDetails,
  updateMeetingStatus,
  type CallType,
  type MeetingChanges,
  type MeetingListFilter,
  type MeetingRecord,
  type MeetingRole,
  type MeetingStatus,
} from '../repositories/meetings.js';
import { findUserByEmail, findUserById } from '../repositories/users.js';
import { MAX_INVITEES, isActive, isEditable, isJoinable, startsAtIssue } from './meetingRules.js';

export type NewMeeting = {
  title: string;
  description: string | null;
  startsAt: Date;
  durationMinutes: number;
  callType: CallType;
};

/** `email` is present only when the viewer is the host. */
export type MeetingInvitee = { id: string; displayName: string; email?: string };

export type MeetingSummary = {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  durationMinutes: number;
  callType: CallType;
  status: MeetingStatus;
  /** The role of the user who asked. */
  role: MeetingRole;
  host: { id: string; displayName: string };
  inviteeCount: number;
};

export type MeetingDetail = Omit<MeetingSummary, 'inviteeCount'> & { invitees: MeetingInvitee[] };

export type MeetingListQuery = Pick<MeetingListFilter, 'when' | 'limit' | 'offset'>;

export type JoinableMeeting = { id: string; hostId: string; callType: CallType; role: MeetingRole };

/**
 * Every operation takes the id of the user who asks and enforces what that user may see or do.
 * Users who are neither host nor invitee get `not_found` for a meeting, exactly as if it did not
 * exist, so its existence is not revealed.
 */
export type MeetingService = {
  create(hostId: string, input: NewMeeting): Promise<MeetingDetail>;
  list(
    userId: string,
    query: MeetingListQuery,
  ): Promise<{ items: MeetingSummary[]; total: number }>;
  get(userId: string, meetingId: string): Promise<MeetingDetail>;
  /** Host only, while scheduled and before the start time. */
  update(userId: string, meetingId: string, changes: MeetingChanges): Promise<MeetingDetail>;
  /** Host only. Idempotent for a meeting that is already cancelled. */
  cancel(userId: string, meetingId: string): Promise<void>;
  /** Host only. The invitee is found by exact email. */
  addInvitee(userId: string, meetingId: string, email: string): Promise<Required<MeetingInvitee>>;
  /** The host can remove any invitee; an invitee can remove only themselves. */
  removeInvitee(userId: string, meetingId: string, inviteeUserId: string): Promise<void>;
  /** For the WebSocket ticket endpoint: throws unless the user may join the meeting right now. */
  assertCanJoin(userId: string, meetingId: string): Promise<JoinableMeeting>;
};

export type MeetingServiceDependencies = { pool: Pool; now: () => Date };

export function createMeetingService({ pool, now }: MeetingServiceDependencies): MeetingService {
  /** Loads a meeting the user may see. Same `not_found` whether it is missing or not theirs. */
  async function requireVisibleMeeting(
    db: Executor,
    meetingId: string,
    userId: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<{ meeting: MeetingRecord; role: MeetingRole }> {
    const meeting = await findMeetingById(db, meetingId, options);
    if (!meeting) throw new DomainError('not_found');
    if (meeting.hostId === userId) return { meeting, role: 'host' };
    if (await isInvitee(db, meetingId, userId)) return { meeting, role: 'invitee' };
    throw new DomainError('not_found');
  }

  async function requireHostedMeeting(
    db: Executor,
    meetingId: string,
    userId: string,
  ): Promise<MeetingRecord> {
    const { meeting, role } = await requireVisibleMeeting(db, meetingId, userId, {
      forUpdate: true,
    });
    if (role !== 'host') throw new DomainError('forbidden');
    return meeting;
  }

  async function hostOf(db: Executor, meeting: MeetingRecord): Promise<MeetingSummary['host']> {
    const host = await findUserById(db, meeting.hostId);
    if (!host) throw new Error('Meeting host is missing'); // impossible: foreign key
    return { id: host.id, displayName: host.displayName };
  }

  async function toDetail(
    db: Executor,
    meeting: MeetingRecord,
    role: MeetingRole,
  ): Promise<MeetingDetail> {
    const invitees = await listInvitees(db, meeting.id);
    return {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      startsAt: meeting.startsAt,
      durationMinutes: meeting.durationMinutes,
      callType: meeting.callType,
      status: meeting.status,
      role,
      host: await hostOf(db, meeting),
      invitees: invitees.map((invitee) => ({
        id: invitee.userId,
        displayName: invitee.displayName,
        // Emails are shared only with the host, who typed them to invite.
        ...(role === 'host' ? { email: invitee.email } : {}),
      })),
    };
  }

  function assertStartsAtAcceptable(startsAt: Date, at: Date): void {
    const issue = startsAtIssue(startsAt, at);
    if (issue) throw new DomainError('validation_error', [{ path: 'startsAt', code: issue }]);
  }

  return {
    async create(hostId, input) {
      const at = now();
      assertStartsAtAcceptable(input.startsAt, at);
      const meeting: MeetingRecord = {
        id: randomUUID(),
        hostId,
        ...input,
        status: 'scheduled',
        createdAt: at,
        updatedAt: at,
      };
      await insertMeeting(pool, meeting);
      return toDetail(pool, meeting, 'host');
    },

    async list(userId, query) {
      const { rows, total } = await listMeetingsForUser(pool, userId, { ...query, now: now() });
      return {
        total,
        items: rows.map((row) => ({
          id: row.id,
          title: row.title,
          description: row.description,
          startsAt: row.startsAt,
          durationMinutes: row.durationMinutes,
          callType: row.callType,
          status: row.status,
          role: row.role,
          host: { id: row.hostId, displayName: row.hostDisplayName },
          inviteeCount: row.inviteeCount,
        })),
      };
    },

    async get(userId, meetingId) {
      const { meeting, role } = await requireVisibleMeeting(pool, meetingId, userId);
      return toDetail(pool, meeting, role);
    },

    async update(userId, meetingId, changes) {
      const updated = await withTransaction(pool, async (connection) => {
        const meeting = await requireHostedMeeting(connection, meetingId, userId);
        const at = now();
        if (!isEditable(meeting, at)) throw new DomainError('invalid_state');
        if (changes.startsAt !== undefined) assertStartsAtAcceptable(changes.startsAt, at);
        await updateMeetingDetails(connection, meetingId, changes, at);
        return { ...meeting, ...definedFields(changes), updatedAt: at };
      });
      return toDetail(pool, updated, 'host');
    },

    async cancel(userId, meetingId) {
      await withTransaction(pool, async (connection) => {
        const meeting = await requireHostedMeeting(connection, meetingId, userId);
        if (meeting.status === 'cancelled') return;
        const at = now();
        if (!isActive(meeting, at)) throw new DomainError('invalid_state');
        await updateMeetingStatus(connection, meetingId, 'cancelled', at);
      });
    },

    async addInvitee(userId, meetingId, email) {
      return withTransaction(pool, async (connection) => {
        const meeting = await requireHostedMeeting(connection, meetingId, userId);
        if (!isActive(meeting, now())) throw new DomainError('invalid_state');

        const invitee = await findUserByEmail(connection, email);
        if (!invitee) throw new DomainError('user_not_found');
        if (invitee.id === meeting.hostId || (await isInvitee(connection, meetingId, invitee.id))) {
          throw new DomainError('already_invited');
        }
        // The meeting row is locked, so this count cannot change until we finish.
        if ((await countInvitees(connection, meetingId)) >= MAX_INVITEES) {
          throw new DomainError('invitee_limit_reached');
        }
        try {
          await insertInvitee(connection, meetingId, invitee.id, now());
        } catch (error) {
          if (isDuplicateEntryError(error)) throw new DomainError('already_invited');
          throw error;
        }
        return { id: invitee.id, displayName: invitee.displayName, email: invitee.email };
      });
    },

    async removeInvitee(userId, meetingId, inviteeUserId) {
      const { role } = await requireVisibleMeeting(pool, meetingId, userId);
      if (role === 'invitee' && inviteeUserId !== userId) throw new DomainError('forbidden');
      if (!(await deleteInvitee(pool, meetingId, inviteeUserId)))
        throw new DomainError('not_found');
    },

    async assertCanJoin(userId, meetingId) {
      const { meeting, role } = await requireVisibleMeeting(pool, meetingId, userId);
      if (!isJoinable(meeting, now())) throw new DomainError('invalid_state');
      return { id: meeting.id, hostId: meeting.hostId, callType: meeting.callType, role };
    },
  };
}

/** Drops fields that were not provided, so spreading it never overwrites a value with undefined. */
function definedFields(changes: MeetingChanges): MeetingChanges {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as MeetingChanges;
}
