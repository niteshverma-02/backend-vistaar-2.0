import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import {
  KkdActivityQueryDto,
  KkdSummaryQueryDto,
} from '../dto/kkd-activity.dto';
import type { KkdActivity, KkdSummary } from '../kkd-activity.domain';
import {
  KkdActivityService,
  type KkdStoresView,
} from '../services/kkd-activity.service';

/** The partner's own farmers only. Whose they are comes from the token only. */
@ApiTags('app · kkd activity')
@ApiBearerAuth()
@Controller('kkd-activity')
export class KkdActivityController {
  constructor(private readonly kkd: KkdActivityService) {}

  @Get()
  @ApiOperation({
    summary:
      "My farmers' walk-ins, store orders and crop advice at KKD stores, and their Katyayani app / website orders, app opens and abandoned carts — newest first",
  })
  feed(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: KkdActivityQueryDto,
  ): Promise<PageResult<KkdActivity>> {
    return this.kkd.feed(partner, query);
  }

  @Get('summary')
  @ApiOperation({
    summary:
      'The screen tiles: walk-ins, store orders and app orders in a month; open app carts',
  })
  summary(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: KkdSummaryQueryDto,
  ): Promise<KkdSummary> {
    return this.kkd.summary(partner, query);
  }

  @Get('stores')
  @ApiOperation({
    summary: 'KKD stores within 50 km of where I registered, nearest first',
  })
  stores(@CurrentPartner() partner: PartnerRef): Promise<KkdStoresView> {
    return this.kkd.stores(partner);
  }
}
