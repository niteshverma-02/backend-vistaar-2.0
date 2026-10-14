import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { CurrentPartnerId } from '@common/auth/current-partner.decorator';
import { apiError, badRequest } from '@common/errors/api-error';

import {
  SaveStoryDto,
  ShareStoryDto,
  StoryImageQueryDto,
  UploadedStoryImageDto,
} from '../dto/story.dto';
import {
  StoriesService,
  type StoryContentView,
  type StoryView,
} from '../services/stories.service';
import { STORY_IMAGE_MAX_BYTES } from '../stories.domain';

/** A partner makes a few stories a day; this only stops a looping client. */
const WRITE_LIMIT = { default: { limit: 30, ttl: 60_000 } };

/** The partner's own My Story. Nothing in a path or body says whose. */
@ApiTags('app · stories')
@ApiBearerAuth()
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get('content')
  @ApiOperation({
    summary:
      'What the templates pre-fill from: festivals, farmer stories and upcoming events for my cohort',
  })
  content(@CurrentPartnerId() agentId: string): Promise<StoryContentView> {
    return this.stories.contentFor(agentId);
  }

  @Post('images')
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Upload the finished status image (`kind=render`, 9:16, ≤ 3 MB) or the partner photo (`kind=photo`, ≤ 5 MB). Multipart `file`; JPG/PNG/WEBP.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadedStoryImageDto })
  async uploadImage(
    @CurrentPartnerId() agentId: string,
    @Query() query: StoryImageQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<UploadedStoryImageDto> {
    if (!req.isMultipart()) {
      throw badRequest('FILE_REQUIRED', 'Please choose an image to upload.');
    }
    const max = STORY_IMAGE_MAX_BYTES[query.kind];
    const file = await req.file({
      limits: { fileSize: max, files: 1 },
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
        `This image is too big. Please choose an image smaller than ${max / (1024 * 1024)} MB.`,
      );
    }
    return this.stories.uploadImage(agentId, query.kind, buffer);
  }

  @Get()
  @ApiOperation({ summary: 'My saved stories, newest first (at most 20)' })
  list(@CurrentPartnerId() agentId: string): Promise<StoryView[]> {
    return this.stories.list(agentId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One saved story, to edit or share again' })
  get(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StoryView> {
    return this.stories.get(agentId, id);
  }

  @Post()
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary:
      'Save the story just made (the same story again moves to the top). With `channel`, also counts the share.',
  })
  save(
    @CurrentPartnerId() agentId: string,
    @Body() dto: SaveStoryDto,
  ): Promise<StoryView> {
    return this.stories.save(agentId, dto);
  }

  @Post(':id/share')
  @HttpCode(HttpStatus.OK)
  @Throttle(WRITE_LIMIT)
  @ApiOperation({
    summary: 'Count a re-share of a saved story; it moves to the top',
  })
  share(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ShareStoryDto,
  ): Promise<StoryView> {
    return this.stories.share(agentId, id, dto.channel);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved story and its images' })
  remove(
    @CurrentPartnerId() agentId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ deleted: true }> {
    return this.stories.remove(agentId, id);
  }
}
