import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, mongo } from 'mongoose';

import { LEAD_SOURCE } from '../leads.domain';
import {
  OrgContact,
  OrgLead,
  type OrgContactDocument,
  type OrgLeadDocument,
} from '../schemas/org-lead.schemas';

/** `taken_id` — the counter handed out an id already in use; `taken_person` — the person already has one. */
export type InsertResult = 'ok' | 'taken_id' | 'taken_person';

export interface OrgLeadFacts {
  lead_id: string;
  source?: string;
  created_by?: string;
}

export interface OrgContactFacts {
  profile?: string;
  source?: string;
}

/** E11000 on `pii_id` means the person; on anything else, the id. */
function insertResultOf(error: unknown): InsertResult {
  if (!(error instanceof mongo.MongoServerError) || error.code !== 11000)
    throw error;
  const keys = Object.keys(
    (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {},
  );
  return keys.includes('pii_id') ? 'taken_person' : 'taken_id';
}

/**
 * The org's `leads_v2` / `contacts_v2`, written through the driver so a
 * document lands exactly as built — no casting, no defaults added. Updates
 * filter on `source`, so only rows Vistaar wrote are ever changed.
 */
@Injectable()
export class OrgLeadsRepository {
  constructor(
    @InjectModel(OrgLead.name) private readonly leads: Model<OrgLeadDocument>,
    @InjectModel(OrgContact.name)
    private readonly contacts: Model<OrgContactDocument>,
  ) {}

  leadOf(piiId: string): Promise<OrgLeadFacts | null> {
    return this.leads
      .findOne({ pii_id: piiId })
      .select('lead_id source created_by')
      .lean<OrgLeadFacts | null>()
      .exec();
  }

  contactOf(piiId: string): Promise<OrgContactFacts | null> {
    return this.contacts
      .findOne({ pii_id: piiId })
      .select('profile source')
      .lean<OrgContactFacts | null>()
      .exec();
  }

  /** `lead_owner.agent_ref` is stored as an ObjectId, as ko-sales stores it. */
  async insertLead(
    doc: { lead_owner: { agent_id: string; agent_ref: string } } & Record<
      string,
      unknown
    >,
  ): Promise<InsertResult> {
    const ref = doc.lead_owner.agent_ref;
    const lead = {
      ...doc,
      lead_owner: {
        agent_id: doc.lead_owner.agent_id,
        agent_ref: Types.ObjectId.isValid(ref) ? new Types.ObjectId(ref) : null,
      },
    };
    try {
      await this.leads.collection.insertOne(lead);
      return 'ok';
    } catch (error) {
      return insertResultOf(error);
    }
  }

  async insertContact(doc: Record<string, unknown>): Promise<InsertResult> {
    try {
      await this.contacts.collection.insertOne(doc);
      return 'ok';
    } catch (error) {
      return insertResultOf(error);
    }
  }

  async updateLead(
    leadId: string,
    set: Record<string, unknown>,
  ): Promise<void> {
    await this.leads.collection.updateOne(
      { lead_id: leadId, source: LEAD_SOURCE },
      { $set: set },
    );
  }

  /**
   * Only `follow_up_date` — not even `updated_at` (user, 2026-10-16). A lead
   * another channel wrote fails the `source` filter, so it keeps its own date.
   */
  async setFollowUp(leadId: string, at: Date | null): Promise<void> {
    await this.leads.collection.updateOne(
      { lead_id: leadId, source: LEAD_SOURCE },
      { $set: { follow_up_date: at } },
    );
  }

  async updateContact(
    piiId: string,
    set: Record<string, unknown>,
  ): Promise<void> {
    await this.contacts.collection.updateOne(
      { pii_id: piiId, source: LEAD_SOURCE },
      { $set: set },
    );
  }
}
