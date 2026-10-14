import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  CREDENTIAL_MODES,
  NOTE_MAX,
  REASON_MAX,
  type CredentialMode,
} from '../payment-credentials.domain';

export class SubmitCredentialsDto {
  @ApiProperty({
    enum: CREDENTIAL_MODES,
    description:
      'Production accepts only `live`, every other server only `test`',
  })
  @IsIn(CREDENTIAL_MODES)
  mode!: CredentialMode;

  @ApiProperty({
    description:
      "Exactly the provider's fields (see `fields` in GET /admin/payment-credentials). Secrets are encrypted and never returned.",
    example: {
      key_id: 'rzp_test_XXXXXXXXXXXX',
      key_secret: '…',
      webhook_secret: '…',
    },
  })
  @IsObject()
  fields!: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: NOTE_MAX, example: 'Yearly key rotation' })
  @IsOptional()
  @IsString()
  @MaxLength(NOTE_MAX)
  note?: string;
}

export class CredentialReasonDto {
  @ApiProperty({ minLength: 3, maxLength: REASON_MAX })
  @IsString()
  @MinLength(3)
  @MaxLength(REASON_MAX)
  reason!: string;
}
