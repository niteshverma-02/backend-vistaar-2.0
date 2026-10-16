import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { AuthModule } from '@modules/auth/auth.module';
import { EarningModule } from '@modules/earning/earning.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { RewardsModule } from '@modules/rewards/rewards.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { SpineModule } from '@modules/spine/spine.module';

import { AdminLeadsController } from './controllers/admin-leads.controller';
import { AdminCustomersController } from './controllers/admin-customers.controller';
import { CustomersController } from './controllers/customers.controller';
import { LeadsController } from './controllers/leads.controller';
import { OrderEventsController } from './controllers/order-events.controller';
import { RadarController } from './controllers/radar.controller';
import { OrderEventsGuard } from './guards/order-events.guard';
import { KkdStoreRepository } from './repositories/kkd-store.repository';
import { OrgLeadsRepository } from './repositories/org-leads.repository';
import { VistaarLeadsRepository } from './repositories/vistaar-leads.repository';
import {
  OrgContact,
  OrgContactSchema,
  OrgLead,
  OrgLeadSchema,
} from './schemas/org-lead.schemas';
import { VistaarLead, VistaarLeadSchema } from './schemas/vistaar-lead.schema';
import { CustomersService } from './services/customers.service';
import { LeadOtpService } from './services/lead-otp.service';
import { LeadsService } from './services/leads.service';
import { RadarService } from './services/radar.service';

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
    AuthModule,
    EarningModule,
    OrdersModule,
    RewardsModule,
    SettingsModule,
    SpineModule,
  ],
  controllers: [
    LeadsController,
    AdminLeadsController,
    CustomersController,
    AdminCustomersController,
    OrderEventsController,
    RadarController,
  ],
  providers: [
    OrgLeadsRepository,
    VistaarLeadsRepository,
    LeadsService,
    LeadOtpService,
    CustomersService,
    RadarService,
    KkdStoreRepository,
    OrderEventsGuard,
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
