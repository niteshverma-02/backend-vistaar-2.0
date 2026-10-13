import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

interface LeadRow {
  pii_id?: string;
  lead_owner?: { agent_id?: string };
}

/**
 * Read-only check on ko-sales' `leads_v2`: is this person a lead the partner
 * owns? A farmer a partner registers goes through ko-sales `/leads/upsert`
 * with the partner's `VST-` id as `lead_owner.agent_id`, so that lead is the
 * link between them. Rides the `{pii_id}` index the collection already has.
 */
@Injectable()
export class CustomerLinkRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async ownsLead(agentId: string, piiId: string): Promise<boolean> {
    const lead = await this.connection
      .collection<LeadRow>('leads_v2')
      .findOne(
        { pii_id: piiId, 'lead_owner.agent_id': agentId },
        { projection: { _id: 1 } },
      );
    return lead !== null;
  }
}
