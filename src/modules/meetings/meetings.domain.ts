/**
 * Partner meetings (PRD C5; Lovable Meetings / AddMeeting / MeetingDetails):
 * a partner calls their own farmers to a meeting, marks who came, adds
 * walk-ins and captures interested ones as leads. Pure rules — the service
 * only reads and writes.
 */

export const MEETING_TYPES = [
  'farmer_meeting',
  'crop_demo',
  'field_day',
  'disease_camp',
  'soil_health_camp',
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const MEETING_STATUSES = [
  'scheduled',
  'completed',
  'cancelled',
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Who runs it: the partner, or their reporting officer (the app's choice). */
export const ORGANISERS = ['self', 'officer'] as const;
export type Organiser = (typeof ORGANISERS)[number];

/** A village meeting; the list is sent whole, so this also bounds one write. */
export const MAX_ATTENDEES = 300;

/** The app's default title: "<type> · <village>". */
const TYPE_LABEL: Record<MeetingType, string> = {
  farmer_meeting: 'Farmer meeting',
  crop_demo: 'Crop demo',
  field_day: 'Field day',
  disease_camp: 'Disease camp',
  soil_health_camp: 'Soil health camp',
};

export interface Attendee {
  /** Ten digits — one row per phone. */
  phone: string;
  name: string;
  village: string | null;
  /** Set when the farmer is one of the partner's leads or customers. */
  pii_id: string | null;
  invited: boolean;
  present: boolean;
  walk_in: boolean;
  /** Captured as a lead at this meeting. */
  lead_captured: boolean;
}

export function defaultTitle(type: MeetingType, village: string): string {
  return `${TYPE_LABEL[type]} · ${village}`;
}

/** Why the meeting's details cannot change now, or `null`. */
export function editError(status: MeetingStatus): string | null {
  return status === 'scheduled'
    ? null
    : `This meeting is ${status} — it can no longer be changed.`;
}

/** Attendance stays editable after completion (the app's rule), never once cancelled. */
export function attendanceError(status: MeetingStatus): string | null {
  return status === 'cancelled'
    ? 'This meeting was cancelled — attendance cannot change.'
    : null;
}

export function completeError(
  status: MeetingStatus,
  attendees: readonly Attendee[],
): string | null {
  if (status !== 'scheduled') return editError(status);
  return attendees.some((a) => a.present)
    ? null
    : 'Mark at least one farmer present before completing the meeting.';
}

export interface MeetingCounts {
  invited: number;
  present: number;
  leads: number;
}

export function countsOf(attendees: readonly Attendee[]): MeetingCounts {
  return {
    invited: attendees.filter((a) => a.invited).length,
    present: attendees.filter((a) => a.present).length,
    leads: attendees.filter((a) => a.lead_captured).length,
  };
}

/**
 * The list the app sends, merged onto the stored one by phone: the sender
 * decides names, presence and walk-ins, but a link the server made (`pii_id`,
 * `lead_captured`) is kept, so a stale phone cannot undo a capture.
 */
export function mergeAttendees(
  stored: readonly Attendee[],
  sent: readonly Omit<Attendee, 'lead_captured'>[],
): Attendee[] {
  const before = new Map(stored.map((a) => [a.phone, a]));
  return sent.map((a) => {
    const was = before.get(a.phone);
    return {
      ...a,
      pii_id: was?.pii_id ?? a.pii_id,
      lead_captured: was?.lead_captured ?? false,
    };
  });
}

/** The first repeated phone in a list, or `null`. */
export function duplicatePhone(
  attendees: readonly { phone: string }[],
): string | null {
  const seen = new Set<string>();
  for (const a of attendees) {
    if (seen.has(a.phone)) return a.phone;
    seen.add(a.phone);
  }
  return null;
}
