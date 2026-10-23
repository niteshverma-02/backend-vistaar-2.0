import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import { OverviewQueryDto, type AdminOverview } from '../dto/overview.dto';
import { OverviewQueryService } from '../services/overview.query-service';

/** HO Home: every Vistaar card in one read. Read-only. */
@ApiTags('admin · overview')
@Controller('admin/overview')
export class AdminOverviewController {
  constructor(private readonly overview: OverviewQueryService) {}

  @Get()
  // Any Vistaar role; each block then checks its own route's capability.
  @Can()
  @ApiOperation({
    summary:
      "Home's Vistaar cards for IST days (default this month so far, ≤ 366): orders vs the period before, partners, farmer leads, today's attendance, payouts, rewards, gigs, NPS — a block the role may not read is null",
  })
  get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: OverviewQueryDto,
  ): Promise<AdminOverview> {
    return this.overview.get(admin, query);
  }
}
