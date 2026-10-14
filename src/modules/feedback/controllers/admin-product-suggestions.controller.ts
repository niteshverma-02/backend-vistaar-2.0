import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  SuggestionListQueryDto,
  TopProductsQueryDto,
  UpdateSuggestionDto,
} from '../dto/feedback.dto';
import type { SuggestionStatus } from '../feedback.domain';
import type { TopProduct } from '../repositories/product-suggestion.repository';
import {
  AdminFeedbackService,
  type AdminSuggestionView,
} from '../services/admin-feedback.service';

@ApiTags('admin · feedback')
@Controller('admin/product-suggestions')
export class AdminProductSuggestionsController {
  constructor(private readonly feedback: AdminFeedbackService) {}

  @Get()
  @Can('feedback.read')
  @ApiOperation({
    summary:
      'Products partners say farmers ask for, newest first; filter by status, partner, IST dates or words',
  })
  list(
    @Query() query: SuggestionListQueryDto,
  ): Promise<PageResult<AdminSuggestionView>> {
    return this.feedback.listSuggestions(query);
  }

  @Get('summary')
  @Can('feedback.read')
  @ApiOperation({ summary: 'How many in each status' })
  summary(): Promise<Record<SuggestionStatus, number>> {
    return this.feedback.suggestionCounts();
  }

  @Get('top')
  @Can('feedback.read')
  @ApiOperation({
    summary:
      'Most asked-for products over IST days (≤ 366): times asked, partners, crops',
  })
  top(@Query() query: TopProductsQueryDto): Promise<TopProduct[]> {
    return this.feedback.topProducts(query.from, query.to, query.limit);
  }

  @Get(':ref')
  @Can('feedback.read')
  @ApiOperation({ summary: 'One suggestion by its SUG- reference' })
  get(@Param('ref') ref: string): Promise<AdminSuggestionView> {
    return this.feedback.getSuggestion(ref);
  }

  @Patch(':ref')
  @Can('feedback.write')
  @ApiOperation({
    summary:
      'Move to reviewed / planned / declined, or add a note for the product team',
  })
  update(
    @Param('ref') ref: string,
    @Body() dto: UpdateSuggestionDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminSuggestionView> {
    return this.feedback.updateSuggestion(ref, dto, admin.email);
  }
}
