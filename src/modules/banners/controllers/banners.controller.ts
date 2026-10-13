import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import {
  BannersService,
  type PartnerBannerView,
} from '../services/banners.service';

@ApiTags('app · banners')
@ApiBearerAuth()
@Controller('banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  @ApiOperation({
    summary:
      "Home carousel: live banners for the caller's cohort, in display order (max 10)",
  })
  list(
    @CurrentPartner() partner: PartnerPrincipal,
  ): Promise<PartnerBannerView[]> {
    return this.banners.forPartner(partner.sub);
  }
}
