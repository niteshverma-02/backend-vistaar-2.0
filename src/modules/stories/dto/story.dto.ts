import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  DESIGN_KEY,
  FESTIVAL_KEY,
  PHOTO_MODES,
  SHARE_CHANNELS,
  STORY_IMAGE_KINDS,
  STORY_IMAGE_PATTERN,
  STORY_LANGS,
  STORY_TEMPLATES,
  type PhotoMode,
  type ShareChannel,
  type StoryImageKind,
  type StoryLang,
  type StoryTemplate,
  type StoryTheme,
} from '../stories.domain';

/** The text on the story. Every field is sent; a template leaves the ones it does not use empty. */
export class StoryFieldsDto {
  @ApiProperty({ example: '🌾' })
  @IsString()
  @MaxLength(16)
  emoji!: string;

  @ApiProperty({ example: 'Humic Acid 98%' })
  @IsString()
  @MaxLength(120)
  headline!: string;

  @ApiProperty({ example: 'Stronger roots, greener crop' })
  @IsString()
  @MaxLength(400)
  body!: string;

  @ApiProperty({ example: 'Better flowering' })
  @IsString()
  @MaxLength(120)
  detail1!: string;

  @ApiProperty({ example: 'Wheat, Paddy' })
  @IsString()
  @MaxLength(120)
  detail2!: string;

  @ApiProperty({ example: '1 kg' })
  @IsString()
  @MaxLength(120)
  detail3!: string;

  @ApiProperty({ example: '499' })
  @IsString()
  @MaxLength(12)
  price!: string;

  @ApiProperty({ example: '650' })
  @IsString()
  @MaxLength(12)
  mrp!: string;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;
}

export class StoryConfigDto {
  @ApiProperty({ enum: STORY_TEMPLATES })
  @IsIn(STORY_TEMPLATES)
  template!: StoryTemplate;

  @ApiProperty({ enum: STORY_LANGS })
  @IsIn(STORY_LANGS)
  lang!: StoryLang;

  @ApiProperty({
    example: 'green',
    description:
      'A design `key` from `designs` in GET /stories/content (green, harvest, earth, sky are always there)',
  })
  @Matches(DESIGN_KEY, { message: 'Please choose a design from the list.' })
  theme!: StoryTheme;

  @ApiProperty({ type: StoryFieldsDto })
  @ValidateNested()
  @Type(() => StoryFieldsDto)
  fields!: StoryFieldsDto;

  @ApiProperty({ example: true })
  @IsBoolean()
  show_whatsapp!: boolean;

  @ApiProperty({ enum: PHOTO_MODES })
  @IsIn(PHOTO_MODES)
  photo_mode!: PhotoMode;

  @ApiPropertyOptional({
    example: 'diwali_offer',
    nullable: true,
    description:
      "The custom card it was made from (a `templates[].key` that is not a layout); null = the layout's own card",
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(DESIGN_KEY, { message: 'Please choose a card from the list.' })
  card?: string | null;
}

/** The picker's choices — opaque ids the app understands. */
export class StorySelectionDto {
  @ApiProperty({ example: 'p8' })
  @IsString()
  @MaxLength(80)
  product_id!: string;

  @ApiProperty({ example: '665a2c3d4e5f6789abcdef12' })
  @IsString()
  @MaxLength(80)
  testimonial_id!: string;

  @ApiProperty({ example: 'wheat' })
  @IsString()
  @MaxLength(80)
  crop_id!: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  @Max(50)
  stage_idx!: number;

  @ApiProperty({ example: 'gig:g1' })
  @IsString()
  @MaxLength(80)
  meeting_key!: string;

  @ApiProperty({ example: 'diwali' })
  @ValidateIf((_, v) => v !== '')
  @Matches(FESTIVAL_KEY)
  festival!: string;
}

export class SaveStoryDto {
  @ApiProperty({ type: StoryConfigDto })
  @ValidateNested()
  @Type(() => StoryConfigDto)
  config!: StoryConfigDto;

  @ApiPropertyOptional({ type: StorySelectionDto, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => StorySelectionDto)
  selection?: StorySelectionDto | null;

  @ApiProperty({
    example:
      'vistaar/stories/VST-000001/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png',
    description:
      'The finished image: `path` from `POST /stories/images?kind=render`',
  })
  @Matches(STORY_IMAGE_PATTERN, {
    message: 'The story image was not found. Please upload it again.',
  })
  image!: string;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'The partner photo it was drawn on: `path` from `POST /stories/images?kind=photo`',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(STORY_IMAGE_PATTERN, {
    message: 'The photo was not found. Please upload it again.',
  })
  photo?: string | null;

  @ApiPropertyOptional({
    enum: SHARE_CHANNELS,
    description:
      'Set when the save is a share (the usual case): counted in the same call',
  })
  @IsOptional()
  @IsIn(SHARE_CHANNELS)
  channel?: ShareChannel;
}

export class ShareStoryDto {
  @ApiProperty({ enum: SHARE_CHANNELS })
  @IsIn(SHARE_CHANNELS)
  channel!: ShareChannel;
}

export class StoryImageQueryDto {
  @ApiProperty({
    enum: STORY_IMAGE_KINDS,
    description:
      '`render` = the 9:16 status image; `photo` = the partner photo it is drawn on',
  })
  @IsIn(STORY_IMAGE_KINDS)
  kind!: StoryImageKind;
}

export class UploadedStoryImageDto {
  @ApiProperty({
    example:
      'vistaar/stories/VST-000001/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png',
    description: 'Send as `image` or `photo` when saving the story',
  })
  path!: string;

  @ApiProperty({
    nullable: true,
    description: 'Signed read URL, valid one hour',
  })
  url!: string | null;

  @ApiProperty({ example: 'image/png' })
  content_type!: string;

  @ApiProperty({ example: 412000 })
  size!: number;

  @ApiProperty({ example: 1080 })
  width!: number;

  @ApiProperty({ example: 1920 })
  height!: number;
}
