import { Body, Controller, Delete, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import { ContactUsContentDto, UpdateContactUsDto } from '../dto/contact-us.dto';
import type { InfoPage } from '../schemas/info-page.schema';
import { InfoPagesService } from '../services/info-pages.service';

/** HO's Contact Us page; the app sees a change within a minute. */
@ApiTags('admin · Contact Us')
@Controller('admin/contact-us')
export class AdminContactUsController {
  constructor(private readonly pages: InfoPagesService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'The page as saved (404 = not created yet)' })
  get(): Promise<InfoPage> {
    return this.pages.get('contact_us');
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary: 'Create the page (409 INFO_PAGE_EXISTS if it is already there)',
  })
  create(
    @Body() dto: ContactUsContentDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<InfoPage> {
    return this.pages.create('contact_us', dto, admin.email);
  }

  @Patch()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Edit any part of the page (409 VERSION_CONFLICT if someone saved first)',
  })
  update(
    @Body() dto: UpdateContactUsDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<InfoPage> {
    const { version, ...patch } = dto;
    return this.pages.update('contact_us', patch, version, admin.email);
  }

  @Delete()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Delete the page; the app shows its built-in text until it is created again',
  })
  remove(): Promise<{ deleted: true }> {
    return this.pages.remove('contact_us');
  }
}
