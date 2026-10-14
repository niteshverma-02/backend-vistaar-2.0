import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';

import { RadarQueryDto } from '../dto/radar.dto';
import { RadarService, type RadarView } from '../services/radar.service';

/** The partner's own farmers around them. Whose they are comes from the token only. */
@ApiTags('app · radar')
@ApiBearerAuth()
@Controller('radar')
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  @Get()
  @ApiOperation({
    summary:
      'My customers and open leads within km of my GPS — nearest first; no retailers',
  })
  around(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: RadarQueryDto,
  ): Promise<RadarView> {
    return this.radar.around(partner, query);
  }
}
