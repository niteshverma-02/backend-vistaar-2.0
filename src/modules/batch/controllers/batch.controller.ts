import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { AdminApi } from '@common/decorators/admin-api.decorator';

import { BatchDto, type BatchResult } from '../dto/batch.dto';
import { BatchService } from '../services/batch.service';

/**
 * HO Home's many reads in one round trip. Any signed-in HO user: no
 * capability here, because each replayed read checks its own.
 */
@ApiTags('batch')
@Controller('batch')
export class BatchController {
  constructor(private readonly batch: BatchService) {}

  @Post()
  @AdminApi()
  @ApiBearerAuth()
  @HttpCode(200)
  // Each answer inside is one person's rows; nothing may keep the bundle.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Up to 25 GET paths under /api/v2, replayed in-process; data.responses[i] = { status, body } in request order',
  })
  run(
    @Req() request: FastifyRequest,
    @Body() body: BatchDto,
  ): Promise<BatchResult> {
    return this.batch.run(
      { headers: request.headers, ip: request.ip },
      body.requests.map((item) => item.path),
    );
  }
}
