import { Injectable } from '@nestjs/common';

import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import {
  addMonths,
  fyStart,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import { KeyedSerialQueue } from '@common/utils/keyed-serial-queue';
import { AgentsService } from '@modules/agents/services/agents.service';
import { CountersService } from '@modules/counters/services/counters.service';
import {
  OnboardingService,
  type PayoutFacts,
} from '@modules/onboarding/services/onboarding.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import { quarterMonths, tdsOf } from '../commission.domain';
import type {
  AdminTdsQueryDto,
  AdminWithdrawalQueryDto,
  CreateWithdrawalDto,
  LedgerQueryDto,
  PayBatchDto,
  PayWithdrawalDto,
  WithdrawalQueryDto,
} from '../dto/commission.dto';
import { TdsCertificateRepository } from '../repositories/tds-certificate.repository';
import {
  WithdrawalRepository,
  type StatusSum,
  type WithdrawalRecord,
} from '../repositories/withdrawal.repository';
import {
  OPEN_STATUSES,
  type WithdrawalStatus,
} from '../schemas/withdrawal.schema';
import {
  CommissionService,
  DEDUCTOR,
  TDS_SECTION,
  type CommissionSummary,
  type LedgerPage,
  type PartnerTerms,
} from './commission.service';

/** One bank file carries at most this many payouts. */
const PAYOUT_FILE_CAP = 500;

export interface WithdrawalView {
  id: string;
  amount: number;
  status: WithdrawalStatus;
  tds_rate: number;
  tds_amount: number;
  net_amount: number;
  account_last4: string | null;
  requested_at: Date;
  approved_at: Date | null;
  paid_at: Date | null;
  utr: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  cancelled_at: Date | null;
}

export interface AdminWithdrawalView extends WithdrawalView {
  agent_id: string;
  partner: { name: string | null; phone: string | null; cohort: string | null };
  approved_by: string | null;
  paid_by: string | null;
  rejected_by: string | null;
}

export type WalletBlock =
  'not_approved' | 'bank_not_verified' | 'withdrawal_open' | 'below_minimum';

export interface WalletView {
  withdrawable: number;
  /** Confirmed and paid commission, all time, with `gig_earned`. */
  earned: number;
  /** Approved meeting gigs' pay inside `earned` (0 while gig pay is off). */
  gig_earned: number;
  paid: number;
  /** Asked for, not yet paid. */
  on_hold: number;
  min_withdrawal: number;
  /** % TDS a withdrawal now would carry. */
  tds_rate: number;
  pan_verified: boolean;
  bank: {
    account_holder: string | null;
    account_last4: string | null;
    ifsc: string | null;
    verified: boolean;
  } | null;
  open_withdrawal: WithdrawalView | null;
  can_withdraw: boolean;
  /** Why not, when `can_withdraw` is false. */
  blocked_reason: WalletBlock | null;
}

export interface PayoutFile {
  file_name: string;
  content_type: 'text/csv';
  rows: number;
  total_net: number;
  content: string;
  /** Approved withdrawals left out of the file, and why. */
  skipped: { id: string; agent_id: string; reason: string }[];
}

export interface PayoutTotals {
  requested: { count: number; amount: number };
  approved: { count: number; amount: number; tds: number; net: number };
  paid_this_month: { count: number; amount: number; tds: number; net: number };
  paid_this_fy: { count: number; amount: number; tds: number; net: number };
}

export interface TdsListingRow {
  agent_id: string;
  name: string | null;
  pan_number: string | null;
  payouts: number;
  gross: number;
  tds: number;
  net: number;
  form16a: { uploaded_at: Date; url: string | null } | null;
}

export interface CertificateView {
  agent_id: string;
  quarter: string;
  url: string | null;
  uploaded_by: string;
  uploaded_at: Date;
}

const last4 = (n: string | null | undefined) => (n ? n.slice(-4) : null);

/**
 * The wallet: a partner asks to be paid their confirmed commission; HO
 * approves it, pays it from the bank file and enters the UTR (user,
 * 2026-10-14 — no payout API). TDS is 2% with a verified PAN, else 20%
 * (settings), fixed at approval. One open withdrawal per partner.
 */
@Injectable()
export class WalletService {
  /** Requests from one partner run one at a time in this process. */
  private readonly queue = new KeyedSerialQueue();

  constructor(
    private readonly withdrawals: WithdrawalRepository,
    private readonly certificates: TdsCertificateRepository,
    private readonly commission: CommissionService,
    private readonly onboarding: OnboardingService,
    private readonly agents: AgentsService,
    private readonly counters: CountersService,
    private readonly storage: StorageService,
  ) {}

  // ── the partner ──────────────────────────────────────────────────────

  async wallet(agentId: string): Promise<WalletView> {
    // The KYC facts need only the partner (cached), so they load beside the book.
    const [{ partner, book, settings, withdrawals }, facts] = await Promise.all(
      [
        this.commission.bookOf(agentId, new Date(), true),
        this.commission.partner(agentId).then((p) => this.payoutFactsOf(p)),
      ],
    );
    const open = withdrawals.find((w) => OPEN_STATUSES.includes(w.status));
    const blocked: WalletBlock | null =
      partner.stage !== 'approved' || !partner.is_active
        ? 'not_approved'
        : !facts?.bank_verified
          ? 'bank_not_verified'
          : open
            ? 'withdrawal_open'
            : book.withdrawable < settings.min_withdrawal
              ? 'below_minimum'
              : null;
    return {
      withdrawable: book.withdrawable,
      earned: book.earned,
      gig_earned: book.gig_earned,
      paid: book.paid,
      on_hold: book.open,
      min_withdrawal: settings.min_withdrawal,
      tds_rate: facts?.pan_verified
        ? settings.tds_rate_with_pan
        : settings.tds_rate_without_pan,
      pan_verified: facts?.pan_verified ?? false,
      bank: facts?.bank_account
        ? {
            account_holder: facts.bank_account.account_holder,
            account_last4: last4(facts.bank_account.account_number),
            ifsc: facts.bank_account.ifsc,
            verified: facts.bank_verified,
          }
        : null,
      open_withdrawal: open ? viewOf(open) : null,
      can_withdraw: blocked === null,
      blocked_reason: blocked,
    };
  }

  /** Ask for `amount` of the confirmed balance; HO approves and pays it. */
  request(agentId: string, dto: CreateWithdrawalDto): Promise<WithdrawalView> {
    const id = agentId.toUpperCase();
    return this.queue.run(id, async () => {
      const { partner, book, settings } = await this.commission.bookOf(
        id,
        new Date(),
        true,
      );
      if (partner.stage !== 'approved' || !partner.is_active) {
        throw forbidden(
          'PARTNER_NOT_APPROVED',
          'Your account is not active for payouts. Please contact Katyayani support.',
        );
      }
      if (dto.amount < settings.min_withdrawal) {
        throw badRequest(
          'BELOW_MIN_WITHDRAWAL',
          `You can withdraw ₹${settings.min_withdrawal} or more at a time.`,
        );
      }
      if (book.open > 0) throw stillOpen();
      if (dto.amount > book.withdrawable) {
        throw conflict(
          'NOT_ENOUGH_BALANCE',
          `You can withdraw up to ₹${book.withdrawable} right now.`,
        );
      }
      const facts = await this.payoutFactsOf(partner);
      if (!facts?.bank_verified) throw bankNotVerified();

      const rate = facts.pan_verified
        ? settings.tds_rate_with_pan
        : settings.tds_rate_without_pan;
      const { tds, net } = tdsOf(dto.amount, rate);
      const now = new Date();
      const row: Omit<WithdrawalRecord, 'created_at' | 'updated_at'> = {
        _id: await this.counters.nextWithdrawalId(),
        agent_id: id,
        amount: dto.amount,
        status: 'requested',
        open: true,
        tds_rate: rate,
        tds_amount: tds,
        net_amount: net,
        account_last4: last4(facts.bank_account?.account_number),
        requested_at: now,
        approved_at: null,
        approved_by: null,
        paid_at: null,
        paid_by: null,
        utr: null,
        rejected_at: null,
        rejected_by: null,
        rejection_reason: null,
        cancelled_at: null,
      };
      if (!(await this.withdrawals.insert(row))) throw stillOpen();
      this.commission.forgetWithdrawals(id);
      return viewOf({ ...row, created_at: now, updated_at: now });
    });
  }

  async mine(
    agentId: string,
    query: WithdrawalQueryDto,
  ): Promise<PageResult<WithdrawalView>> {
    const rows = (
      await this.withdrawals.forAgent(agentId.toUpperCase())
    ).filter((w) => !query.status || w.status === query.status);
    return new PageResult(
      rows.slice(query.skip, query.skip + query.limit).map(viewOf),
      rows.length,
      query,
    );
  }

  async mineOne(agentId: string, id: string): Promise<WithdrawalView> {
    const w = await this.withdrawals.findById(id);
    if (!w || w.agent_id !== agentId.toUpperCase())
      throw notFound('This withdrawal could not be found.');
    return viewOf(w);
  }

  /** Only while HO has not approved it: an approved one may already be in a bank file. */
  async cancel(agentId: string, id: string): Promise<WithdrawalView> {
    const done = await this.withdrawals.transition(
      id,
      ['requested'],
      'cancelled',
      { cancelled_at: new Date() },
      agentId.toUpperCase(),
    );
    if (done) return viewOf(this.moved(done));
    await this.mineOne(agentId, id);
    throw conflict(
      'WITHDRAWAL_CHANGED',
      'This withdrawal is already approved or closed, so it cannot be cancelled.',
    );
  }

  // ── HO ───────────────────────────────────────────────────────────────

  async list(
    query: AdminWithdrawalQueryDto,
  ): Promise<PageResult<AdminWithdrawalView>> {
    const { items, total } = await this.withdrawals.list(
      {
        statuses: query.status ? [query.status] : undefined,
        agentId: query.agent_id,
      },
      query,
      // Queues oldest first (who has waited longest); history newest first.
      query.status && OPEN_STATUSES.includes(query.status)
        ? { requested_at: 1 }
        : { requested_at: -1 },
    );
    return new PageResult(await this.adminViews(items), total, query);
  }

  async get(id: string): Promise<AdminWithdrawalView> {
    return this.viewOf(await this.require(id));
  }

  /** A row just written is already in hand: no second read of it. */
  private async viewOf(w: WithdrawalRecord): Promise<AdminWithdrawalView> {
    const [view] = await this.adminViews([w]);
    return view;
  }

  /**
   * Checks again what the request checked — the balance may have moved, the
   * bank proof may have been re-reviewed — and fixes the TDS rate.
   */
  async approve(id: string, by: string): Promise<AdminWithdrawalView> {
    const w = await this.require(id);
    if (w.status !== 'requested') throw notInStatus('approved', w.status);
    const { partner, book, settings } = await this.commission.bookOf(
      w.agent_id,
      new Date(),
      true,
    );
    const facts = await this.payoutFactsOf(partner);
    if (!facts?.bank_verified) throw bankNotVerified();
    // This request is open, so it is held out of the balance already.
    const available = book.earned - book.paid - (book.open - w.amount);
    if (w.amount > available) {
      throw conflict(
        'NOT_ENOUGH_BALANCE',
        `The partner's confirmed balance is now ₹${Math.max(0, available)}. Reject this request so they can ask again.`,
      );
    }
    const rate = facts.pan_verified
      ? settings.tds_rate_with_pan
      : settings.tds_rate_without_pan;
    const { tds, net } = tdsOf(w.amount, rate);
    const done = await this.withdrawals.transition(
      id,
      ['requested'],
      'approved',
      {
        approved_at: new Date(),
        approved_by: by,
        tds_rate: rate,
        tds_amount: tds,
        net_amount: net,
        account_last4: last4(facts.bank_account?.account_number),
      },
    );
    if (!done) throw changed();
    this.moved(done);
    return this.viewOf(done);
  }

  async reject(
    id: string,
    reason: string,
    by: string,
  ): Promise<AdminWithdrawalView> {
    const done = await this.withdrawals.transition(
      id,
      OPEN_STATUSES,
      'rejected',
      { rejected_at: new Date(), rejected_by: by, rejection_reason: reason },
    );
    if (!done) {
      const w = await this.require(id);
      throw notInStatus('rejected', w.status);
    }
    this.moved(done);
    return this.viewOf(done);
  }

  async pay(
    id: string,
    dto: PayWithdrawalDto,
    by: string,
  ): Promise<AdminWithdrawalView> {
    const paidAt = paidAtOf(dto.paid_at);
    const done = await this.withdrawals.transition(id, ['approved'], 'paid', {
      paid_at: paidAt,
      paid_by: by,
      utr: dto.utr,
    });
    if (!done) {
      const w = await this.require(id);
      throw notInStatus('paid', w.status);
    }
    this.moved(done);
    return this.viewOf(done);
  }

  /** The bank file's results, one UTR each; each line succeeds or fails on its own. */
  async payBatch(
    dto: PayBatchDto,
    by: string,
  ): Promise<{
    paid: number;
    results: { id: string; ok: boolean; error: string | null }[];
  }> {
    const paidAt = paidAtOf(dto.paid_at);
    // Each line is its own conditional update; they go out together.
    const results = await Promise.all(
      dto.items.map(async (item) => {
        const done = await this.withdrawals.transition(
          item.id,
          ['approved'],
          'paid',
          { paid_at: paidAt, paid_by: by, utr: item.utr },
        );
        if (done) this.moved(done);
        return done
          ? { id: item.id, ok: true, error: null }
          : {
              id: item.id,
              ok: false,
              error:
                'Not an approved withdrawal (already paid, rejected, or unknown).',
            };
      }),
    );
    return { paid: results.filter((r) => r.ok).length, results };
  }

  /** Approved withdrawals as a bank upload file (generic CSV; account numbers in full). */
  async payoutFile(): Promise<PayoutFile> {
    const rows = await this.withdrawals.all(
      { statuses: ['approved'] },
      PAYOUT_FILE_CAP,
    );
    const partners = await this.partnersOf(rows.map((w) => w.agent_id));
    const facts = await this.onboarding.payoutFacts(
      [...partners.values()].map((p) => p.agent_ref),
    );
    const skipped: PayoutFile['skipped'] = [];
    const lines = [
      [
        'withdrawal_id',
        'agent_id',
        'partner_name',
        'account_holder',
        'account_number',
        'ifsc',
        'amount',
        'tds',
        'net_amount',
        'requested_at',
      ].join(','),
    ];
    let totalNet = 0;
    for (const w of rows) {
      const p = partners.get(w.agent_id);
      const bank = p ? facts.get(p.agent_ref)?.bank_account : null;
      if (!bank?.account_number || !bank.ifsc) {
        skipped.push({
          id: w._id,
          agent_id: w.agent_id,
          reason: 'No bank account number or IFSC on the partner’s form.',
        });
        continue;
      }
      totalNet += w.net_amount;
      lines.push(
        [
          w._id,
          w.agent_id,
          p?.name ?? '',
          bank.account_holder ?? '',
          bank.account_number,
          bank.ifsc,
          w.amount.toFixed(2),
          w.tds_amount.toFixed(2),
          w.net_amount.toFixed(2),
          w.requested_at.toISOString(),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return {
      file_name: `vistaar-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
      content_type: 'text/csv',
      rows: lines.length - 1,
      total_net: Math.round(totalNet * 100) / 100,
      content: lines.join('\n') + '\n',
      skipped,
    };
  }

  /** HO's payout cards: what is waiting, and what went out this month and this FY. */
  async totals(): Promise<PayoutTotals> {
    const now = new Date();
    const month = istMonthKey(now);
    const fy = fyStart(month);
    const [open, thisMonth, thisFy] = await Promise.all([
      this.withdrawals.sums({ statuses: OPEN_STATUSES }),
      this.withdrawals.sums({
        statuses: ['paid'],
        paidFrom: istMonthStart(month),
      }),
      this.withdrawals.sums({
        statuses: ['paid'],
        paidFrom: istMonthStart(fy),
      }),
    ]);
    const of = (sums: StatusSum[], status: WithdrawalStatus) => {
      const s = sums.find((x) => x.status === status);
      return {
        count: s?.count ?? 0,
        amount: s?.amount ?? 0,
        tds: Math.round((s?.tds ?? 0) * 100) / 100,
        net: Math.round((s?.net ?? 0) * 100) / 100,
      };
    };
    const requested = of(open, 'requested');
    return {
      requested: { count: requested.count, amount: requested.amount },
      approved: of(open, 'approved'),
      paid_this_month: of(thisMonth, 'paid'),
      paid_this_fy: of(thisFy, 'paid'),
    };
  }

  /** One partner's commission and wallet, as HO looks into them. */
  async partnerCommission(
    agentId: string,
    query: LedgerQueryDto,
  ): Promise<{
    partner: Pick<PartnerTerms, 'agent_id' | 'name' | 'cohort' | 'stage'>;
    summary: CommissionSummary;
    wallet: WalletView;
    ledger: LedgerPage;
  }> {
    const partner = await this.commission.partner(agentId);
    const [summary, wallet, ledger] = await Promise.all([
      this.commission.summary(partner.agent_id),
      this.wallet(partner.agent_id),
      this.commission.ledger(partner.agent_id, query),
    ]);
    return {
      partner: {
        agent_id: partner.agent_id,
        name: partner.name,
        cohort: partner.cohort,
        stage: partner.stage,
      },
      summary,
      wallet,
      ledger,
    };
  }

  /** TDS deducted per partner in a quarter, with PAN and Form 16A — for the TDS return. */
  async tdsListing(query: AdminTdsQueryDto): Promise<
    PageResult<TdsListingRow> & {
      quarter: string;
      deductor: string;
      section: string;
    }
  > {
    const months = quarterMonths(query.quarter);
    const { items, total } = await this.withdrawals.paidByAgent(
      {
        agentId: query.agent_id,
        paidFrom: istMonthStart(months[0]),
        paidTo: istMonthStart(addMonths(months[2], 1)),
      },
      query,
    );
    const ids = items.map((i) => i.agent_id);
    const [partners, certificates] = await Promise.all([
      this.partnersOf(ids),
      this.certificates.forAgents(query.quarter, ids),
    ]);
    const facts = await this.onboarding.payoutFacts(
      [...partners.values()].map((p) => p.agent_ref),
    );
    const files = await this.storage.sign(certificates.map((c) => c.path));
    const byAgent = new Map(certificates.map((c) => [c.agent_id, c]));
    const rows = items.map((i) => {
      const p = partners.get(i.agent_id);
      const c = byAgent.get(i.agent_id);
      return {
        agent_id: i.agent_id,
        name: p?.name ?? null,
        pan_number: p ? (facts.get(p.agent_ref)?.pan_number ?? null) : null,
        payouts: i.count,
        gross: i.amount,
        tds: Math.round(i.tds * 100) / 100,
        net: Math.round(i.net * 100) / 100,
        form16a: c
          ? { uploaded_at: c.updated_at, url: files.get(c.path) ?? null }
          : null,
      };
    });
    return Object.assign(new PageResult(rows, total, query), {
      quarter: query.quarter,
      deductor: DEDUCTOR,
      section: TDS_SECTION,
    });
  }

  /** Puts (or replaces) a partner's Form 16A for the quarter. */
  async putCertificate(
    agentId: string,
    quarter: string,
    file: Buffer,
    by: string,
  ): Promise<CertificateView> {
    const partner = await this.commission.partner(agentId);
    const folder = `KO-documents/${partner.pii_id ?? partner.agent_id}/form16a`;
    const path = await this.storage.savePrivate(
      folder,
      file,
      'application/pdf',
      { agent_id: partner.agent_id, quarter },
      `${quarter}-${Date.now()}`,
    );
    const replaced = await this.certificates.put(
      partner.agent_id,
      quarter,
      path,
      by,
    );
    if (replaced && replaced !== path) await this.storage.remove(replaced);
    return {
      agent_id: partner.agent_id,
      quarter,
      url: (await this.storage.sign([path])).get(path) ?? null,
      uploaded_by: by,
      uploaded_at: new Date(),
    };
  }

  async listCertificates(
    query: AdminTdsQueryDto,
  ): Promise<PageResult<CertificateView>> {
    const { items, total } = await this.certificates.list(
      query.quarter,
      query.agent_id ?? null,
      query,
    );
    const urls = await this.storage.sign(items.map((c) => c.path));
    return new PageResult(
      items.map((c) => ({
        agent_id: c.agent_id,
        quarter: c.quarter,
        url: urls.get(c.path) ?? null,
        uploaded_by: c.uploaded_by,
        uploaded_at: c.updated_at,
      })),
      total,
      query,
    );
  }

  async removeCertificate(
    agentId: string,
    quarter: string,
  ): Promise<{ deleted: true }> {
    const gone = await this.certificates.remove(agentId.toUpperCase(), quarter);
    if (!gone) throw notFound('There is no Form 16A for this quarter.');
    await this.storage.remove(gone.path);
    return { deleted: true };
  }

  // ── internals ────────────────────────────────────────────────────────

  /** A withdrawal moved: the partner's screens on this server show it at once. */
  private moved(w: WithdrawalRecord): WithdrawalRecord {
    this.commission.forgetWithdrawals(w.agent_id);
    return w;
  }

  private async require(id: string): Promise<WithdrawalRecord> {
    const w = await this.withdrawals.findById(id);
    if (!w) throw notFound('This withdrawal could not be found.');
    return w;
  }

  private async payoutFactsOf(
    partner: PartnerTerms,
  ): Promise<PayoutFacts | undefined> {
    return (await this.onboarding.payoutFacts([partner.agent_ref])).get(
      partner.agent_ref,
    );
  }

  /** `VST-` id → the partner's form key and name, in one read. */
  private async partnersOf(agentIds: readonly string[]): Promise<
    Map<
      string,
      {
        agent_ref: string;
        name: string | null;
        phone: string | null;
        cohort: string | null;
      }
    >
  > {
    const ids = [...new Set(agentIds)];
    if (ids.length === 0) return new Map();
    const { items } = await this.agents.list(
      { agent_ids: ids },
      { skip: 0, limit: ids.length, sort: { agent_id: 1 } },
    );
    return new Map(
      items.map((a) => [
        a.agent_id ?? '',
        {
          agent_ref: a._id,
          name: a.profile?.name ?? a.preview?.name ?? null,
          phone: a.phone ?? null,
          cohort: a.cohort ?? null,
        },
      ]),
    );
  }

  private async adminViews(
    rows: WithdrawalRecord[],
  ): Promise<AdminWithdrawalView[]> {
    const partners = await this.partnersOf(rows.map((w) => w.agent_id));
    return rows.map((w) => {
      const p = partners.get(w.agent_id);
      return {
        ...viewOf(w),
        agent_id: w.agent_id,
        partner: {
          name: p?.name ?? null,
          phone: p?.phone ?? null,
          cohort: p?.cohort ?? null,
        },
        approved_by: w.approved_by,
        paid_by: w.paid_by,
        rejected_by: w.rejected_by,
      };
    });
  }
}

function viewOf(w: WithdrawalRecord): WithdrawalView {
  return {
    id: w._id,
    amount: w.amount,
    status: w.status,
    tds_rate: w.tds_rate,
    tds_amount: w.tds_amount,
    net_amount: w.net_amount,
    account_last4: w.account_last4 ?? null,
    requested_at: w.requested_at,
    approved_at: w.approved_at ?? null,
    paid_at: w.paid_at ?? null,
    utr: w.utr ?? null,
    rejected_at: w.rejected_at ?? null,
    rejection_reason: w.rejection_reason ?? null,
    cancelled_at: w.cancelled_at ?? null,
  };
}

/** A cell a spreadsheet will not run as a formula, quoted when it must be. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function paidAtOf(value: string | undefined): Date {
  const now = new Date();
  if (!value) return now;
  const at = new Date(value);
  if (at.getTime() > now.getTime() + 5 * 60_000) {
    throw badRequest(
      'VALIDATION_FAILED',
      'The payment date cannot be in the future.',
    );
  }
  return at;
}

function stillOpen() {
  return conflict(
    'WITHDRAWAL_OPEN',
    'You already have a withdrawal in progress. Please wait for it to be paid, or cancel it first.',
  );
}

function bankNotVerified() {
  return conflict(
    'BANK_NOT_VERIFIED',
    'Your bank account is not verified yet. Please contact Katyayani support.',
  );
}

function changed() {
  return conflict(
    'WITHDRAWAL_CHANGED',
    'This withdrawal was just changed by someone else. Please reload it.',
  );
}

const ACTION_FROM: Record<string, string> = {
  approved: 'requested',
  rejected: 'requested or approved',
  paid: 'approved',
};

function notInStatus(action: string, status: WithdrawalStatus) {
  return conflict(
    'WITHDRAWAL_CHANGED',
    `Only a ${ACTION_FROM[action]} withdrawal can be ${action}; this one is ${status}.`,
  );
}
