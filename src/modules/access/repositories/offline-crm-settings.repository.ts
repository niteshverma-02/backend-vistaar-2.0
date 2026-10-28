import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * franchise-offline-hub's CRM settings, read only: head office's pick of the
 * Offline Head who owns every offline lead (`PUT /roles/lead-owner`). That
 * service owns and writes the row; Vistaar never does.
 */
@Injectable()
export class OfflineCrmSettingsRepository {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** The picked lead owner's `agent_id`; `null` when none is picked. */
  async pickedLeadOwner(): Promise<string | null> {
    const doc = await this.connection
      .collection<{ _id: string; agent_id?: unknown }>(
        'franchise_v2_crm_settings',
      )
      .findOne({ _id: 'lead_owner' }, { projection: { _id: 0, agent_id: 1 } });
    return typeof doc?.agent_id === 'string' ? doc.agent_id : null;
  }
}
