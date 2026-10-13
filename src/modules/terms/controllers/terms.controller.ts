import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Public } from '@common/decorators/public.decorator';

import { TermsService, type TermsView } from '../services/terms.service';

/**
 * Per IP: phones on one mobile tower share a carrier address (CGNAT), and
 * this read is cached and cheap — so the limit is generous.
 */
const PUBLIC_READ = { default: { limit: 600, ttl: 60_000 } };

/** Public: the login screen links to it before anyone has a token. */
@ApiTags('app · terms and conditions')
@Controller('terms-and-conditions')
export class TermsController {
  constructor(private readonly terms: TermsService) {}

  @Public()
  @Throttle(PUBLIC_READ)
  @Get()
  @ApiOperation({
    summary:
      'The Vistaar partner T&C partners see now: title and document link (404 until HO adds one)',
  })
  live(): Promise<TermsView> {
    return this.terms.live();
  }
}
