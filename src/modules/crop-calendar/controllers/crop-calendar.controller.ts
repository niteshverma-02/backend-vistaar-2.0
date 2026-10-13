import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  CropCalendarService,
  type CropView,
} from '../services/crop-calendar.service';

@ApiTags('app · crop calendar')
@ApiBearerAuth()
@Controller('crop-calendar')
export class CropCalendarController {
  constructor(private readonly crops: CropCalendarService) {}

  @Get()
  @ApiOperation({
    summary: 'Active crops with stage-wise advice, in display order',
  })
  list(): Promise<CropView[]> {
    return this.crops.live();
  }
}
