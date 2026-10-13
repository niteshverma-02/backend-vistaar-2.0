import { Controller, HttpStatus, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { CurrentPartner } from '@common/decorators/current-principal.decorator';
import { apiError, badRequest } from '@common/errors/api-error';
import type { PartnerPrincipal } from '@common/interfaces/principal.interface';

import { UploadedDto, UploadQueryDto } from '../dto/upload.dto';
import {
  ALLOWED_MIME,
  MAX_UPLOAD_BYTES,
  StorageService,
} from '../services/storage.service';

@ApiTags('app · uploads')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @ApiOperation({
    summary:
      'Upload one KYC/onboarding file (multipart `file`). Returns the `path` to put in the form value.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOkResponse({ type: UploadedDto })
  async upload(
    @CurrentPartner() partner: PartnerPrincipal,
    @Query() query: UploadQueryDto,
    @Req() req: FastifyRequest,
  ): Promise<UploadedDto> {
    if (!this.storage.configured) {
      throw apiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'UPLOADS_NOT_CONFIGURED',
        'Uploading files is not working right now. Please try again later.',
      );
    }
    if (!req.isMultipart())
      throw badRequest(
        'FILE_REQUIRED',
        'Please choose a photo or PDF to upload.',
      );

    const file = await req.file({
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      // Leaves `truncated` for the check below, which names this route's limit.
      throwFileSizeLimit: false,
    });
    if (!file)
      throw badRequest(
        'FILE_REQUIRED',
        'Please choose a photo or PDF to upload.',
      );
    if (!ALLOWED_MIME.test(file.mimetype)) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        'This file type is not allowed. Please upload a photo (JPG, PNG, WEBP, HEIC) or a PDF.',
      );
    }

    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'This file is too big. Please upload a file smaller than 10 MB.',
      );
    }

    const path = await this.storage.save(
      partner.pii_id,
      query.purpose,
      buffer,
      file.mimetype,
    );
    const url = (await this.storage.sign([path])).get(path) ?? null;
    return { path, url, content_type: file.mimetype, size: buffer.length };
  }
}
