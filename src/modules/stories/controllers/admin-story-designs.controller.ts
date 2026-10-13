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

import {
  CreateStoryDesignDto,
  StoryDesignListQueryDto,
  UpdateStoryDesignDto,
  UploadedDesignImageDto,
} from '../dto/story-design.dto';
import {
  StoryDesignsService,
  type AdminDesignView,
} from '../services/story-designs.service';
import { DESIGN_IMAGE_MAX_BYTES } from '../stories.domain';

/** The looks My Story offers: colours, and optional 9:16 art. The app sees an edit within a minute. */
@ApiTags('admin · story designs')
@Controller('admin/story-designs')
export class AdminStoryDesignsController {
  constructor(private readonly designs: StoryDesignsService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every design, filtered by status' })
  list(
    @Query() query: StoryDesignListQueryDto,
  ): Promise<PageResult<AdminDesignView>> {
    return this.designs.list(query);
  }

  @Post('image')
  @Can('content.write')
  @ApiOperation({
    summary:
      "Upload design art (multipart `file`; JPG/PNG/WEBP, ≤ 3 MB, 9:16, 720–2160 px wide — 1080 × 1920 is best). Save its `path` as the design's `image`.",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadedDesignImageDto })
  async uploadImage(
    @Req() req: FastifyRequest,
  ): Promise<UploadedDesignImageDto> {
    if (!req.isMultipart()) {
      throw badRequest('FILE_REQUIRED', 'Please choose an image to upload.');
    }
    const file = await req.file({
      limits: { fileSize: DESIGN_IMAGE_MAX_BYTES, files: 1 },
      // Leaves `truncated` for the check below, which names this route's limit.
      throwFileSizeLimit: false,
    });
    if (!file)
      throw badRequest(
        'FILE_REQUIRED',
        'No image was received. Please choose an image and try again.',
      );
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'This image is too big. Please choose an image smaller than 3 MB.',
      );
    }
    return this.designs.uploadImage(buffer);
  }

  @Get(':id')
  @Can('content.read')
  @ApiOperation({ summary: 'One design, with readability warnings' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminDesignView> {
    return this.designs.get(id);
  }

  @Post()
  @Can('content.write')
  @ApiOperation({
    summary:
      'Create a design from colours, or colours + uploaded art (409 DESIGN_EXISTS if the key is taken)',
  })
  create(
    @Body() dto: CreateStoryDesignDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminDesignView> {
    return this.designs.create(dto, admin.email);
  }

  @Patch(':id')
  @Can('content.write')
  @ApiOperation({
    summary:
      'Recolour, change or remove the art, retarget, reorder, schedule or (de)activate a design',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryDesignDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminDesignView> {
    return this.designs.update(id, dto, admin.email);
  }

  @Delete(':id')
  @Can('content.write')
  @ApiOperation({
    summary: 'Delete a design and its art; saved stories keep their image',
  })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<{ deleted: true }> {
    return this.designs.remove(id);
  }
}
