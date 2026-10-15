import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiConflictResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminGigsQueryDto,
  AssignGigDto,
  CreateGigDto,
  GigParamDto,
  GigReasonDto,
  UpdateGigDto,
} from '../dto/gig.dto';
import {
  AdminGigsService,
  type AdminGigRow,
  type AdminGigView,
  type GigSummary,
} from '../services/admin-gigs.service';

/** HO's gig desk: post, hand out, reopen, cancel, and review the proof. */
@ApiTags('admin · gigs')
@Controller('admin/gigs')
export class AdminGigsController {
  constructor(private readonly gigs: AdminGigsService) {}

  @Get()
  @Can('gigs.read')
  @ApiOperation({
    summary:
      'Every gig, latest start first; by status, partner, state, district, IST days',
  })
  list(@Query() query: AdminGigsQueryDto): Promise<PageResult<AdminGigRow>> {
    return this.gigs.list(query);
  }

  @Get('summary')
  @Can('gigs.read')
  @ApiOperation({
    summary:
      'Cards for IST days (default this whole month): gigs by status, partners, approved payout, farmers',
  })
  summary(@Query() query: AdminGigsQueryDto): Promise<GigSummary> {
    return this.gigs.summary(query);
  }

  @Get(':id')
  @Can('gigs.read')
  @ApiOperation({
    summary:
      'One gig: partner, check-in flags, farmers, photos (1 h links), repeat phones',
  })
  get(@Param() { id }: GigParamDto): Promise<AdminGigView> {
    return this.gigs.get(id);
  }

  @Post()
  @Can('gigs.write')
  @ApiOperation({
    summary: 'Post a gig (payout, min farmers, photos default from settings)',
  })
  create(
    @Body() dto: CreateGigDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('gigs.write')
  @ApiOperation({ summary: 'Edit a gig while nobody holds it' })
  @ApiConflictResponse({
    description: '`GIG_CLOSED`: a partner holds it, or it is closed',
  })
  update(
    @Param() { id }: GigParamDto,
    @Body() dto: UpdateGigDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('gigs.write')
  @ApiOperation({ summary: 'Delete a gig nobody ever took' })
  @ApiConflictResponse({
    description: '`GIG_CLOSED`: taken before — cancel it instead',
  })
  remove(@Param() { id }: GigParamDto): Promise<{ deleted: true }> {
    return this.gigs.remove(id);
  }

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @Can('gigs.write')
  @ApiOperation({ summary: 'Give an open gig to an approved partner' })
  @ApiConflictResponse({ description: '`GIG_TAKEN` / `GIG_CLOSED`' })
  assign(
    @Param() { id }: GigParamDto,
    @Body() dto: AssignGigDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.assign(id, dto, admin.email);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @Can('gigs.write')
  @ApiOperation({
    summary:
      'Take a held gig back and open it for anyone (check-in, farmers, photos cleared)',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`: nobody holds it now' })
  reopen(
    @Param() { id }: GigParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.reopen(id, admin.email);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Can('gigs.write')
  @ApiOperation({
    summary: 'Cancel a gig not yet decided; the partner sees the reason',
  })
  @ApiConflictResponse({
    description: '`GIG_CLOSED`: already decided or cancelled',
  })
  cancel(
    @Param() { id }: GigParamDto,
    @Body() dto: GigReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.cancel(id, dto.reason, admin.email);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Can('gigs.review')
  @ApiOperation({ summary: 'Approve submitted proof; the payout is earned' })
  @ApiConflictResponse({ description: '`GIG_CLOSED`: not waiting for review' })
  approve(
    @Param() { id }: GigParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.approve(id, admin.email);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Can('gigs.review')
  @ApiOperation({
    summary: 'Reject submitted proof; the partner sees the reason',
  })
  @ApiConflictResponse({ description: '`GIG_CLOSED`: not waiting for review' })
  reject(
    @Param() { id }: GigParamDto,
    @Body() dto: GigReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminGigView> {
    return this.gigs.reject(id, dto.reason, admin.email);
  }
}
