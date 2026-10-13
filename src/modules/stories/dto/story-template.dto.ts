import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  DESIGN_KEY,
  MAX_TEMPLATE_EMOJIS,
  STORY_TEMPLATES,
  TEMPLATE_KEY,
  type StoryTemplate,
  type TemplateFields,
  type TemplateTexts,
} from '../stories.domain';

export class UpdateStoryTemplateDto {
  @ApiPropertyOptional({ example: { en: 'Diwali offer', hi: 'दिवाली ऑफ़र' } })
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;

  @ApiPropertyOptional({
    example: { en: 'Festive price', hi: 'त्योहार की कीमत' },
  })
  @IsOptional()
  @IsObject()
  hint?: Record<string, string>;

  @ApiPropertyOptional({
    example: {
      en: { kicker: 'Diwali dhamaka', cta: 'Order before Diwali' },
      hi: { kicker: 'दिवाली धमाका', cta: 'दिवाली से पहले ऑर्डर करें' },
    },
    description:
      'Printed on the story: `kicker` (top line, required) and `cta` (`""` = none), per language; `en` required. Replaces the stored set.',
  })
  @IsOptional()
  @IsObject()
  texts?: Record<string, TemplateTexts>;

  @ApiPropertyOptional({
    example: {
      en: {
        headline: 'New stock arrived!',
        body: 'Book yours today.',
        emoji: '📦',
      },
    },
    description:
      "Text the card pre-fills per language (emoji, headline, body, detail1–3), over the layout's defaults; the partner can still edit it. Replaces the stored set.",
  })
  @IsOptional()
  @IsObject()
  fields?: Record<string, TemplateFields>;

  @ApiPropertyOptional({
    example: ['📢', '🌾', '🌱'],
    description: `Icons offered for the story's emoji; at most ${MAX_TEMPLATE_EMOJIS}`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_TEMPLATE_EMOJIS)
  @IsString({ each: true })
  @MaxLength(16, { each: true })
  emojis?: string[];

  @ApiPropertyOptional({
    example: 'diwali_lights',
    nullable: true,
    description:
      "Design key the card opens in; null = keep the partner's current design",
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DESIGN_KEY, { message: 'Please choose a design from the list.' })
  default_design?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Leads the strip with a "Suggested" badge',
  })
  @IsOptional()
  @IsBoolean()
  suggested?: boolean;

  @ApiPropertyOptional({ example: '2026-10-25T00:00:00+05:30', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  starts_at?: string | null;

  @ApiPropertyOptional({ example: '2026-11-05T23:59:59+05:30', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  ends_at?: string | null;

  @ApiPropertyOptional({ example: 1, description: 'Lower first' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ example: true, description: 'false hides the card' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreateStoryTemplateDto extends UpdateStoryTemplateDto {
  @ApiProperty({
    example: 'diwali_offer',
    description:
      'Stable key; saved stories keep it. Not one of the six layout names.',
  })
  @Matches(TEMPLATE_KEY, {
    message:
      'The short name can use only small letters, numbers and _, and must start with a letter (for example diwali_2026).',
  })
  key!: string;

  @ApiProperty({
    enum: STORY_TEMPLATES,
    example: 'product',
    description: 'The layout the app draws it with; cannot change later',
  })
  @IsIn(STORY_TEMPLATES)
  base!: StoryTemplate;

  @ApiProperty({ example: { en: 'Diwali offer' } })
  @IsObject()
  declare label: Record<string, string>;

  @ApiProperty({ example: { en: 'Festive price' } })
  @IsObject()
  declare hint: Record<string, string>;

  @ApiProperty({
    example: { en: { kicker: 'Diwali dhamaka', cta: 'Order before Diwali' } },
  })
  @IsObject()
  declare texts: Record<string, TemplateTexts>;
}
