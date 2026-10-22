import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument } from 'mongoose';

/**
 * The IST day cohort dates were last checked on, one row for every process
 * (`_id: 'earning_window_day'`): whichever moves it to today runs that day's
 * recompute, so a cluster runs it once, not once per worker.
 */
@Schema({ collection: 'vistaar_v2_earning_window', versionKey: false })
export class EarningWindow {
  @Prop({ type: String }) _id!: string;
  /** IST `YYYY-MM-DD`. */
  @Prop({ type: String, required: true }) day!: string;
}

export type EarningWindowDocument = HydratedDocument<EarningWindow>;
export const EarningWindowSchema = SchemaFactory.createForClass(EarningWindow);
