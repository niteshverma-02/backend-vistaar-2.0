import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { SpineModule } from '@modules/spine/spine.module';

import { AdminLeadsController } from './controllers/admin-leads.controller';
import { LeadsController } from './controllers/leads.controller';
import { OrgLeadsRepository } from './repositories/org-leads.repository';
import { VistaarLeadsRepository } from './repositories/vistaar-leads.repository';
import {
  OrgContact,
  OrgContactSchema,
  OrgLead,
  OrgLeadSchema,
} from './schemas/org-lead.schemas';
import { VistaarLead, VistaarLeadSchema } from './schemas/vistaar-lead.schema';
import { LeadsService } from './services/leads.service';

/**
 * Farmers partners add (PRD C2, C4, C9). The farmer is the org's record —
 * `leads_v2` / `contacts_v2` written here, the person and address through
 * `SpineModule`; the partner's side (holder, stage, follow-up, activity,
 * consent) is `vistaar_v2_leads`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrgLead.name, schema: OrgLeadSchema },
      { name: OrgContact.name, schema: OrgContactSchema },
      { name: VistaarLead.name, schema: VistaarLeadSchema },
    ]),
    AccessModule,
    AgentsModule,
    SettingsModule,
    SpineModule,
  ],
  controllers: [LeadsController, AdminLeadsController],
  providers: [OrgLeadsRepository, VistaarLeadsRepository, LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
