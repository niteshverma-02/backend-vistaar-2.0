import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

import { OTP_INTENTS, type OtpIntent } from '../auth.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class OtpRequestDto {
  @ApiProperty({ example: '9876543210', description: '10-digit mobile number' })
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  phone!: string;

  @ApiPropertyOptional({
    example: '+91',
    default: '+91',
    description: 'India only for now',
  })
  @IsOptional()
  @IsIn(['+91'], {
    message: 'Only Indian (+91) mobile numbers are supported.',
  })
  country_code: string = '+91';

  @ApiPropertyOptional({
    enum: OTP_INTENTS,
    default: 'login',
    description:
      '`login` (default) — an existing partner only, else 404 ACCOUNT_NOT_FOUND. ' +
      '`signup` — Join Vistaar; a registered number gets 409 ACCOUNT_EXISTS.',
  })
  @IsOptional()
  @IsIn(OTP_INTENTS)
  intent: OtpIntent = 'login';
}

export class OtpVerifyDto extends OtpRequestDto {
  @ApiProperty({ example: '6942' })
  @Transform(trim)
  @Matches(/^\d{4,6}$/, { message: 'Please enter the OTP (4 to 6 digits).' })
  otp!: string;
}

export class RefreshDto {
  @ApiProperty({
    description:
      'The refresh_token from the last verify or refresh. Rotated on every use.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  refresh_token!: string;
}

export class OtpSentDto {
  @ApiProperty({ example: true }) sent!: true;
  @ApiProperty({
    example: 30,
    description: 'Show the resend button after this many seconds',
  })
  resend_after_seconds!: number;
}

export class SessionAgentDto {
  @ApiProperty({ example: 'VST-000001' }) agent_id!: string;
  @ApiProperty({ example: 'PII-1617919' }) pii_id!: string;
  @ApiProperty({ example: 'signed_up' }) stage!: string;
  @ApiProperty({ example: false }) is_approved!: boolean;
  @ApiPropertyOptional({ example: null, nullable: true }) onboarding_id!:
    string | null;
}

export class SessionDto {
  @ApiProperty() access_token!: string;
  @ApiProperty({
    description: 'Send to /auth/refresh. Store the new one every time.',
  })
  refresh_token!: string;
  @ApiProperty({ example: 'Bearer' }) token_type!: 'Bearer';
  @ApiProperty({
    example: 43200,
    description: 'Access token lifetime, seconds',
  })
  expires_in!: number;
  @ApiProperty({ type: SessionAgentDto }) agent!: SessionAgentDto;
}
