import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** The same cap prasar-backend and franchise-offline-hub use — one contract for the portal. */
export const BATCH_MAX_REQUESTS = 25;
export const BATCH_MAX_PATH_LENGTH = 2048;

/**
 * A path under `/api/v2`, never a link to elsewhere (`://`), a climb (`..`, `\`),
 * a fragment (`#`) or another batch — one level only, the same rule on all three backends.
 */
export const BATCH_PATH = /^\/(?!batch(?:[/?]|$))(?!.*(?::\/\/|\.\.|\\|#)).*$/;

export class BatchItemDto {
  @ApiProperty({
    example: '/admin/orders/summary?from=2026-10-01&to=2026-10-23',
    description: 'Relative to `/api/v2`; replayed as a GET.',
  })
  @IsString()
  @MaxLength(BATCH_MAX_PATH_LENGTH)
  @Matches(BATCH_PATH, {
    message:
      'Each path must be a read under /api/v2, for example /admin/orders/summary — not a full link and not /batch.',
  })
  path!: string;
}

export class BatchDto {
  @ApiProperty({ type: [BatchItemDto], maxItems: BATCH_MAX_REQUESTS })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BATCH_MAX_REQUESTS)
  @ValidateNested({ each: true })
  @Type(() => BatchItemDto)
  requests!: BatchItemDto[];
}

export interface BatchItemResult {
  status: number;
  /** The item's own JSON answer (its envelope or error), or null when empty / not JSON. */
  body: unknown;
}

export interface BatchResult {
  responses: BatchItemResult[];
}
