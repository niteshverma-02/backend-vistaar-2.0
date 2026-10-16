import { Body, Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import { BankChangeDto } from '../dto/bank-change.dto';
import {
  BankChangeService,
  type BankChangeView,
} from '../services/bank-change.service';

@ApiTags('app · me')
@ApiBearerAuth()
@Controller('me/bank-change')
export class BankChangeController {
  constructor(private readonly bankChange: BankChangeService) {}

  @Get()
  @ApiOperation({
    summary:
      'My pending or last bank account change (account masked), null when none',
  })
  mine(
    @CurrentPartner() partner: PartnerPrincipal,
  ): Promise<BankChangeView | null> {
    return this.bankChange.mine(partner.sub);
  }

  @Post()
  @ApiOperation({
    summary:
      'Ask to be paid into another account — approved partners, one pending at a time; HO verifies the proof',
  })
  request(
    @CurrentPartner() partner: PartnerPrincipal,
    @Body() dto: BankChangeDto,
  ): Promise<BankChangeView> {
    return this.bankChange.request(partner.sub, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Withdraw my pending bank account change' })
  withdraw(
    @CurrentPartner() partner: PartnerPrincipal,
  ): Promise<BankChangeView> {
    return this.bankChange.withdraw(partner.sub);
  }
}
