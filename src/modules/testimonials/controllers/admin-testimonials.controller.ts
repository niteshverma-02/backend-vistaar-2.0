import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { apiError, badRequest } from '@common/errors/api-error';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateTestimonialDto,
  TestimonialListQueryDto,
  UpdateTestimonialDto,
  UploadedTestimonialMediaDto,
} from '../dto/testimonial.dto';
import {
  TestimonialsService,
  type AdminTestimonialView,
} from '../services/testimonials.service';
import {
  HO_MEDIA_MAX_BYTES,
  type TestimonialStatus,
} from '../testimonials.domain';

/** Vistaar's testimonials only (`source: 'vistaar'`); every route needs a Vistaar role and capability. */
@ApiTags('admin · testimonials')
@Controller('admin/testimonials')
export class AdminTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @Can('testimonials.read')
  @ApiOperation({
    summary:
      "Vistaar's testimonials, by tray (pending / approved / removed), newest first",
  })
  list(
    @Query() query: TestimonialListQueryDto,
  ): Promise<PageResult<AdminTestimonialView>> {
    return this.testimonials.list(query);
  }

  @Get('summary')
  @Can('testimonials.read')
  @ApiOperation({ summary: 'How many in each tray' })
  summary(): Promise<Record<TestimonialStatus, number>> {
    return this.testimonials.summary();
  }

  @Post('media')
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'Upload the photo, video or voice note for a testimonial HO files (multipart `file`; photo ≤ 10 MB, video ≤ 60 MB, audio ≤ 20 MB). Send the returned `media_url` on create.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadedTestimonialMediaDto })
  async uploadMedia(
    @Req() req: FastifyRequest,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<UploadedTestimonialMediaDto> {
    if (!req.isMultipart()) {
      throw badRequest(
        'FILE_REQUIRED',
        'Please choose a photo, video or voice note.',
      );
    }
    const file = await req.file({
      limits: { fileSize: HO_MEDIA_MAX_BYTES, files: 1 },
      // Leaves `truncated` for the check below, which names this route's limit.
      throwFileSizeLimit: false,
    });
    if (!file) {
      throw badRequest(
        'FILE_REQUIRED',
        'Please choose a photo, video or voice note.',
      );
    }
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        `This file is too big. Please choose one smaller than ${HO_MEDIA_MAX_BYTES / (1024 * 1024)} MB.`,
      );
    }
    return this.testimonials.uploadMedia(buffer, file.mimetype, admin.email);
  }

  @Get(':id')
  @Can('testimonials.read')
  @ApiOperation({ summary: 'One testimonial' })
  get(@Param('id') id: string): Promise<AdminTestimonialView> {
    return this.testimonials.get(id);
  }

  @Post()
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'File a testimonial HO already has (a media link), on a product or a combo',
  })
  create(
    @Body() dto: CreateTestimonialDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminTestimonialView> {
    return this.testimonials.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'Approve / unapprove, remove / restore, or correct the words, media or name',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTestimonialDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminTestimonialView> {
    return this.testimonials.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('testimonials.write')
  @ApiOperation({
    summary:
      'Delete for good (removing with deleted: true is the undoable way)',
  })
  remove(@Param('id') id: string): Promise<{ deleted: true }> {
    return this.testimonials.remove(id);
  }
}
