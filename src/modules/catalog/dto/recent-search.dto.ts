import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RecordRecentSearchDto {
  @ApiProperty({ example: 'humic acid' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  term!: string;
}
