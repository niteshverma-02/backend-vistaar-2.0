import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CurrentPartner,
  type PartnerRef,
} from '@common/auth/current-partner.decorator';

import { TodayService } from '../services/today.service';
import type { TodayView } from '../today.domain';

/** The partner's own day. Whose it is comes from the token only. */
@ApiTags('app · today')
@ApiBearerAuth()
@Controller('today')
export class TodayController {
  constructor(private readonly today: TodayService) {}

  @Get()
  @ApiOperation({
    summary:
      "Home's Today's tasks: follow-ups due, saved carts to remind, events today/tomorrow, orders waiting for the warehouse",
  })
  get(@CurrentPartner() partner: PartnerRef): Promise<TodayView> {
    return this.today.get(partner);
  }
}
