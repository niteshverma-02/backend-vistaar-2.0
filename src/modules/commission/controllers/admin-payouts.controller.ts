import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { CurrentAdmin } from '@common/decorators/current-principal.decorator';
import { apiError, badRequest } from '@common/errors/api-error';
import type { PageResult } from '@common/http/page-result';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { Can } from '@modules/access/guards/capability.guard';

import {
  AdminTdsQueryDto,
  AdminWithdrawalQueryDto,
  AgentParamDto,
  CertificateParamDto,
  LedgerQueryDto,
  PayBatchDto,
  PayWithdrawalDto,
  RejectWithdrawalDto,
  WithdrawalParamDto,
} from '../dto/commission.dto';
import {
  WalletService,
  type AdminWithdrawalView,
  type CertificateView,
  type PayoutFile,
  type PayoutTotals,
  type TdsListingRow,
} from '../services/wallet.service';

const FORM16A_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Payouts: approve, reject and pay partners' withdrawals (heads until
 * Finance has a role code — `payouts.manage`), the bank file, TDS and Form
 * 16A. HO never creates a withdrawal (the partner asks) and never deletes one
 * (it is the payment record).
 */
@ApiTags('admin · payouts')
@Controller('admin')
export class AdminPayoutsController {
  constructor(private readonly wallet: WalletService) {}

  @Get('withdrawals')
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Withdrawals; a queue (requested / approved) oldest first, otherwise newest first',
  })
  list(
    @Query() query: AdminWithdrawalQueryDto,
  ): Promise<PageResult<AdminWithdrawalView>> {
    return this.wallet.list(query);
  }

  @Get('withdrawals/totals')
  @Can('commission.read')
  @ApiOperation({
    summary:
      'Payout cards: requested, approved (to pay), paid this month and this financial year',
  })
  totals(): Promise<PayoutTotals> {
    return this.wallet.totals();
  }

  @Get('withdrawals/payout-file')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      'Approved withdrawals as a bank upload CSV (full account numbers) — `content` is the file',
  })
  payoutFile(): Promise<PayoutFile> {
    return this.wallet.payoutFile();
  }

  @Post('withdrawals/paid')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      'Mark many approved withdrawals paid, one UTR each (the bank file’s results)',
  })
  payBatch(
    @Body() dto: PayBatchDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<{
    paid: number;
    results: { id: string; ok: boolean; error: string | null }[];
  }> {
    return this.wallet.payBatch(dto, admin.email);
  }

  @Get('withdrawals/:id')
  @Can('commission.read')
  @ApiOperation({ summary: 'One withdrawal, with the partner' })
  get(@Param() { id }: WithdrawalParamDto): Promise<AdminWithdrawalView> {
    return this.wallet.get(id);
  }

  @Post('withdrawals/:id/approve')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      'Approve a requested withdrawal — balance and bank proof checked again, TDS rate fixed',
  })
  approve(
    @Param() { id }: WithdrawalParamDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminWithdrawalView> {
    return this.wallet.approve(id, admin.email);
  }

  @Post('withdrawals/:id/reject')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      'Reject a requested or approved withdrawal; the amount goes back to the partner’s balance',
  })
  reject(
    @Param() { id }: WithdrawalParamDto,
    @Body() dto: RejectWithdrawalDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminWithdrawalView> {
    return this.wallet.reject(id, dto.reason, admin.email);
  }

  @Post('withdrawals/:id/paid')
  @Can('payouts.manage')
  @ApiOperation({ summary: 'Mark an approved withdrawal paid, with its UTR' })
  pay(
    @Param() { id }: WithdrawalParamDto,
    @Body() dto: PayWithdrawalDto,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<AdminWithdrawalView> {
    return this.wallet.pay(id, dto, admin.email);
  }

  @Get('commission/partners/:agentId')
  @Can('commission.read')
  @ApiOperation({
    summary:
      "One partner's commission: summary, wallet and ledger (same numbers the app shows)",
  })
  partner(
    @Param() { agentId }: AgentParamDto,
    @Query() query: LedgerQueryDto,
  ): Promise<Awaited<ReturnType<WalletService['partnerCommission']>>> {
    return this.wallet.partnerCommission(agentId, query);
  }

  @Get('tds')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      'TDS deducted per partner in a quarter, with PAN and Form 16A — for the TDS return',
  })
  tds(@Query() query: AdminTdsQueryDto): Promise<
    PageResult<TdsListingRow> & {
      quarter: string;
      deductor: string;
      section: string;
    }
  > {
    return this.wallet.tdsListing(query);
  }

  @Get('tds/certificates')
  @Can('payouts.manage')
  @ApiOperation({ summary: "A quarter's uploaded Form 16As" })
  certificates(
    @Query() query: AdminTdsQueryDto,
  ): Promise<PageResult<CertificateView>> {
    return this.wallet.listCertificates(query);
  }

  @Put('tds/certificates/:agentId/:quarter')
  @Can('payouts.manage')
  @ApiOperation({
    summary:
      "Upload (or replace) a partner's Form 16A for a quarter — multipart `file`, PDF ≤ 5 MB",
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  async putCertificate(
    @Param() { agentId, quarter }: CertificateParamDto,
    @Req() req: FastifyRequest,
    @CurrentAdmin() admin: AdminPrincipal,
  ): Promise<CertificateView> {
    if (!req.isMultipart())
      throw badRequest('FILE_REQUIRED', 'Please choose the Form 16A PDF.');
    const file = await req.file({
      limits: { fileSize: FORM16A_MAX_BYTES, files: 1 },
      // Leaves `truncated` for the check below, which names this route's limit.
      throwFileSizeLimit: false,
    });
    if (!file)
      throw badRequest('FILE_REQUIRED', 'Please choose the Form 16A PDF.');
    if (file.mimetype !== 'application/pdf') {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        'Form 16A must be a PDF, as TRACES issues it.',
      );
    }
    const buffer = await file.toBuffer();
    if (file.file.truncated) {
      throw apiError(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'FILE_TOO_LARGE',
        'This file is too big. Please upload a PDF smaller than 5 MB.',
      );
    }
    return this.wallet.putCertificate(agentId, quarter, buffer, admin.email);
  }

  @Delete('tds/certificates/:agentId/:quarter')
  @Can('payouts.manage')
  @ApiOperation({ summary: "Remove a partner's Form 16A for a quarter" })
  removeCertificate(
    @Param() { agentId, quarter }: CertificateParamDto,
  ): Promise<{ deleted: true }> {
    return this.wallet.removeCertificate(agentId, quarter);
  }
}
