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
  CreateStorySampleDto,
  StorySampleListQueryDto,
  UpdateStorySampleDto,
} from '../dto/story-sample.dto';
import type { StorySample } from '../schemas/story-sample.schema';
import { StorySamplesService } from '../services/story-samples.service';

/** Ready-made farmer quotes for My Story; the app sees an edit within a minute. */
@ApiTags('admin · story samples')
@Controller('admin/story-samples')
export class AdminStorySamplesController {
  constructor(private readonly samples: StorySamplesService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every ready-made farmer story' })
  list(
    @Query() query: StorySampleListQueryDto,
  ): Promise<PageResult<StorySample>> {
    return this.samples.list(query);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One farmer story' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<StorySample> {
    return this.samples.get(id);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary: 'Add a farmer story (409 SAMPLE_EXISTS if the key is taken)',
  })
  create(
    @Body() dto: CreateStorySampleDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<StorySample> {
    return this.samples.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({ summary: 'Edit, reorder or switch off a farmer story' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStorySampleDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<StorySample> {
    return this.samples.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Delete a farmer story; saved stories keep their text',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.samples.remove(id);
  }
}
