import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@common/decorators/public.decorator';

import type { AboutCompanyContent } from '../info-pages.domain';
import {
  InfoPagesService,
  type InfoPageView,
} from '../services/info-pages.service';
import { PUBLIC_READ } from './public-read';

/** Public on purpose: nothing here is about the caller. */
@ApiTags('app · About Katyayani')
@Controller('about-company')
export class AboutCompanyController {
  constructor(private readonly pages: InfoPagesService) {}

  @Public()
  @Throttle(PUBLIC_READ)
  @Get()
  @ApiOperation({ summary: 'About Katyayani page (404 until HO creates it)' })
  get(): Promise<InfoPageView<AboutCompanyContent>> {
    return this.pages.live('about_company');
  }
}
