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
import { badRequest } from '@common/errors/api-error';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import { CROP_KEY } from '../crop-calendar.domain';
import {
  CreateCropDto,
  CropListQueryDto,
  UpdateCropDto,
} from '../dto/crop-calendar.dto';
import type { CropCalendarEntry } from '../schemas/crop-calendar.schema';
import { CropCalendarService } from '../services/crop-calendar.service';

function checkKey(key: string): string {
  if (!CROP_KEY.test(key)) {
    throw badRequest(
      'VALIDATION_FAILED',
      'This crop could not be found. Please open it again from the list.',
    );
  }
  return key;
}

/** HO's crop calendar; the app sees an edit within a minute. */
@ApiTags('admin · crop calendar')
@Controller('admin/crop-calendar')
export class AdminCropCalendarController {
  constructor(private readonly crops: CropCalendarService) {}

  @Get()
  @Can('content.read')
  @ApiOperation({ summary: 'Every crop, inactive ones included' })
  list(
    @Query() query: CropListQueryDto,
  ): Promise<PageResult<CropCalendarEntry>> {
    return this.crops.list(query);
  }

  @Get(':key')
  @Can('content.read')
  @ApiOperation({ summary: 'One crop' })
  get(@Param('key') key: string): Promise<CropCalendarEntry> {
    return this.crops.get(checkKey(key));
  }

  @Post()
  @Can('content.write')
  @ApiOperation({ summary: 'Add a crop (409 CROP_EXISTS if the key is taken)' })
  create(
    @Body() dto: CreateCropDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CropCalendarEntry> {
    return this.crops.create(dto, admin.email);
  }

  @Patch(':key')
  @Can('content.write')
  @ApiOperation({ summary: 'Edit a crop, its stages, order or switch it off' })
  update(
    @Param('key') key: string,
    @Body() dto: UpdateCropDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CropCalendarEntry> {
    return this.crops.update(checkKey(key), dto, admin.email);
  }

  @Delete(':key')
  @Can('content.write')
  @ApiOperation({ summary: 'Delete a crop for good' })
  remove(@Param('key') key: string): Promise<{ deleted: true }> {
    return this.crops.remove(checkKey(key));
  }
}
