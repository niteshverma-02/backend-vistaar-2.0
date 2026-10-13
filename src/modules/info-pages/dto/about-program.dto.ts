import { ApiProperty, IntersectionType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  LIFECYCLE_STEPS,
  MORE_LINKS,
  type LifecycleStep,
  type MoreLink,
} from '../info-pages.domain';
import {
  LONG,
  MAX_LIST,
  SHORT,
  TitleBodyDto,
  VersionedDto,
} from './common.dto';

const COHORT_KEY = /^[a-z][a-z0-9_]{1,40}$/;

class HeadingDto {
  @ApiProperty({ example: 'Who can join' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  heading!: string;
}

class HeroDto {
  @ApiProperty({ example: 'Vistaar 2.0' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  title!: string;

  @ApiProperty({ example: 'Every partner is a Krishi Sahayak' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  tagline!: string;

  @ApiProperty({
    example: 'One partner app for everyone who sells Katyayani products …',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  intro!: string;
}

class EarnDto extends HeadingDto {
  @ApiProperty({ type: TitleBodyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TitleBodyDto)
  commission!: TitleBodyDto;

  @ApiProperty({ type: TitleBodyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TitleBodyDto)
  gigs!: TitleBodyDto;

  @ApiProperty({ type: TitleBodyDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TitleBodyDto)
  no_payout!: TitleBodyDto;

  @ApiProperty({
    type: TitleBodyDto,
    description: 'Title is the bold part: "Referral reward:"',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => TitleBodyDto)
  referral!: TitleBodyDto;
}

class LifecycleStepDto extends TitleBodyDto {
  @ApiProperty({ enum: LIFECYCLE_STEPS, description: 'Picks the icon' })
  @IsIn(LIFECYCLE_STEPS)
  key!: LifecycleStep;
}

class LifecycleDto extends HeadingDto {
  @ApiProperty({ type: [LifecycleStepDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LIFECYCLE_STEPS.length)
  @ValidateNested({ each: true })
  @Type(() => LifecycleStepDto)
  steps!: LifecycleStepDto[];

  @ApiProperty({
    example:
      'Reversed: order cancelled or returned — the commission is taken back.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  reversed_note!: string;
}

class PayoutsDto extends HeadingDto {
  @ApiProperty({
    example: [
      'Minimum withdrawal {min_withdrawal} from your Withdrawable balance',
    ],
  })
  @IsArray()
  @ArrayMaxSize(MAX_LIST)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(LONG, { each: true })
  points!: string[];
}

class RuleDto {
  @ApiProperty({
    example:
      'One customer, one partner — a farmer or shop is linked to the first partner who adds them.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  text!: string;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'A cohort key; null = everyone',
  })
  @ValidateIf((_, v) => v !== null)
  @Matches(COHORT_KEY, {
    message: 'The partner type must be a cohort key, for example ex_employee.',
  })
  cohort!: string | null;
}

class SopLinkDto {
  @ApiProperty({ example: 'Read the conflict-of-interest SOP' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  label!: string;

  @ApiProperty({ example: 'sop5' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  sop_id!: string;
}

class RulesDto extends HeadingDto {
  @ApiProperty({ type: [RuleDto] })
  @IsArray()
  @ArrayMaxSize(MAX_LIST)
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  items!: RuleDto[];

  @ApiProperty({
    type: SopLinkDto,
    nullable: true,
    description: 'null hides the link',
  })
  @ValidateIf((_, v) => v !== null)
  @IsObject()
  @ValidateNested()
  @Type(() => SopLinkDto)
  sop!: SopLinkDto | null;
}

class CoinsDto extends HeadingDto {
  @ApiProperty({ example: '1 coin = ₹1 off on your next order.' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  headline!: string;

  @ApiProperty({
    example:
      'Earn coins on products you order … Coins are a discount, not cash.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  body!: string;
}

class MoreItemDto extends TitleBodyDto {
  @ApiProperty({ enum: MORE_LINKS, description: 'The screen the row opens' })
  @IsIn(MORE_LINKS)
  key!: MoreLink;
}

class MoreDto extends HeadingDto {
  @ApiProperty({ type: [MoreItemDto] })
  @IsArray()
  @ArrayMaxSize(MORE_LINKS.length)
  @ValidateNested({ each: true })
  @Type(() => MoreItemDto)
  items!: MoreItemDto[];
}

/** About Vistaar (`/about-program`). Cohort cards and commission slabs come from their own APIs. */
export class AboutProgramContentDto {
  @ApiProperty({ type: HeroDto })
  @IsObject()
  @ValidateNested()
  @Type(() => HeroDto)
  hero!: HeroDto;

  @ApiProperty({
    type: HeadingDto,
    description: 'Cards: GET /onboarding/cohorts',
  })
  @IsObject()
  @ValidateNested()
  @Type(() => HeadingDto)
  who_can_join!: HeadingDto;

  @ApiProperty({ type: EarnDto })
  @IsObject()
  @ValidateNested()
  @Type(() => EarnDto)
  earn!: EarnDto;

  @ApiProperty({ type: LifecycleDto })
  @IsObject()
  @ValidateNested()
  @Type(() => LifecycleDto)
  lifecycle!: LifecycleDto;

  @ApiProperty({ type: PayoutsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PayoutsDto)
  payouts!: PayoutsDto;

  @ApiProperty({ type: RulesDto })
  @IsObject()
  @ValidateNested()
  @Type(() => RulesDto)
  rules!: RulesDto;

  @ApiProperty({ type: CoinsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CoinsDto)
  coins!: CoinsDto;

  @ApiProperty({ type: MoreDto })
  @IsObject()
  @ValidateNested()
  @Type(() => MoreDto)
  more!: MoreDto;

  @ApiProperty({ example: 'Powered by Katyayani Organics' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  footer!: string;
}

/** PATCH: any of the page's fields, each replaced whole, plus the version it was made from. */
export class UpdateAboutProgramDto extends IntersectionType(
  PartialType(AboutProgramContentDto),
  VersionedDto,
) {}
