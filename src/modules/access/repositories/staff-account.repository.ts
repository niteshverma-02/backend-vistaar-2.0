import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  StaffAccount,
  type StaffAccountDocument,
} from '../schemas/staff-account.schema';

export interface StaffRecord {
  /** `agents_v2._id` as hex — what `leads_v2.lead_owner.agent_ref` holds. */
  ref: string;
  email: string;
  agent_id: string | null;
  name: string;
  user_role: string | null;
  is_active: boolean;
}

const FIELDS = '_id email agent_id first_name last_name user_role is_active';

type Raw = Partial<StaffAccount> & { _id?: Types.ObjectId | string };

const toRecord = (doc: Raw): StaffRecord => ({
  ref:
    doc._id instanceof Types.ObjectId ? doc._id.toHexString() : (doc._id ?? ''),
  email: doc.email ?? '',
  agent_id: doc.agent_id ?? null,
  name: [doc.first_name, doc.last_name].filter(Boolean).join(' ').trim(),
  user_role: doc.user_role ?? null,
  is_active: doc.is_active === true,
});

@Injectable()
export class StaffAccountRepository {
  constructor(
    @InjectModel(StaffAccount.name)
    private readonly model: Model<StaffAccountDocument>,
  ) {}

  async findByEmail(email: string): Promise<StaffRecord | null> {
    const doc = await this.model
      .findOne({ email })
      .select(FIELDS)
      .lean<Raw | null>()
      .exec();
    return doc ? toRecord(doc) : null;
  }

  /** Active holders of one role, at most `limit` (enough to tell one from many). */
  async findActiveByRole(role: string, limit: number): Promise<StaffRecord[]> {
    const docs = await this.model
      .find({ user_role: role, is_active: true })
      .select(FIELDS)
      .limit(limit)
      .lean<Raw[]>()
      .exec();
    return docs.map(toRecord);
  }

  async findByAgentIds(agentIds: string[]): Promise<StaffRecord[]> {
    if (agentIds.length === 0) return [];
    const docs = await this.model
      .find({ agent_id: { $in: agentIds } })
      .select(FIELDS)
      .lean<Raw[]>()
      .exec();
    return docs.map(toRecord);
  }
}
