import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes, type HydratedDocument } from 'mongoose';

/**
 * `agents_v2` — the company staff directory, shared with every portal and
 * owned by ko-sales. Read-only here: only the fields the HO access check and
 * the owner picker need. `password`, `otp`, `refresh_token`, `sipPassword`
 * exist on these documents and are deliberately never declared.
 */
@Schema({ collection: 'agents_v2', autoIndex: false, strict: false })
export class StaffAccount {
  @Prop({ type: String }) email!: string;
  @Prop({ type: String }) agent_id?: string;
  @Prop({ type: String }) first_name?: string;
  @Prop({ type: String }) last_name?: string;
  @Prop({ type: String }) user_role?: string;
  @Prop({ type: Boolean }) is_active?: boolean;
  /** ko-sales stores the number as a Number. */
  @Prop({ type: SchemaTypes.Mixed }) contact?: {
    country_code?: string;
    phone_number?: number | string;
  };
}

export type StaffAccountDocument = HydratedDocument<StaffAccount>;
export const StaffAccountSchema = SchemaFactory.createForClass(StaffAccount);
