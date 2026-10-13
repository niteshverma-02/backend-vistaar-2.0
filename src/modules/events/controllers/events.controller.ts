import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';
import type { PageResult } from '@common/http/page-result';

import { PastEventsQueryDto } from '../dto/event.dto';
import {
  EventsService,
  type PartnerEventView,
} from '../services/events.service';

/** Only stops a looping client. */
const SEAT_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/** Events for the caller's cohort; seats are the caller's own. */
@ApiTags('app · events')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Upcoming events for my cohort, soonest first' })
  upcoming(@CurrentPartnerId() agentId: string): Promise<PartnerEventView[]> {
    return this.events.upcoming(agentId);
  }

  @Get('past')
  @ApiOperation({ summary: 'Past events for my cohort, newest first' })
  past(
    @CurrentPartnerId() agentId: string,
    @Query() query: PastEventsQueryDto,
  ): Promise<PageResult<PartnerEventView>> {
    return this.events.past(agentId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One event' })
  get(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartnerEventView> {
    return this.events.get(agentId, id);
  }

  @Post(':id/register')
  @HttpCode(HttpStatus.OK)
  @Throttle(SEAT_LIMIT)
  @ApiOperation({ summary: 'Take a seat (again is a no-op)' })
  @ApiConflictResponse({ description: '`EVENT_FULL` or `EVENT_CLOSED`' })
  register(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartnerEventView> {
    return this.events.register(agentId, id);
  }

  @Delete(':id/register')
  @Throttle(SEAT_LIMIT)
  @ApiOperation({ summary: 'Give the seat back, before the event starts' })
  @ApiConflictResponse({ description: '`EVENT_CLOSED`' })
  unregister(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PartnerEventView> {
    return this.events.unregister(agentId, id);
  }
}
