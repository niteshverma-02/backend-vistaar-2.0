import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { badRequest } from '@common/errors/api-error';
import type { PageResult } from '@common/http/page-result';
import { Can } from '@modules/access/guards/capability.guard';

import {
  ComposeTermsDto,
  CreateTermsDto,
  RewriteTermsDto,
  TermsListQueryDto,
  UpdateTermsDto,
} from '../dto/terms.dto';
import type { TermsAndConditions } from '../schemas/terms.schema';
import type { TermsText } from '../terms-docx';
import { TermsService } from '../services/terms.service';
import { TOC_ID } from '../terms.domain';

function checkId(id: string): string {
  if (!TOC_ID.test(id)) {
    throw badRequest('VALIDATION_FAILED', `${id} is not a T&C id (TOC-n).`);
  }
  return id;
}

/** HO's Vistaar T&C versions; one is active, the app sees a change within a minute. */
@ApiTags('admin · terms and conditions')
@Controller('admin/terms-and-conditions')
export class AdminTermsController {
  constructor(private readonly terms: TermsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: "Vistaar's T&C versions, newest first" })
  list(
    @Query() query: TermsListQueryDto,
  ): Promise<PageResult<TermsAndConditions>> {
    return this.terms.list(query);
  }

  @Get(':toc_id')
  @Can('content.read')
  @ApiOperation({ summary: 'One version' })
  get(@Param('toc_id') id: string): Promise<TermsAndConditions> {
    return this.terms.get(checkId(id));
  }

  @Get(':toc_id/text')
  @Can('content.read')
  @ApiOperation({
    summary:
      "A version's text for the editor (409 TERMS_NOT_EDITABLE if its document was not written there)",
  })
  text(
    @Param('toc_id') id: string,
  ): Promise<{ toc_id: string; version: number; text: TermsText }> {
    return this.terms.text(checkId(id));
  }

  @Put(':toc_id/text')
  @Can('content.write')
  @ApiOperation({
    summary:
      "Save a version's edited text: same TOC-n, a new document, version + 1 (409 VERSION_CONFLICT if someone saved first)",
  })
  rewrite(
    @Param('toc_id') id: string,
    @Body() dto: RewriteTermsDto,
  ): Promise<TermsAndConditions> {
    return this.terms.rewrite(checkId(id), dto);
  }

  @Post('compose')
  @Can('content.write')
  @ApiOperation({
    summary:
      'The first T&C written as text: the server makes the .docx and adds it as a new TOC-n (active by default). Later edits: PUT /:toc_id/text',
  })
  compose(@Body() dto: ComposeTermsDto): Promise<TermsAndConditions> {
    return this.terms.compose(dto);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Add a version (next TOC-n); active by default, which switches the others off',
  })
  create(@Body() dto: CreateTermsDto): Promise<TermsAndConditions> {
    return this.terms.create(dto);
  }

  @Patch(':toc_id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Edit title / link, or switch on (switches the others off) or off',
  })
  update(
    @Param('toc_id') id: string,
    @Body() dto: UpdateTermsDto,
  ): Promise<TermsAndConditions> {
    return this.terms.update(checkId(id), dto);
  }

  @Delete(':toc_id')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Delete a switched-off version (409 TERMS_IN_USE for the active one)',
  })
  remove(@Param('toc_id') id: string): Promise<{ deleted: true }> {
    return this.terms.remove(checkId(id));
  }
}
