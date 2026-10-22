import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import { badRequest } from '@common/errors/api-error';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateFaqSectionDto,
  FaqSectionListQueryDto,
  UpdateFaqSectionDto,
} from '../dto/faq-section.dto';
import { SECTION_KEY } from '../faqs.domain';
import type { FaqSection } from '../schemas/faq.schema';
import { FaqSectionsService } from '../services/faq-sections.service';

function checkKey(key: string): string {
  if (!SECTION_KEY.test(key)) {
    throw badRequest('VALIDATION_FAILED', `${key} is not a section key.`);
  }
  return key;
}

/** HO's FAQ sections; the app sees a change within a minute. */
@ApiTags('admin · faqs')
@Controller('admin/faq-sections')
export class AdminFaqSectionsController {
  constructor(private readonly sections: FaqSectionsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every FAQ section in display order' })
  list(@Query() query: FaqSectionListQueryDto): Promise<FaqSection[]> {
    return this.sections.list(query.is_active);
  }

  @Get(':key')
  @Can('content.read')
  @ApiOperation({ summary: 'One FAQ section' })
  get(@Param('key') key: string): Promise<FaqSection> {
    return this.sections.get(checkKey(key));
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary: 'Add a section (409 FAQ_SECTION_EXISTS if the key is taken)',
  })
  create(
    @Body() dto: CreateFaqSectionDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<FaqSection> {
    return this.sections.create(dto, admin.email);
  }

  @Patch(':key')
  @Can('content.write')
  @ApiOperation({ summary: 'Rename, reorder or switch off a section' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateFaqSectionDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<FaqSection> {
    return this.sections.update(checkKey(key), dto, admin.email);
  }

  @Delete(':key')
  @Can('content.write')
  @ApiOperation({
    summary: 'Delete an empty section (409 FAQ_SECTION_IN_USE otherwise)',
  })
  remove(@Param('key') key: string): Promise<{ deleted: true }> {
    return this.sections.remove(checkKey(key));
  }
}
