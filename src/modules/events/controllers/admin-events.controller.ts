import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import { PageQueryDto } from '@common/dto/page-query.dto';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateEventDto,
  EventListQueryDto,
  UpdateEventDto,
} from '../dto/event.dto';
import {
  AdminEventsService,
  type AdminEventView,
  type RegistrationRow,
} from '../services/admin-events.service';

/** HO's event calendar; partners see an edit within a minute. */
@ApiTags('admin · events')
@Controller('admin/events')
export class AdminEventsController {
  constructor(private readonly events: AdminEventsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every event, by status, type or cohort' })
  list(@Query() query: EventListQueryDto): Promise<PageResult<AdminEventView>> {
    return this.events.list(query);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One event' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminEventView> {
    return this.events.get(id);
  }

  @Get(':id/registrations')
  @Can('content.read')
  @ApiOperation({ summary: 'Partners who took a seat, first come first' })
  registrations(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<PageResult<RegistrationRow>> {
    return this.events.registrationsOf(id, query);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({ summary: 'Add an event' })
  create(
    @Body() dto: CreateEventDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEventView> {
    return this.events.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Edit, reschedule, retarget or switch off an event (seats never below those taken)',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminEventView> {
    return this.events.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Delete an event and its seats (switch it off to keep history)',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.events.remove(id);
  }
}
