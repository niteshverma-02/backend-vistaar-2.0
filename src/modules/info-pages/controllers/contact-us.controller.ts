import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@common/decorators/public.decorator';

import {
  InfoPagesService,
  type ContactUsView,
} from '../services/info-pages.service';
import { PUBLIC_READ } from './public-read';

/**
 * Public on purpose: nothing here is about the caller, and the Need Help
 * dialog shows these numbers before a partner has a token.
 */
@ApiTags('app · Contact Us')
@Controller('contact-us')
export class ContactUsController {
  constructor(private readonly pages: InfoPagesService) {}

  @Public()
  @Throttle(PUBLIC_READ)
  @Get()
  @ApiOperation({
    summary:
      'Head Office contacts, hours with `open_now`, and ticket categories (404 until HO creates it)',
  })
  get(): Promise<ContactUsView> {
    return this.pages.contactUs();
  }
}
