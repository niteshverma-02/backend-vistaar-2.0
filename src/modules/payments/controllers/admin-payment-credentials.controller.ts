import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import { PageQueryDto } from '@common/dto/page-query.dto';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CredentialReasonDto,
  SubmitCredentialsDto,
} from '../dto/payment-credential.dto';
import { PAYMENT_PROVIDERS, type PaymentProvider } from '../payments.domain';
import {
  PaymentCredentialsService,
  type CredentialView,
  type CredentialsOverview,
} from '../services/payment-credentials.service';

const PROVIDER_ENUM = Object.fromEntries(PAYMENT_PROVIDERS.map((p) => [p, p]));

/** Emails are compared for the two-person rule; one spelling only. */
const who = (admin: AdminPrincipal): string => admin.email.trim().toLowerCase();

/**
 * Merchant keys. Every route needs `payments.credentials` (company admins
 * only, not the Offline Head), no response is cached anywhere, and no
 * response ever holds a secret.
 */
@ApiTags('admin · payments')
@Controller('admin/payment-credentials')
export class AdminPaymentCredentialsController {
  constructor(private readonly credentials: PaymentCredentialsService) {}

  @Get()
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Live and waiting keys of every provider (secrets masked), the form fields, and whether this server can store keys',
  })
  overview(): Promise<CredentialsOverview> {
    return this.credentials.overview();
  }

  @Get(':provider/history')
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'provider', enum: PAYMENT_PROVIDERS })
  @ApiOperation({
    summary: 'Every set of keys a provider has had, newest first',
  })
  history(
    @Param('provider', new ParseEnumPipe(PROVIDER_ENUM))
    provider: PaymentProvider,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<CredentialView>> {
    return this.credentials.history(provider, query);
  }

  @Post(':provider')
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiParam({ name: 'provider', enum: PAYMENT_PROVIDERS })
  @ApiOperation({
    summary:
      'Submit new keys — they wait, encrypted, until the gateway check passes and a second admin approves (409 CREDENTIALS_PENDING if a set is already waiting)',
  })
  submit(
    @Param('provider', new ParseEnumPipe(PROVIDER_ENUM))
    provider: PaymentProvider,
    @Body() dto: SubmitCredentialsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CredentialView> {
    return this.credentials.submit(provider, dto, who(admin));
  }

  @Post('requests/:id/test')
  @HttpCode(200)
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({
    summary:
      'Check the waiting keys with the gateway (no money moves); approval needs a pass',
  })
  test(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CredentialView> {
    return this.credentials.test(id, who(admin));
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Approve waiting keys — must be a different admin than the submitter (403 APPROVER_IS_SUBMITTER), after a passed check. The old keys are wiped',
  })
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CredentialView> {
    return this.credentials.approve(id, who(admin));
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Reject or withdraw waiting keys; they are wiped' })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CredentialReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CredentialView> {
    return this.credentials.reject(id, who(admin), dto.reason);
  }

  @Post(':provider/revoke')
  @HttpCode(200)
  @Can('payments.credentials')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'provider', enum: PAYMENT_PROVIDERS })
  @ApiOperation({
    summary:
      'Emergency stop: wipe the live keys now. The app stops offering this option within a minute',
  })
  revoke(
    @Param('provider', new ParseEnumPipe(PROVIDER_ENUM))
    provider: PaymentProvider,
    @Body() dto: CredentialReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ revoked: true }> {
    return this.credentials.revoke(provider, who(admin), dto.reason);
  }
}
