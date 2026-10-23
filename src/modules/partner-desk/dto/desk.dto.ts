import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import { STAGES, type Stage } from '@modules/agents/agents.domain';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

/** Sorts the list may use — every one is covered by an index. */
export const DESK_SORTS = [
  'created_at',
  'updated_at',
  'decided_at',
  'last_login_at',
] as const;

export class AgentListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: STAGES })
  @IsOptional()
  @IsIn(STAGES)
  stage?: Stage;

  @ApiPropertyOptional({ example: 'vistaar_agent' })
  @IsOptional()
  @Matches(/^[a-z][a-z0-9_]{1,40}$/)
  cohort?: string;

  @ApiPropertyOptional({ example: 'MADHYA PRADESH' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @ApiPropertyOptional({ example: 'BHOPAL' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  district?: string;

  @ApiPropertyOptional({ example: 'A0-2691' })
  @IsOptional()
  @Matches(/^A0-\d+$/)
  owner_agent_id?: string;

  @ApiPropertyOptional({ description: 'Name, phone (prefix), VST-… or PII-…' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Signed up on or after',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Signed up on or before (whole day)',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Also list numbers that asked for an OTP but never verified',
  })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  include_unverified?: boolean;
}

/** `GET /admin/agents/summary`: read as the list's `from` / `to`. */
export class AgentSummaryQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description:
      'Window start: signed up / approved on or after (a bare day is an IST day)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Window end, included (whole day); none = up to now',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class NearbyQueryDto {
  @ApiPropertyOptional({
    description: 'Override the configured radius (km)',
    example: 5,
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  radius_km?: number;
}
