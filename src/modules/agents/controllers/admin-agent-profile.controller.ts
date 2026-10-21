import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiConflictResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  NameChangeRejectDto,
  VerificationCallDto,
} from '../dto/agent-profile.dto';
import { AgentsService } from '../services/agents.service';

/** `:agentId` is the partner's `VST-…` id. Beside the desk's `/admin/agents` routes. */
@ApiTags('admin · partners')
@Controller('admin/agents')
export class AdminAgentProfileController {
  constructor(private readonly agents: AgentsService) {}

  @Post(':agentId/verification-call')
  @HttpCode(200)
  @Can('kyc.review')
  @ApiOperation({
    summary:
      'Log a verification call (reached / not reached / verified) — any stage before a decision; the stage does not move',
  })
  @ApiConflictResponse({ description: '`STAGE_NOT_ALLOWED`' })
  verificationCall(
    @Param('agentId') agentId: string,
    @Body() dto: VerificationCallDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.agents.logVerificationCall(
      agentId,
      dto.outcome,
      dto.note,
      admin.email,
    );
  }

  @Post(':agentId/name-change/approve')
  @HttpCode(200)
  @Can('agents.edit')
  @ApiOperation({
    summary:
      "Approve the partner's requested name — it becomes the profile name",
  })
  @ApiConflictResponse({ description: '`NAME_CHANGE_NOT_PENDING`' })
  approveName(
    @Param('agentId') agentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.agents.decideNameChange(agentId, true, admin.email);
  }

  @Post(':agentId/name-change/reject')
  @HttpCode(200)
  @Can('agents.edit')
  @ApiOperation({
    summary:
      "Refuse the partner's requested name with a reason (shown on the partner's /me)",
  })
  @ApiConflictResponse({ description: '`NAME_CHANGE_NOT_PENDING`' })
  rejectName(
    @Param('agentId') agentId: string,
    @Body() dto: NameChangeRejectDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.agents.decideNameChange(
      agentId,
      false,
      admin.email,
      dto.reason,
    );
  }
}
