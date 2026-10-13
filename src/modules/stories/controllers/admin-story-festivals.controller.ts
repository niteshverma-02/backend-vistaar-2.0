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
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateStoryFestivalDto,
  StoryFestivalListQueryDto,
  UpdateStoryFestivalDto,
} from '../dto/story-festival.dto';
import {
  StoryFestivalsService,
  type AdminFestivalView,
} from '../services/story-festivals.service';

/** The greetings My Story's Festival template offers; the app sees an edit within a minute. */
@ApiTags('admin · story festivals')
@Controller('admin/story-festivals')
export class AdminStoryFestivalsController {
  constructor(private readonly festivals: StoryFestivalsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every festival, filtered by status' })
  list(
    @Query() query: StoryFestivalListQueryDto,
  ): Promise<PageResult<AdminFestivalView>> {
    return this.festivals.list(query);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One festival' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminFestivalView> {
    return this.festivals.get(id);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Add a festival greeting (409 FESTIVAL_EXISTS if the key is taken)',
  })
  create(
    @Body() dto: CreateStoryFestivalDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminFestivalView> {
    return this.festivals.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Edit, reorder, schedule or (de)activate a festival',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryFestivalDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminFestivalView> {
    return this.festivals.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Delete a festival; saved stories keep their own text',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.festivals.remove(id);
  }
}
