import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';
import {
  EARNING_TRIGGERS,
  REWARD_KINDS,
  type EarningTrigger,
  type RewardKind,
} from '@modules/earning/earning.domain';

import {
  BULK_MAX,
  REWARD_STATUSES,
  type RewardStatus,
} from '../rewards.domain';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * `rewardIdOf`: `<trigger>:<1–3 key parts>:<kind>` — `lead_created:PII-1:coin`,
 * `event_registered:<uuid>:VST-000006:coin`, `reorder:KSK-341382:gig`. Built
 * from the trigger and kind lists so every trigger's rewards can be decided.
 */
const REWARD_ID = new RegExp(
  `^(?:${EARNING_TRIGGERS.join('|')})(?::[A-Za-z0-9_/-]{1,64}){1,3}:(?:${REWARD_KINDS.join('|')})$`,
);

/** `PUT /rewards/coins/:requestId` — coins off one order. */
export class SpendCoinsDto {
  @ApiProperty({ minimum: 1, example: 40 })
  @IsInt({ message: 'coins must be a whole number.' })
  @Min(1, { message: 'coins must be at least 1.' })
  @Max(1_000_000, { message: 'coins is too large.' })
  coins!: number;

  @ApiProperty({
    minimum: 1,
    example: 1250,
    description:
      'The order subtotal (₹, before coins, coupon and delivery): coins never pay more than it',
  })
  @IsInt({ message: 'subtotal must be a whole number.' })
  @Min(1, { message: 'subtotal must be at least 1.' })
  @Max(100_000_000, { message: 'subtotal is too large.' })
  subtotal!: number;
}

/** The app's list: the partner's own rewards, newest first. */
export class RewardsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: REWARD_KINDS })
  @IsOptional()
  @IsIn(REWARD_KINDS)
  kind?: RewardKind;

  @ApiPropertyOptional({ enum: REWARD_STATUSES })
  @IsOptional()
  @IsIn(REWARD_STATUSES)
  status?: RewardStatus;
}

/** HO's queue and history. */
export class AdminRewardsQueryDto extends RewardsQueryDto {
  @ApiPropertyOptional({ enum: EARNING_TRIGGERS })
  @IsOptional()
  @IsIn(EARNING_TRIGGERS)
  trigger?: EarningTrigger;

  @ApiPropertyOptional({ example: 'VST-000006' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^VST-\d+$/, { message: 'agent_id is a VST- id.' })
  agent_id?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'Earned on or after this IST day',
  })
  @IsOptional()
  @Matches(DAY, { message: 'from is a YYYY-MM-DD day.' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Earned on or before this IST day',
  })
  @IsOptional()
  @Matches(DAY, { message: 'to is a YYYY-MM-DD day.' })
  to?: string;
}

/** HO's cards: the same window as the list. */
export class AdminRewardsSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'IST day' })
  @IsOptional()
  @Matches(DAY, { message: 'from is a YYYY-MM-DD day.' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'IST day' })
  @IsOptional()
  @Matches(DAY, { message: 'to is a YYYY-MM-DD day.' })
  to?: string;
}

export class RewardParamDto {
  @ApiProperty({ example: 'lead_created:PII-1620070:coin' })
  @Matches(REWARD_ID, { message: 'This is not a reward id.' })
  id!: string;
}

export class RejectRewardDto {
  @ApiProperty({ example: 'Same farmer added twice under two numbers' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason — the partner sees it.' })
  @MaxLength(300)
  reason!: string;
}

export class BulkRewardsDto {
  @ApiProperty({
    type: [String],
    example: ['lead_created:PII-1620070:coin'],
    description: `1–${BULK_MAX} reward ids; only pending ones change`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX)
  @Matches(REWARD_ID, { each: true, message: 'This is not a reward id.' })
  ids!: string[];
}

export class BulkRejectRewardsDto extends BulkRewardsDto {
  @ApiProperty({ example: 'Follow-ups logged without a real call' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Give a reason — the partner sees it.' })
  @MaxLength(300)
  reason!: string;
}
