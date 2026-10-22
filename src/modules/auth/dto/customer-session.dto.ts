import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CustomerSessionRequestDto {
  @ApiPropertyOptional({
    example: '3f6c2a9e-…',
    description:
      'Random id made once per app install. A new login from the same device ends its old one on ko-sales.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  device_id?: string;

  @ApiPropertyOptional({
    example: 'Redmi Note 12',
    description: 'Shown to the admin in Customer Session → Logins.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(90)
  device_name?: string;
}

export class CustomerSessionDto {
  @ApiProperty({
    description:
      'ko-sales short pass: `Authorization: Bearer …` on ko-sales customer routes.',
  })
  access_token!: string;
  @ApiProperty({
    description:
      'ko-sales long pass. Renew on ko-sales: `POST /customer/auth/token { grant_type: "refresh_token", phone, refresh_token }`.',
  })
  refresh_token!: string;
  @ApiProperty({ example: 'Bearer' }) token_type!: 'Bearer';
  @ApiProperty({ example: 3600, description: 'Short pass lifetime, seconds' })
  expires_in!: number;
  @ApiProperty({
    example: 2592000,
    description: 'Long pass lifetime, seconds (starts again on every refresh)',
  })
  refresh_expires_in!: number;
  @ApiProperty({
    example: 'PII-1617919',
    description: 'Always the partner’s own pii_id',
  })
  pii_id!: string;
  @ApiProperty({
    example: '9876543210',
    description: 'Ten digits — send exactly this as `phone` when refreshing',
  })
  phone!: string;
}
