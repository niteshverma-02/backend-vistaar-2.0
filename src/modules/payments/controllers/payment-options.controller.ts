import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import {
  PaymentOptionsService,
  type PartnerPaymentOptionView,
} from '../services/payment-options.service';

@ApiTags('app · payments')
@ApiBearerAuth()
@Controller('payment-options')
export class PaymentOptionsController {
  constructor(private readonly options: PaymentOptionsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Pay online: the options HO switched on for the caller's cohort, in display order. Empty = online payment is off",
  })
  list(
    @CurrentPartner() partner: PartnerPrincipal,
  ): Promise<PartnerPaymentOptionView[]> {
    return this.options.forPartner(partner.sub);
  }
}
