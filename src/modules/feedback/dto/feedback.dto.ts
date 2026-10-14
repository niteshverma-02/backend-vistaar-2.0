import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
  MinLength,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

import {
  CHIPS_PER_BUCKET_MAX,
  COMMENT_MAX,
  DATE_PATTERN,
  FOLLOW_UP_STATUSES,
  NPS_BUCKETS,
  QUESTION_MAX,
  REASONS_PER_ANSWER_MAX,
  REASON_MAX,
  SUGGESTION_CROP_MAX,
  SUGGESTION_NOTE_MAX,
  SUGGESTION_PRODUCT_MAX,
  SUGGESTION_QTY_MAX,
  SUGGESTION_STATUSES,
  type FollowUpStatus,
  type NpsBucket,
  type SuggestionStatus,
} from '../feedback.domain';

// ── App ────────────────────────────────────────────────────────────────────

export class SubmitFeedbackDto {
  @ApiProperty({ minimum: 0, maximum: 10, example: 6 })
  @IsInt({ message: 'Please pick a score from 0 to 10.' })
  @Min(0, { message: 'Please pick a score from 0 to 10.' })
  @Max(10, { message: 'Please pick a score from 0 to 10.' })
  nps!: number;

  @ApiPropertyOptional({
    type: [String],
    example: ['Late delivery', 'Commission delayed'],
    description: `The chips picked for the score's bucket; at most ${REASONS_PER_ANSWER_MAX}`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REASONS_PER_ANSWER_MAX)
  @IsString({ each: true })
  @MaxLength(REASON_MAX, { each: true })
  reasons?: string[];

  @ApiPropertyOptional({
    example: 'Delivery to my village takes a week.',
    maxLength: COMMENT_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(COMMENT_MAX, {
    message: `Please keep your comment under ${COMMENT_MAX} characters.`,
  })
  comment?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    example: 4,
    description: 'App stars; leave out when not given',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}

export class FeedbackReceiptView {
  @ApiProperty({ example: '6710a1f0c2b54e0012ab34cd' }) id!: string;
  @ApiProperty({ enum: NPS_BUCKETS }) bucket!: NpsBucket;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'Detractors only: the Prasar Officer calls back by this time (2 working days)',
  })
  follow_up_due_at!: Date | null;
  @ApiProperty() created_at!: Date;
}

export class SuggestProductDto {
  @ApiProperty({
    example: 'Emamectin benzoate 5% SG',
    minLength: 2,
    maxLength: SUGGESTION_PRODUCT_MAX,
  })
  @IsString()
  @MaxLength(SUGGESTION_PRODUCT_MAX)
  @Matches(/\S.*\S/, { message: 'Please enter the product or molecule name.' })
  product!: string;

  @ApiPropertyOptional({ example: 'Chilli', maxLength: SUGGESTION_CROP_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(SUGGESTION_CROP_MAX)
  crop?: string;

  @ApiPropertyOptional({
    example: '50 packs',
    maxLength: SUGGESTION_QTY_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SUGGESTION_QTY_MAX)
  monthly_demand?: string;

  @ApiPropertyOptional({
    example: 'Farmers buy Missile brand at ₹450 today.',
    maxLength: SUGGESTION_NOTE_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(SUGGESTION_NOTE_MAX)
  note?: string;
}

export class SuggestionReceiptView {
  @ApiProperty({ example: 'SUG-000123' }) ref!: string;
  @ApiProperty({ example: 'Emamectin benzoate 5% SG' }) product!: string;
  @ApiProperty() created_at!: Date;
}

export class NpsReasonsDto {
  @ApiProperty({ example: 'What went wrong?', maxLength: QUESTION_MAX })
  @IsString()
  @IsNotEmpty()
  @MaxLength(QUESTION_MAX)
  question!: string;

  @ApiProperty({ type: [String], example: ['Late delivery'] })
  @IsArray()
  @ArrayMaxSize(CHIPS_PER_BUCKET_MAX)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(REASON_MAX, { each: true })
  chips!: string[];
}

/** All three buckets, every time — the app has no fallback for a missing one. */
export class NpsReasonSetDto {
  @ApiProperty({ type: NpsReasonsDto })
  @ValidateNested()
  @Type(() => NpsReasonsDto)
  detractor!: NpsReasonsDto;

  @ApiProperty({ type: NpsReasonsDto })
  @ValidateNested()
  @Type(() => NpsReasonsDto)
  passive!: NpsReasonsDto;

  @ApiProperty({ type: NpsReasonsDto })
  @ValidateNested()
  @Type(() => NpsReasonsDto)
  promoter!: NpsReasonsDto;
}

// ── HO ─────────────────────────────────────────────────────────────────────

const FEEDBACK_SORTS = [
  'created_at',
  '-created_at',
  'nps',
  '-nps',
  'follow_up.due_at',
  '-follow_up.due_at',
] as const;

const DATE_MESSAGE = 'Please choose a valid date, for example 2026-10-14.';

export class FeedbackListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: FEEDBACK_SORTS, default: '-created_at' })
  @IsIn(FEEDBACK_SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: NPS_BUCKETS })
  @IsOptional()
  @IsIn(NPS_BUCKETS)
  bucket?: NpsBucket;

  @ApiPropertyOptional({
    enum: [...FOLLOW_UP_STATUSES, 'overdue'],
    description: 'Detractor call-backs: open, done, or open and past due',
  })
  @IsOptional()
  @IsIn([...FOLLOW_UP_STATUSES, 'overdue'])
  follow_up?: FollowUpStatus | 'overdue';

  @ApiPropertyOptional({ example: 'VST-000123' })
  @IsOptional()
  @Matches(/^VST-\d+$/i, {
    message: 'Please enter a partner ID like VST-000123.',
  })
  agent_id?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-14',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({
    description: 'Comment, reason, partner name, phone or ID',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class FeedbackSummaryQueryDto {
  @ApiProperty({ example: '2026-10-01', description: 'IST day, included' })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from!: string;

  @ApiProperty({
    example: '2026-10-14',
    description: 'IST day, included; at most 366 days after from',
  })
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to!: string;
}

export class UpdateFollowUpDto {
  @ApiProperty({
    enum: FOLLOW_UP_STATUSES,
    description: '`done` once called; `open` to reopen',
  })
  @IsIn(FOLLOW_UP_STATUSES)
  status!: FollowUpStatus;

  @ApiPropertyOptional({ example: 'Called; delivery issue sent to logistics.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

const SUGGESTION_SORTS = ['created_at', '-created_at'] as const;

export class SuggestionListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SUGGESTION_SORTS, default: '-created_at' })
  @IsIn(SUGGESTION_SORTS)
  declare sort: string;

  @ApiPropertyOptional({ enum: SUGGESTION_STATUSES })
  @IsOptional()
  @IsIn(SUGGESTION_STATUSES)
  status?: SuggestionStatus;

  @ApiPropertyOptional({ example: 'VST-000123' })
  @IsOptional()
  @Matches(/^VST-\d+$/i, {
    message: 'Please enter a partner ID like VST-000123.',
  })
  agent_id?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-14',
    description: 'IST day, included',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: DATE_MESSAGE })
  to?: string;

  @ApiPropertyOptional({
    description: 'Reference, product, crop, note, partner name or phone',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

export class TopProductsQueryDto extends FeedbackSummaryQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UpdateSuggestionDto {
  @ApiPropertyOptional({ enum: SUGGESTION_STATUSES })
  @IsOptional()
  @IsIn(SUGGESTION_STATUSES)
  status?: SuggestionStatus;

  @ApiPropertyOptional({ example: 'Sent to the product team for Q1.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  ho_note?: string;
}
