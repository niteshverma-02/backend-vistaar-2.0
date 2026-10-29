import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';

import { RecordRecentSearchDto } from '../dto/recent-search.dto';
import { RecentSearchService } from '../services/recent-search.service';

/** A partner searches a lot; this only stops a looping client. */
const WRITE_LIMIT = { default: { limit: 60, ttl: 60_000 } };

/** The partner's own recent product searches. Nothing in the body says whose. */
@ApiTags('app · catalog')
@ApiBearerAuth()
@Controller('catalog/recent-searches')
export class RecentSearchController {
  constructor(private readonly recentSearches: RecentSearchService) {}

  @Get()
  @ApiOperation({ summary: 'My recent product searches, newest first' })
  list(@CurrentPartnerId() agentId: string): Promise<string[]> {
    return this.recentSearches.list(agentId);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Record a search term (the same term again moves to the top); returns the updated list',
  })
  record(
    @CurrentPartnerId() agentId: string,
    @Body() dto: RecordRecentSearchDto,
  ): Promise<string[]> {
    return this.recentSearches.record(agentId, dto.term);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear my recent product searches' })
  clear(@CurrentPartnerId() agentId: string): Promise<void> {
    return this.recentSearches.clear(agentId);
  }
}
