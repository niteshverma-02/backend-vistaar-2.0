import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { PageQueryDto } from '@common/dto/page-query.dto';

export class CreateTermsDto {
  @ApiProperty({ example: 'Vistaar Partner T&C' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example:
      'https://storage.googleapis.com/micro-dealer.appspot.com/toc%2FVistaar_Partner_T%26C.docx',
    description: 'The full document (docx / pdf), https',
  })
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(1000)
  link!: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'true makes it the one partners see, and switches the others off',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateTermsDto extends PartialType(CreateTermsDto) {}

/** `?is_active=true|false`; absent = both. */
const toOptionalBool = ({ value }: { value: unknown }): boolean | undefined =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : undefined;

const SORTS = ['_id', '-_id', 'title', '-title'] as const;

export class TermsListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: SORTS,
    default: '-_id',
    description: '`_id` = when it was added',
  })
  @IsIn(SORTS)
  override sort = '-_id';

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toOptionalBool)
  @IsBoolean()
  is_active?: boolean;
}

export class TermsTextItemDto {
  @ApiProperty({ example: 'Bank' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;

  @ApiProperty({ example: 'Account number, IFSC, UPI ID' })
  @IsString()
  @MinLength(1)
  @MaxLength(600)
  detail!: string;

  @ApiProperty({ example: 'To pay your commission', nullable: true })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(400)
  purpose!: string | null;
}

export class TermsTextSectionDto {
  @ApiProperty({ example: 'What we collect and why' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  heading!: string;

  @ApiProperty({
    nullable: true,
    example: null,
    description: 'Paragraphs; a blank line starts a new one',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(4000)
  body!: string | null;

  @ApiProperty({ example: [], description: 'Numbered points, in order' })
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(1000, { each: true })
  points!: string[];

  @ApiProperty({
    type: [TermsTextItemDto],
    description: 'Titled rows, in order',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TermsTextItemDto)
  items!: TermsTextItemDto[];
}

/** Write the T&C as text; the server makes the document and adds it as the next version. */
export class ComposeTermsDto {
  @ApiProperty({ example: 'Vistaar Privacy & Terms' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    nullable: true,
    example: 'Privacy Policy and Partner Terms for Vistaar partners …',
  })
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(1000)
  intro!: string | null;

  @ApiProperty({ type: [TermsTextSectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => TermsTextSectionDto)
  sections!: TermsTextSectionDto[];

  @ApiPropertyOptional({
    default: true,
    description:
      'true makes it the one partners see, and switches the others off',
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/** Edit a version's text in place: same `toc_id`, its version goes up by one. */
export class RewriteTermsDto extends OmitType(ComposeTermsDto, [
  'is_active',
] as const) {
  @ApiProperty({
    example: 0,
    description: 'The `__v` of the version you opened',
  })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  version!: number;
}
