import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Executor } from '../db/executor.js';

export type MeetingStatus = 'scheduled' | 'ended' | 'cancelled';
export type CallType = 'audio' | 'video';
export type MeetingRole = 'host' | 'invitee';

export type MeetingRecord = {
  id: string;
  hostId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  durationMinutes: number;
  callType: CallType;
  status: MeetingStatus;
  createdAt: Date;
  updatedAt: Date;
};

/** The fields a host may change after creating a meeting. */
export type MeetingChanges = Partial<
  Pick<MeetingRecord, 'title' | 'description' | 'startsAt' | 'durationMinutes' | 'callType'>
>;

export type MeetingListFilter = {
  /** `upcoming`: scheduled and not over yet. `past`: everything else. */
  when: 'upcoming' | 'past';
  now: Date;
  limit: number;
  offset: number;
};

export type MeetingListRow = MeetingRecord & {
  role: MeetingRole;
  hostDisplayName: string;
  inviteeCount: number;
};

type MeetingRow = RowDataPacket & {
  id: string;
  host_id: string;
  title: string;
  description: string | null;
  starts_at: Date;
  duration_minutes: number;
  call_type: CallType;
  status: MeetingStatus;
  created_at: Date;
  updated_at: Date;
};

type MeetingListDbRow = MeetingRow & {
  role: MeetingRole;
  host_display_name: string;
  invitee_count: number | string;
};

const toMeetingRecord = (row: MeetingRow): MeetingRecord => ({
  id: row.id,
  hostId: row.host_id,
  title: row.title,
  description: row.description,
  startsAt: row.starts_at,
  durationMinutes: row.duration_minutes,
  callType: row.call_type,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const MEETING_COLUMNS =
  'id, host_id, title, description, starts_at, duration_minutes, call_type, status, created_at, updated_at';

// Column names for each editable field. Only these fixed names are ever placed in SQL text;
// values always travel as parameters.
const COLUMN_FOR_FIELD = {
  title: 'title',
  description: 'description',
  startsAt: 'starts_at',
  durationMinutes: 'duration_minutes',
  callType: 'call_type',
} as const;

export async function insertMeeting(db: Executor, meeting: MeetingRecord): Promise<void> {
  await db.execute<ResultSetHeader>(
    `INSERT INTO meetings (${MEETING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      meeting.id,
      meeting.hostId,
      meeting.title,
      meeting.description,
      meeting.startsAt,
      meeting.durationMinutes,
      meeting.callType,
      meeting.status,
      meeting.createdAt,
      meeting.updatedAt,
    ],
  );
}

/**
 * With `forUpdate`, the row stays locked until the surrounding transaction ends, so concurrent
 * edits, cancellations and invitations of the same meeting run one after another.
 */
export async function findMeetingById(
  db: Executor,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<MeetingRecord | null> {
  const lock = options.forUpdate ? ' FOR UPDATE' : '';
  const [rows] = await db.execute<MeetingRow[]>(
    `SELECT ${MEETING_COLUMNS} FROM meetings WHERE id = ?${lock}`,
    [id],
  );
  const row = rows[0];
  return row ? toMeetingRecord(row) : null;
}

/** Applies only the provided fields (an explicit `null` description clears it). */
export async function updateMeetingDetails(
  db: Executor,
  id: string,
  changes: MeetingChanges,
  updatedAt: Date,
): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const field of Object.keys(COLUMN_FOR_FIELD) as (keyof typeof COLUMN_FOR_FIELD)[]) {
    const value = changes[field];
    if (value !== undefined) {
      assignments.push(`${COLUMN_FOR_FIELD[field]} = ?`);
      values.push(value);
    }
  }
  assignments.push('updated_at = ?');
  values.push(updatedAt, id);
  await db.execute<ResultSetHeader>(
    `UPDATE meetings SET ${assignments.join(', ')} WHERE id = ?`,
    values as (string | number | Date | null)[],
  );
}

export async function updateMeetingStatus(
  db: Executor,
  id: string,
  status: MeetingStatus,
  updatedAt: Date,
): Promise<void> {
  await db.execute<ResultSetHeader>('UPDATE meetings SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    updatedAt,
    id,
  ]);
}

// "Not over yet" in SQL, matching isOver() in the meeting rules: the end instant counts as over.
const NOT_OVER =
  "m.status = 'scheduled' AND DATE_ADD(m.starts_at, INTERVAL m.duration_minutes MINUTE) > ?";

/**
 * Meetings the user hosts or is invited to, one page plus the total count. `upcoming` is sorted
 * soonest first; `past` most recent first.
 */
export async function listMeetingsForUser(
  db: Executor,
  userId: string,
  filter: MeetingListFilter,
): Promise<{ rows: MeetingListRow[]; total: number }> {
  const timeCondition = filter.when === 'upcoming' ? NOT_OVER : `NOT (${NOT_OVER})`;
  const direction = filter.when === 'upcoming' ? 'ASC' : 'DESC';
  const where = `(m.host_id = ? OR EXISTS (
       SELECT 1 FROM meeting_invitees i WHERE i.meeting_id = m.id AND i.user_id = ?
     )) AND ${timeCondition}`;
  const whereParams = [userId, userId, filter.now];

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM meetings m WHERE ${where}`,
    whereParams,
  );

  const [rows] = await db.execute<MeetingListDbRow[]>(
    `SELECT m.id, m.host_id, m.title, m.description, m.starts_at, m.duration_minutes, m.call_type,
            m.status, m.created_at, m.updated_at,
            u.display_name AS host_display_name,
            CASE WHEN m.host_id = ? THEN 'host' ELSE 'invitee' END AS role,
            (SELECT COUNT(*) FROM meeting_invitees c WHERE c.meeting_id = m.id) AS invitee_count
       FROM meetings m
       JOIN users u ON u.id = m.host_id
      WHERE ${where}
      ORDER BY m.starts_at ${direction}, m.id ${direction}
      LIMIT ? OFFSET ?`,
    [userId, ...whereParams, filter.limit, filter.offset],
  );

  return {
    total: Number(countRows[0]?.['total'] ?? 0),
    rows: rows.map((row) => ({
      ...toMeetingRecord(row),
      role: row.role,
      hostDisplayName: row.host_display_name,
      inviteeCount: Number(row.invitee_count),
    })),
  };
}
