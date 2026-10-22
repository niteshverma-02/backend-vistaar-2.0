import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import {
  CustomerSessionDto,
  CustomerSessionRequestDto,
} from '../dto/customer-session.dto';
import {
  OtpRequestDto,
  OtpSentDto,
  OtpVerifyDto,
  RefreshDto,
  SessionDto,
} from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';
import { CustomerSessionService } from '../services/customer-session.service';

/** Per IP on the public routes; the OTP service adds a per-number limit on top. */
const PUBLIC_LIMIT = { default: { limit: 20, ttl: 60_000 } };
/** One partner opens a pass at sign-in and when ko-sales refuses the long pass — rarely. */
const CUSTOMER_SESSION_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('app · auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly customerSession: CustomerSessionService,
  ) {}

  @Public()
  @Throttle(PUBLIC_LIMIT)
  @Post('otp/send')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Send an OTP. `intent: login` (default) needs an existing partner; `intent: signup` (Join Vistaar) creates the record.',
  })
  @ApiOkResponse({ type: OtpSentDto })
  send(@Body() dto: OtpRequestDto): Promise<OtpSentDto> {
    return this.auth.sendOtp(dto.phone, dto.country_code, false, dto.intent);
  }

  @Public()
  @Throttle(PUBLIC_LIMIT)
  @Post('otp/resend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resend the OTP (same limits as send)' })
  @ApiOkResponse({ type: OtpSentDto })
  resend(@Body() dto: OtpRequestDto): Promise<OtpSentDto> {
    return this.auth.sendOtp(dto.phone, dto.country_code, true, dto.intent);
  }

  @Public()
  @Throttle(PUBLIC_LIMIT)
  @Post('otp/verify')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verify the OTP → session. First verify gives the VST id and links the PII.',
  })
  @ApiOkResponse({ type: SessionDto })
  verify(
    @Body() dto: OtpVerifyDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<SessionDto> {
    return this.auth.verifyOtp(
      dto.phone,
      dto.country_code,
      dto.otp,
      userAgent ?? null,
      dto.intent,
    );
  }

  @Public()
  @Throttle(PUBLIC_LIMIT)
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'New token pair. The refresh token sent is spent.' })
  @ApiOkResponse({ type: SessionDto })
  refresh(
    @Body() dto: RefreshDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<SessionDto> {
    return this.auth.refresh(dto.refresh_token, userAgent ?? null);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sign this device out (deletes its refresh token)' })
  logout(
    @CurrentPartner() partner: PartnerPrincipal,
    @Body() dto: RefreshDto,
  ): Promise<{ signed_out: true }> {
    return this.auth.logout(partner.sub, dto.refresh_token);
  }

  @Throttle(CUSTOMER_SESSION_LIMIT)
  @Post('customer-session')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "The partner's ko-sales customer pass (Customer Session, path 2) — after sign-in, and again when ko-sales refuses the long pass.",
  })
  @ApiOkResponse({ type: CustomerSessionDto })
  openCustomerSession(
    @CurrentPartner() partner: PartnerPrincipal,
    @Body() dto: CustomerSessionRequestDto,
  ): Promise<CustomerSessionDto> {
    return this.customerSession.open(partner, dto);
  }
}
