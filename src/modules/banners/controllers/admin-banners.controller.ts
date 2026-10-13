import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import { apiError, badRequest } from '@common/errors/api-error';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import { BANNER_IMAGE_MAX_BYTES } from '../banners.domain';
import {
  BannerListQueryDto,
  CreateBannerDto,
  ReorderBannersDto,
  UpdateBannerDto,
  UploadedBannerImageDto,
} from '../dto/banner.dto';
import {
  BannersService,
  type AdminBannerView,
} from '../services/banners.service';

@ApiTags('admin · banners')
@Controller('admin/banners')
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({
    summary: 'Every banner, filtered by status or by the cohort that sees it',
  })
  list(
    @Query() query: BannerListQueryDto,
  ): Promise<PageResult<AdminBannerView>> {
    return this.banners.list(query);
  }

  @Post('image')
  @Can('content.write')
  @ApiOperation({
    summary:
      "Upload banner art (multipart `file`; JPG/PNG/WEBP, ≤ 2 MB, ≥ 600 px wide, 2:1–4:1). Save its `path` as the banner's `image`.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadedBannerImageDto })
  async uploadImage(
    @Req() req: FastifyRequest,
  ): Promise<UploadedBannerImageDto> {
    if (!req.isMultipart()) {
      throw badRequest('FILE_REQUIRED', 'Please choose an image to upload.');
    }
    const file = await req.file({
      limits: { fileSize: BANNER_IMAGE_MAX_BYTES, files: 1 },
      // Leaves `truncated` for the check below, which names this route's limit.
      throwFileSizeLimit: false,
    });
    if (!file)
      throw badRequest('FILE_REQUIRED', 'Please choose an image to upload.');
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'This image is too big. Please use an image smaller than 2 MB.',
      );
    }
    return this.banners.uploadImage(buffer);
  }

  @Put('order')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Set the carousel order: every banner id, first slide first (409 BANNERS_CHANGED if the set is stale)',
  })
  reorder(
    @Body() dto: ReorderBannersDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{ ids: string[] }> {
    return this.banners.reorder(dto.ids, admin.email);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One banner' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminBannerView> {
    return this.banners.get(id);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Add a banner — live at once unless starts_at or is_active say otherwise',
  })
  create(
    @Body() dto: CreateBannerDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBannerView> {
    return this.banners.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Edit, reorder, schedule, retarget or (de)activate a banner',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBannerDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminBannerView> {
    return this.banners.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({ summary: 'Delete a banner for good' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.banners.remove(id);
  }
}
