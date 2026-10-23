import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';
import {
  AdminEditDto,
  OptionalReasonDto,
  OwnerDto,
  ReasonDto,
  RequestChangesDto,
  ReviewDocumentDto,
} from '@modules/onboarding/dto/onboarding.dto';

import {
  AgentListQueryDto,
  AgentSummaryQueryDto,
  NearbyQueryDto,
} from '../dto/desk.dto';
import { DeskService } from '../services/desk.service';

/** `:agentId` is the partner's `VST-…` id. */
@ApiTags('admin · partners')
@Controller('admin/agents')
export class AdminAgentsController {
  constructor(private readonly desk: DeskService) {}

  @Get('summary')
  @Can('agents.read')
  @ApiOperation({
    summary:
      'Count per stage — the pipeline tabs (plus unverified OTP requests); with from / to (≤ 366 days) also partners signed up and approved in that window',
  })
  summary(@Query() query: AgentSummaryQueryDto) {
    return this.desk.summary(query);
  }

  @Get()
  @Can('agents.read')
  @ApiOperation({
    summary:
      'The pipeline list: filters, search, paging; completeness and owner per row',
  })
  list(@Query() query: AgentListQueryDto) {
    return this.desk.list(query);
  }

  @Get(':agentId')
  @Can('agents.read')
  @ApiOperation({
    summary:
      'One partner: record, onboarding data (form + values + signed files + KYC review), owner, nearby network',
  })
  detail(@Param('agentId') agentId: string, @Query() query: NearbyQueryDto) {
    return this.desk.detail(agentId, query.radius_km);
  }

  @Patch(':agentId/onboarding')
  @Can('agents.edit')
  @ApiOperation({
    summary: 'Correct values on the form (audited in updated_data)',
  })
  edit(
    @Param('agentId') agentId: string,
    @Body() dto: AdminEditDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.editOnboarding(agentId, dto.data, admin.email);
  }

  @Post(':agentId/documents/:fieldKey/review')
  @HttpCode(200)
  @Can('kyc.review')
  @ApiOperation({
    summary: 'Verify or reject one KYC document (reason required to reject)',
  })
  review(
    @Param('agentId') agentId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() dto: ReviewDocumentDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.reviewDocument(
      agentId,
      fieldKey,
      dto.decision,
      dto.reason,
      admin.email,
    );
  }

  @Post(':agentId/request-changes')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({
    summary:
      'Send back to the partner with a note per field; only those fields become editable',
  })
  requestChanges(
    @Param('agentId') agentId: string,
    @Body() dto: RequestChangesDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.requestChanges(agentId, dto.remarks, admin.email);
  }

  @Post(':agentId/approve')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({
    summary:
      'Approve — every required document must be verified; maps the form onto the partner',
  })
  approve(
    @Param('agentId') agentId: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.approve(agentId, admin.email);
  }

  @Post(':agentId/reject')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({ summary: 'Reject with a reason (the partner sees it)' })
  reject(
    @Param('agentId') agentId: string,
    @Body() dto: ReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.reject(agentId, dto.reason, admin.email);
  }

  @Post(':agentId/reopen')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({
    summary: 'Give a rejected partner another go (back to onboarding)',
  })
  reopen(
    @Param('agentId') agentId: string,
    @Body() dto: OptionalReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.reopen(agentId, dto.reason, admin.email);
  }

  @Post(':agentId/block')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({
    summary:
      'Block — signs the partner out at the next refresh and refuses OTP login',
  })
  block(
    @Param('agentId') agentId: string,
    @Body() dto: ReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.block(agentId, dto.reason, admin.email);
  }

  @Post(':agentId/unblock')
  @HttpCode(200)
  @Can('agents.decide')
  @ApiOperation({
    summary: 'Unblock — back to the stage the block interrupted',
  })
  unblock(
    @Param('agentId') agentId: string,
    @Body() dto: OptionalReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.unblock(agentId, dto.reason, admin.email);
  }

  @Put(':agentId/owner')
  @Can('agents.assign')
  @ApiOperation({
    summary: 'Change the HO owner (an active agents_v2 account)',
  })
  owner(
    @Param('agentId') agentId: string,
    @Body() dto: OwnerDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ) {
    return this.desk.setOwner(agentId, dto.owner_agent_id, admin.email);
  }
}
