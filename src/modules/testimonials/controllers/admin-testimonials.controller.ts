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
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  CreateTestimonialDto,
  TestimonialListQueryDto,
  UpdateTestimonialDto,
} from '../dto/testimonial.dto';
import {
  TestimonialsService,
  type AdminTestimonialView,
} from '../services/testimonials.service';
import type { TestimonialStatus } from '../testimonials.domain';

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
