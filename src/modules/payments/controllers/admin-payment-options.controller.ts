import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  PaymentAuditQueryDto,
  ReorderPaymentOptionsDto,
  UpdatePaymentOptionDto,
} from '../dto/payment-option.dto';
import {
  actorOf,
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from '../payments.domain';
import type { PaymentOptionAudit } from '../schemas/payment-option-audit.schema';
import {
  PaymentOptionsService,
  type AdminPaymentOptionView,
  type AdminPaymentOptionsView,
} from '../services/payment-options.service';

const PROVIDER_ENUM = Object.fromEntries(PAYMENT_PROVIDERS.map((p) => [p, p]));

@ApiTags('admin · payments')
@Controller('admin/payment-options')
export class AdminPaymentOptionsController {
  constructor(private readonly options: PaymentOptionsService) {}

  @Get()
  @Can('payments.read')
  @ApiOperation({
    summary:
      'Every online payment option in display order, never-saved ones as off, plus the server kill switch',
  })
  list(): Promise<AdminPaymentOptionsView> {
    return this.options.list();
  }

  @Get('audit')
  @Can('payments.read')
  @ApiOperation({ summary: 'Who changed which option, newest first' })
  audit(
    @Query() query: PaymentAuditQueryDto,
  ): Promise<PageResult<PaymentOptionAudit>> {
    return this.options.auditLog(query);
  }

  @Put('order')
  @Can('payments.write')
  @ApiOperation({
    summary: 'Set the display order: every option id once, first shown first',
  })
  reorder(
    @Body() dto: ReorderPaymentOptionsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ ids: PaymentProvider[] }> {
    return this.options.reorder(dto, actorOf(admin.email));
  }

  @Patch(':id')
  @Can('payments.write')
  @ApiParam({ name: 'id', enum: PAYMENT_PROVIDERS })
  @ApiOperation({
    summary:
      'Switch an option on or off, rename it, or retarget its cohorts (409 VERSION_CONFLICT if stale)',
  })
  update(
    @Param('id', new ParseEnumPipe(PROVIDER_ENUM)) id: PaymentProvider,
    @Body() dto: UpdatePaymentOptionDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminPaymentOptionView> {
    return this.options.update(id, dto, actorOf(admin.email));
  }
}
