import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { FaqsService, type LiveFaqs } from '../services/faqs.service';

@ApiTags('app · faqs')
@ApiBearerAuth()
@Controller('faqs')
export class FaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Live sections and their FAQs, in display order; the app filters and searches them',
  })
  list(): Promise<LiveFaqs> {
    return this.faqs.live();
  }
}
