import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { CountersModule } from '@modules/counters/counters.module';
import { SettingsModule } from '@modules/settings/settings.module';

import { AdminAgentProfileController } from './controllers/admin-agent-profile.controller';
import { AgentRepository } from './repositories/agent.repository';
import { Agent, AgentSchema } from './schemas/agent.schema';
import { AgentsService } from './services/agents.service';

/**
 * Owns `vistaar_v2_agents`. Its routes live in auth (login), onboarding
 * (`/me`) and the desk; only HO's verification calls and name changes are here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agent.name, schema: AgentSchema }]),
    AccessModule,
    CountersModule,
    SettingsModule,
  ],
  controllers: [AdminAgentProfileController],
  providers: [AgentRepository, AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
