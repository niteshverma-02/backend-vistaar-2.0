import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

import { LOCATION_SOURCES, type LocationSource } from '../attendance.domain';

@Schema({ _id: false, versionKey: false })
export class PunchLocation {
  @Prop({ type: Number, default: null }) lat!: number | null;
  @Prop({ type: Number, default: null }) lng!: number | null;
  @Prop({ type: Number, default: null }) accuracy_m!: number | null;
  /** What the app shows, e.g. "Rampur, Lucknow". */
  @Prop({ type: String, required: true }) label!: string;
  @Prop({ type: String, enum: LOCATION_SOURCES, required: true })
  source!: LocationSource;
}
const PunchLocationSchema = SchemaFactory.createForClass(PunchLocation);

/** One punch-in to punch-out. Times are the server's, never the phone's. */
@Schema({ _id: false, versionKey: false })
export class PunchSession {
  @Prop({ type: Date, required: true }) in_at!: Date;
  @Prop({ type: PunchLocationSchema, required: true })
  in_location!: PunchLocation;
  /** `null` while on duty. */
  @Prop({ type: Date, default: null }) out_at!: Date | null;
  /** Wherever the partner is at punch-out — not checked against `in_location`. */
  @Prop({ type: PunchLocationSchema, default: null })
  out_location!: PunchLocation | null;
}
const PunchSessionSchema = SchemaFactory.createForClass(PunchSession);

/**
 * One partner's one IST day. The `_id` is `<agent_id>:<date>`, so today's
 * read and every punch are primary-key lookups, a month is an `_id` range,
 * and "one row per partner per day" needs no index of its own.
 */
@Schema({
  collection: 'vistaar_v2_attendance',
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
})
export class AttendanceDay {
  /** `VST-123:2026-10-12`. */
  @Prop({ type: String }) _id!: string;
  @Prop({ type: String, required: true }) agent_id!: string;
  /** IST calendar day, `YYYY-MM-DD`. */
  @Prop({ type: String, required: true }) date!: string;
  /** Oldest first; at most `MAX_SESSIONS_PER_DAY`. */
  @Prop({ type: [PunchSessionSchema], default: [] })
  sessions!: PunchSession[];
  /** The last session is open. */
  @Prop({ type: Boolean, default: false }) punched_in!: boolean;
  @Prop({ type: Date, required: true }) first_in_at!: Date;
  @Prop({ type: Date, default: null }) last_out_at!: Date | null;
  /** Sum of closed sessions; kept so a month never re-adds sessions. */
  @Prop({ type: Number, default: 0 }) worked_ms!: number;
  created_at!: Date;
  updated_at!: Date;
}

export const AttendanceDaySchema = SchemaFactory.createForClass(AttendanceDay);
// The HO board reads one day (or a fortnight) across every partner.
AttendanceDaySchema.index({ date: 1 });

export function attendanceDayId(agentId: string, date: string): string {
  return `${agentId}:${date}`;
}
