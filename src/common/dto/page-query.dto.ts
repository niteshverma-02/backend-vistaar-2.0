import type { Type } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** `field` or `-field` — anything else is a typo, not a sort. */
const SORT_PATTERN = /^-?[a-z_][a-z0-9_.]*$/i;

/**
 * Query params for every `/api/v2` list endpoint.
 *
 * `limit` is **clamped, not rejected**: a client asking for 500 gets 200 back
 * with a 200 status. Rejecting it would strand an offline-sync client that
 * guessed high, and the cap is here to protect the server, not to teach the
 * caller arithmetic. `PaginationQueryDto` (v1) rejects instead — that is the
 * older contract and stays as it is.
 */
export class PageQueryDto {
  /**
   * The `@IsInt()` looks redundant next to the transform above it — it is not.
   * `whitelist: true` **strips any property with no validation decorator**,
   * and `forbidNonWhitelisted: true` then answers 400 for it. Without a
   * validator here, `?page=2` came back as "property page should not exist"
   * on every list route in the API.
   */
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Transform(({ value }) => boundedInt(value, 1, 1, Number.MAX_SAFE_INTEGER))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_LIMIT,
    default: DEFAULT_LIMIT,
    description: `Clamped to ${MAX_LIMIT}; a larger value is not an error.`,
  })
  @Transform(({ value }) => boundedInt(value, DEFAULT_LIMIT, 1, MAX_LIMIT))
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit = DEFAULT_LIMIT;

  @ApiPropertyOptional({
    type: String,
    default: '-created_at',
    description: '`field` ascending, `-field` descending.',
  })
  @IsString()
  @Matches(SORT_PATTERN, {
    message: 'This list cannot be sorted that way. Please choose another sort.',
  })
  sort = '-created_at';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }

  get sortSpec(): Record<string, 1 | -1> {
    return this.sort.startsWith('-')
      ? { [this.sort.slice(1)]: -1 }
      : { [this.sort]: 1 };
  }
}

/** The fields a paged query carries once `IntersectionType` has merged it. */
interface PageFields {
  page: number;
  limit: number;
  sort: string;
}

/** What `WithPaging` gives back. */
type Paging = Pick<PageQueryDto, 'skip' | 'sortSpec'>;

const PAGING_GETTERS = ['skip', 'sortSpec'] as const;

/**
 * Puts `skip` and `sortSpec` back on a query DTO built with `IntersectionType`.
 *
 * `IntersectionType` copies fields and their decorators, not the prototype, so
 * `PageQueryDto`'s two getters do not survive it. Without them a repository
 * runs `.skip(undefined).sort(undefined)`: every `?page=2` answers page 1 again,
 * and rows past the first page can never be read.
 *
 *   export class AdminPartnerQueryDto extends WithPaging(
 *     IntersectionType(PartnerFilterDto, StageFilterDto),
 *   ) {}
 *
 * The getters are copied onto the merged class's prototype (each
 * `IntersectionType` call makes a fresh class, so nothing else is touched)
 * rather than declared on a class inside this function: `nest build`'s
 * transformer crashes on a class declared there.
 */
export function WithPaging<TBase extends Type<PageFields>>(
  Base: TBase,
): Type<InstanceType<TBase> & Paging> {
  for (const name of PAGING_GETTERS) {
    const getter = Object.getOwnPropertyDescriptor(
      PageQueryDto.prototype,
      name,
    );

    if (getter) Object.defineProperty(Base.prototype, name, getter);
  }

  return Base as unknown as Type<InstanceType<TBase> & Paging>;
}

function boundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Math.trunc(Number(value));

  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, parsed))
    : fallback;
}
