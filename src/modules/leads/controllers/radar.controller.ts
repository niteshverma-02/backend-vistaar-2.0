import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import {
  RadarPincodeParamDto,
  RadarPincodeQueryDto,
  RadarQueryDto,
} from '../dto/radar.dto';
import {
  RadarService,
  type RadarPoolPerson,
  type RadarView,
} from '../services/radar.service';

/** A partner taps a marker now and then; a script walking every pincode does not. */
const LIST_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** Farmers and stores around the partner. Whose farmers are whose comes from the token only. */
@ApiTags('app · radar')
@ApiBearerAuth()
@Controller('radar')
export class RadarController {
  constructor(private readonly radar: RadarService) {}

  @Get()
  @ApiOperation({
    summary:
      'Around my GPS: my customers and open leads (dots), KKD stores, and per-pincode counts of KKD leads and org customers',
  })
  around(
    @CurrentPartner() partner: PartnerRef,
    @Query() query: RadarQueryDto,
  ): Promise<RadarView> {
    return this.radar.around(partner, query);
  }

  @Get('pincodes/:pincode')
  @Throttle(LIST_LIMIT)
  @ApiOperation({
    summary:
      'One pincode marker: its KKD leads or org customers, newest first, mobiles masked',
  })
  pincode(
    @CurrentPartner() partner: PartnerRef,
    @Param() params: RadarPincodeParamDto,
    @Query() query: RadarPincodeQueryDto,
  ): Promise<PageResult<RadarPoolPerson>> {
    return this.radar.pincodeList(partner, params.pincode, query);
  }
}
