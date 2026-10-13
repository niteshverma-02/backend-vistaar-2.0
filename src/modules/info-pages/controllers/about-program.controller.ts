import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@common/decorators/public.decorator';

import type { AboutProgramContent } from '../info-pages.domain';
import {
  InfoPagesService,
  type InfoPageView,
} from '../services/info-pages.service';
import { PUBLIC_READ } from './public-read';

/** Public on purpose: nothing here is about the caller. */
@ApiTags('app · About Vistaar')
@Controller('about-program')
export class AboutProgramController {
  constructor(private readonly pages: InfoPagesService) {}

  @Public()
  @Throttle(PUBLIC_READ)
  @Get()
  @ApiOperation({
    summary:
      'About Vistaar page (404 until HO creates it); cohort cards and commission slabs come from their own APIs',
  })
  get(): Promise<InfoPageView<AboutProgramContent>> {
    return this.pages.live('about_program');
  }
}
