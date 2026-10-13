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

import { CreateFaqDto, FaqListQueryDto, UpdateFaqDto } from '../dto/faq.dto';
import type { Faq } from '../schemas/faq.schema';
import { FaqsService } from '../services/faqs.service';

/** HO's help FAQs; the app sees an edit within a minute. */
@ApiTags('admin · faqs')
@Controller('admin/faqs')
export class AdminFaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every FAQ, inactive ones included' })
  list(@Query() query: FaqListQueryDto): Promise<PageResult<Faq>> {
    return this.faqs.list(query);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One FAQ' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Faq> {
    return this.faqs.get(id);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary: 'Add a FAQ (409 FAQ_EXISTS if the question is already there)',
  })
  create(
    @Body() dto: CreateFaqDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<Faq> {
    return this.faqs.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({ summary: 'Edit a FAQ, its order or switch it off' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFaqDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<Faq> {
    return this.faqs.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({ summary: 'Delete a FAQ for good' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.faqs.remove(id);
  }
}
