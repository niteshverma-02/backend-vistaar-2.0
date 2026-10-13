import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  DAY_STATUSES,
  LOCATION_SOURCES,
  MONTH_PATTERN,
  type DayStatus,
  type LocationSource,
} from '../attendance.domain';

const FINITE = { allowNaN: false, allowInfinity: false };

/** Body of punch-in and punch-out: only where the partner is — the time is the server's. */
export class PunchDto {
  @ApiProperty({
    enum: LOCATION_SOURCES,
    example: 'gps',
    description: '`registered` = GPS failed, the registered village is used',
  })
  @IsIn(LOCATION_SOURCES)
  source!: LocationSource;

  @ApiPropertyOptional({
    example: 26.8467,
    nullable: true,
    description: 'Required for `gps`, null for `registered`',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber(FINITE)
  @Min(-90)
  @Max(90)
  lat?: number | null;

  @ApiPropertyOptional({ example: 80.9462, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber(FINITE)
  @Min(-180)
  @Max(180)
  lng?: number | null;

  @ApiPropertyOptional({ example: 12, nullable: true, description: 'Metres' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber(FINITE)
  @Min(0)
  @Max(100_000)
  accuracy_m?: number | null;

  @ApiProperty({
    example: 'Rampur, Lucknow',
    description: 'What the app shows for this punch',
  })
  @IsString()
  @MaxLength(200)
  label!: string;
}

export class AttendanceMonthQueryDto {
  @ApiPropertyOptional({
    example: '2026-10',
    description: 'IST month, `YYYY-MM`; defaults to the current one',
  })
  @IsOptional()
  @Matches(MONTH_PATTERN, {
    message: 'Please choose a valid month, for example 2026-10.',
  })
  month?: string;
}

export class PunchLocationView {
  @ApiProperty({ type: Number, nullable: true, example: 26.8467 })
  lat!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 80.9462 })
  lng!: number | null;
  @ApiProperty({ type: Number, nullable: true, example: 12 })
  accuracy_m!: number | null;
  @ApiProperty({ example: 'Rampur, Lucknow' })
  label!: string;
  @ApiProperty({ enum: LOCATION_SOURCES })
  source!: LocationSource;
}

export class PunchSessionView {
  @ApiProperty() in_at!: Date;
  @ApiProperty({ type: PunchLocationView }) in_location!: PunchLocationView;
  @ApiProperty({ type: Date, nullable: true, description: 'null = on duty' })
  out_at!: Date | null;
  @ApiProperty({ type: PunchLocationView, nullable: true })
  out_location!: PunchLocationView | null;
}

export class AttendanceDayView {
  @ApiProperty({ example: '2026-10-12', description: 'IST day' })
  date!: string;

  @ApiProperty({ enum: DAY_STATUSES })
  status!: DayStatus;

  @ApiProperty({ description: 'A session is open' })
  punched_in!: boolean;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: "The day's first punch-in",
  })
  first_in_at!: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Start of the open (or last) session',
  })
  session_in_at!: Date | null;

  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'Last punch-out; null while on duty',
  })
  last_out_at!: Date | null;

  @ApiProperty({
    example: 18_000_000,
    description:
      'Closed sessions only. On duty, live time = worked_ms + (now − session_in_at)',
  })
  worked_ms!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Rampur, Lucknow',
    description: 'Where the open (or last) session was punched in',
  })
  location!: string | null;

  @ApiProperty({ type: [PunchSessionView], description: 'Oldest first' })
  sessions!: PunchSessionView[];
}

export class AttendanceSummaryView {
  @ApiProperty({ example: 18 }) present_days!: number;
  @ApiProperty({ example: 17 }) closed_days!: number;
  @ApiProperty({ example: 550_800_000, description: 'Over closed days' })
  worked_ms!: number;
  @ApiProperty({ example: 32_400_000, description: '0 with no closed day' })
  avg_worked_ms!: number;
}

export class AttendanceMonthView {
  @ApiProperty({ example: '2026-10' }) month!: string;
  @ApiProperty({
    type: [AttendanceDayView],
    description: 'Days with a punch only, newest first',
  })
  days!: AttendanceDayView[];
  @ApiProperty({ type: AttendanceSummaryView })
  summary!: AttendanceSummaryView;
}
