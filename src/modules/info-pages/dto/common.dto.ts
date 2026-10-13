import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Headings, titles, labels. */
export const SHORT = 120;
/** A paragraph. */
export const LONG = 1000;
/** A list HO can grow, bounded so one page stays one small read. */
export const MAX_LIST = 30;

export class TitleBodyDto {
  @ApiProperty({ example: 'Commission on delivered orders' })
  @IsString()
  @MinLength(1)
  @MaxLength(SHORT)
  title!: string;

  @ApiProperty({
    example: 'Every partner earns a % of the order value once it is delivered.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(LONG)
  body!: string;
}

/** Every edit names the version it was made from; a newer one means someone saved first. */
export class VersionedDto {
  @ApiProperty({
    example: 3,
    description: 'The `version` you loaded',
  })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  version!: number;
}
