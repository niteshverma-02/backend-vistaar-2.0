import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminStoryListQueryDto,
  StoryPartnersQueryDto,
  StoryStatsQueryDto,
} from '../dto/admin-story.dto';
import {
  AdminStoriesService,
  type AdminStoryView,
  type PartnerStoryRow,
  type StorySummary,
} from '../services/admin-stories.service';

/** Who is promoting Katyayani on WhatsApp, and with what. */
@ApiTags('admin · stories')
@Controller('admin/stories')
export class AdminStoriesController {
  constructor(private readonly stories: AdminStoriesService) {}

  @Get('summary')
  @Can('stories.read')
  @ApiOperation({
    summary:
      'Saves, shares and sharing partners in an IST date range (default last 30 days, max 92), split by template, channel and day',
  })
  summary(@Query() query: StoryStatsQueryDto): Promise<StorySummary> {
    return this.stories.summary(query);
  }

  @Get('partners')
  @Can('stories.read')
  @ApiOperation({ summary: 'Partners in the range, most shares first' })
  partners(
    @Query() query: StoryPartnersQueryDto,
  ): Promise<PageResult<PartnerStoryRow> & { from: string; to: string }> {
    return this.stories.partners(query);
  }

  @Get('partners/:agentId')
  @Can('stories.read')
  @ApiOperation({ summary: "One partner's days and split in the range" })
  partner(
    @Param('agentId') agentId: string,
    @Query() query: StoryStatsQueryDto,
  ): ReturnType<AdminStoriesService['partner']> {
    return this.stories.partner(agentId, query);
  }

  @Get()
  @Can('stories.read')
  @ApiOperation({
    summary:
      "Partners' saved stories with their images, by partner or template",
  })
  list(
    @Query() query: AdminStoryListQueryDto,
  ): Promise<PageResult<AdminStoryView>> {
    return this.stories.list(query);
  }

  @Get(':id')
  @Can('stories.read')
  @ApiOperation({ summary: 'One saved story' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminStoryView> {
    return this.stories.get(id);
  }

  @Delete(':id')
  @Can('stories.write')
  @ApiOperation({
    summary: "Take a story off a partner's list (its past shares stay counted)",
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.stories.remove(id);
  }
}
