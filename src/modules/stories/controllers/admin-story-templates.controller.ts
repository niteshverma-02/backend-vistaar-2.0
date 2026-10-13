import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateStoryTemplateDto,
  UpdateStoryTemplateDto,
} from '../dto/story-template.dto';
import {
  StoryTemplatesService,
  type AdminTemplateView,
} from '../services/story-templates.service';

/**
 * My Story's "Choose a design" cards: the six built-in ones (edit, hide) and
 * HO's custom cards built on their layouts (create, edit, schedule, delete).
 */
@ApiTags('admin · story templates')
@Controller('admin/story-templates')
export class AdminStoryTemplatesController {
  constructor(private readonly templates: StoryTemplatesService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({
    summary: 'Every card, strip order (suggested first; hidden ones too)',
  })
  list(): Promise<AdminTemplateView[]> {
    return this.templates.list();
  }

  @Get(':key')
  @Can('content.read')
  @ApiOperation({ summary: 'One card' })
  get(@Param('key') key: string): Promise<AdminTemplateView> {
    return this.templates.get(key);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Create a custom card on one of the six layouts (409 TEMPLATE_EXISTS if the key is taken)',
  })
  create(
    @Body() dto: CreateStoryTemplateDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminTemplateView> {
    return this.templates.create(dto, admin.email);
  }

  @Patch(':key')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Rename, reword, pre-fill, change icons or design, suggest, schedule, reorder, hide or show a card',
  })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateStoryTemplateDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminTemplateView> {
    return this.templates.update(key, dto, admin.email);
  }

  @Delete(':key')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Delete a custom card (a built-in card is hidden instead); saved stories keep their image',
  })
  remove(@Param('key') key: string): Promise<{ deleted: true }> {
    return this.templates.remove(key);
  }
}
