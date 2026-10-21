import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import { UpdateMeDto } from '../dto/me.dto';
import { MeService, type MeView } from '../services/me.service';

@ApiTags('app · me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({
    summary:
      'Who I am and where my application stands — drives the pending / status screen and what the app unlocks',
  })
  get(@CurrentPartner() partner: PartnerPrincipal): Promise<MeView> {
    return this.me.get(partner.sub);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Edit my profile (approved partners): email, language, place, photo; a new name waits for HO approval',
  })
  @ApiForbiddenResponse({
    description: '`PARTNER_NOT_APPROVED` or `ACCOUNT_BLOCKED`',
  })
  @ApiBadRequestResponse({
    description:
      '`IMAGE_NOT_FOUND`, `FILE_TYPE_NOT_ALLOWED`, `VALIDATION_FAILED`',
  })
  update(
    @CurrentPartner() partner: PartnerPrincipal,
    @Body() dto: UpdateMeDto,
  ): Promise<MeView> {
    return this.me.update(partner.sub, partner.agent_id, dto);
  }
}
