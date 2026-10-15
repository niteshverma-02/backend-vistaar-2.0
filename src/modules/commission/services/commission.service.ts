import { Injectable } from '@nestjs/common';

import { PageResult } from '@common/http/page-result';
import { TtlCache } from '@common/utils/ttl-cache';
import {
  addMonths,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import { istDate } from '@modules/attendance/attendance.domain';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import { OnboardingService } from '@modules/onboarding/services/onboarding.service';
import {
  SettingsService,
  type SettingsRecord,
} from '@modules/settings/services/settings.service';
import { ProductFactsService } from '@modules/spine/services/product-facts.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import {
  buildBook,
  quarterMonths,
  UNKNOWN_GST_RATE,
  type Book,
  type CommissionStatus,
  type LedgerRow,
  type OrderFact,
  type Slab,
  type StatusTotals,
} from '../commission.domain';
import type { LedgerQueryDto } from '../dto/commission.dto';
import { CommissionOrderRepository } from '../repositories/commission-order.repository';
import { TdsCertificateRepository } from '../repositories/tds-certificate.repository';
import {
  WithdrawalRepository,
  type WithdrawalRecord,
} from '../repositories/withdrawal.repository';
import { OPEN_STATUSES } from '../schemas/withdrawal.schema';
import { CommissionPlansService } from './commission-plans.service';

/** Orders change at the warehouse a few times a day; a minute old is fresh enough. */
const FACTS_TTL_MS = 60_000;
/** ~300 KB for a partner with a thousand orders: bounded at a few hundred MB. */
const FACTS_MAX = 2_000;
const PARTNER_TTL_MS = 60_000;

export const TDS_SECTION = '194H';
export const DEDUCTOR = 'Katyayani Organics';

/** Who the book is for, as commission needs them. */
export interface PartnerTerms {
  agent_ref: string;
  agent_id: string;
  pii_id: string | null;
  name: string | null;
  cohort: string;
  stage: AgentRecord['stage'];
  is_active: boolean;
  /** The partner's own target, else the settings default. */
  monthly_target: number;
}

export interface PartnerBook {
  partner: PartnerTerms;
  book: Book;
  settings: SettingsRecord;
  /** The partner's withdrawals, newest first, as the book was built from. */
  withdrawals: WithdrawalRecord[];
}

/** What an order shows of its commission (`null` = it earns none). */
export interface OrderCommission {
  base: number;
  rate: number;
  amount: number;
  status: CommissionStatus;
  confirms_at: Date | null;
  confirmed_at: Date | null;
  paid_at: Date | null;
  withdrawal_id: string | null;
  reversed_reason: 'cancelled' | 'returned' | null;
}

export interface LedgerItem extends OrderCommission {
  id: string;
  order_id: string;
  customer_id: string | null;
  customer_name: string;
  order_value: number;
  order_status: string;
  paid_amount: number;
  created_at: Date;
  delivered_at: Date | null;
}

export type LedgerPage = PageResult<LedgerItem> & { totals: StatusTotals };

export interface CommissionSummary {
  month: string;
  month_delivered_sales: number;
  monthly_target: number;
  current_rate: number;
  next_slab: { rate: number; gap: number } | null;
  month_commission_estimate: number;
  totals: StatusTotals;
  earned: number;
  withdrawable: number;
  plan_draft: boolean;
}

export interface MyPlans {
  my_cohort: string;
  month: string;
  plans: {
    cohort: string;
    label: string;
    draft: boolean;
    effective_from: string | null;
    slabs: Slab[];
    notes: string[];
  }[];
  tds: { rate_with_pan: number; rate_without_pan: number; section: string };
  min_withdrawal: number;
  return_window_days: number;
}

export interface CommissionStatement {
  month: string;
  rows: {
    order_id: string;
    order_date: string;
    customer_name: string;
    order_value: number;
    order_status: string;
    rate: number;
    amount: number;
    status: CommissionStatus;
  }[];
  earned: number;
  pending: number;
  reversed: number;
  tds_rate: number;
  tds: number;
  net_payable: number;
}

export interface TdsReport {
  quarter: string;
  deductor: string;
  section: string;
  pan_number: string | null;
  months: {
    month: string;
    gross: number;
    tds_rate: number;
    tds: number;
    net: number;
  }[];
  total: { gross: number; tds: number; net: number };
  form16a_url: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The partner's commission, worked out from their orders on every read (see
 * `commission.domain.ts`). The orders are read once a minute per partner and
 * shared by every screen that asks in that minute; plans, settings and the
 * catalogue's GST rates are in memory; the partner's withdrawals (tens of
 * rows) are read once a minute for display, and fresh before money moves.
 */
@Injectable()
export class CommissionService {
  private readonly facts = new TtlCache<OrderFact[]>(FACTS_TTL_MS, FACTS_MAX);
  /**
   * A partner's withdrawals for the screens that only show money (orders,
   * summary, ledger, performance): a payout made on another server shows
   * within a minute. Anything that moves money reads them fresh.
   */
  private readonly withdrawalsOf = new TtlCache<WithdrawalRecord[]>(
    FACTS_TTL_MS,
    FACTS_MAX,
  );
  private readonly partners = new TtlCache<PartnerTerms>(
    PARTNER_TTL_MS,
    FACTS_MAX,
  );

  constructor(
    private readonly orders: CommissionOrderRepository,
    private readonly withdrawals: WithdrawalRepository,
    private readonly certificates: TdsCertificateRepository,
    private readonly plans: CommissionPlansService,
    private readonly settings: SettingsService,
    private readonly agents: AgentsService,
    private readonly onboarding: OnboardingService,
    private readonly products: ProductFactsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * The partner's whole book, as of `now`. `fresh` reads their withdrawals
   * now — for the wallet and for every check before money moves.
   */
  async bookOf(
    agentId: string,
    now = new Date(),
    fresh = false,
  ): Promise<PartnerBook> {
    const partner = await this.partner(agentId);
    if (fresh) this.withdrawalsOf.delete(partner.agent_id);
    const [facts, withdrawals, terms, settings, catalogue] = await Promise.all([
      this.facts.get(partner.agent_id, () =>
        this.orders.factsFor(partner.agent_id),
      ),
      this.withdrawalsOf.get(partner.agent_id, () =>
        this.withdrawals.forAgent(partner.agent_id),
      ),
      this.plans.termsFor(partner.cohort),
      this.settings.get(),
      this.products.facts(),
    ]);
    const payouts = withdrawals
      .filter((w) => w.status === 'paid' && w.paid_at)
      .map((w) => ({ id: w._id, amount: w.amount, paid_at: w.paid_at! }))
      .sort((a, b) => a.paid_at.getTime() - b.paid_at.getTime());
    const open = withdrawals
      .filter((w) => OPEN_STATUSES.includes(w.status))
      .reduce((sum, w) => sum + w.amount, 0);

    const book = buildBook(facts, {
      now,
      selfPiiId: partner.pii_id,
      returnWindowDays: settings.return_window_days,
      planFor: terms,
      gstOf: (sku) => catalogue.get(sku)?.gst_rate ?? UNKNOWN_GST_RATE,
      payouts,
      open,
    });
    return {
      partner: {
        ...partner,
        monthly_target: partner.monthly_target || settings.monthly_target,
      },
      book,
      settings,
      withdrawals,
    };
  }

  /** Commission for these orders of the partner's, keyed by `order_id`. */
  async forOrders(agentId: string): Promise<Map<string, OrderCommission>> {
    const { book } = await this.bookOf(agentId);
    return new Map(book.rows.map((r) => [r.order_id, commissionOf(r)]));
  }

  /** Drop what is cached of the partner — after something changed it here. */
  forget(agentId: string): void {
    const id = agentId.toUpperCase();
    this.facts.delete(id);
    this.partners.delete(id);
    this.withdrawalsOf.delete(id);
  }

  /** A withdrawal of theirs moved: their screens show it at once on this server. */
  forgetWithdrawals(agentId: string): void {
    this.withdrawalsOf.delete(agentId.toUpperCase());
  }

  async summary(agentId: string): Promise<CommissionSummary> {
    const { partner, book } = await this.bookOf(agentId);
    const c = book.current;
    return {
      month: c.month,
      month_delivered_sales: c.sales,
      monthly_target: partner.monthly_target,
      current_rate: c.rate,
      next_slab: c.next_slab,
      month_commission_estimate: Math.round((c.sales * c.rate) / 100),
      totals: book.totals,
      earned: book.earned,
      withdrawable: book.withdrawable,
      plan_draft: c.draft,
    };
  }

  async ledger(agentId: string, query: LedgerQueryDto): Promise<LedgerPage> {
    const { book } = await this.bookOf(agentId);
    const rows = query.status
      ? book.rows.filter((r) => r.status === query.status)
      : book.rows;
    const page = new PageResult(
      rows.slice(query.skip, query.skip + query.limit).map(itemOf),
      rows.length,
      query,
    );
    return Object.assign(page, { totals: book.totals });
  }

  /** Every cohort's plan this month (the "Compare cohorts" section), and the partner's own. */
  async plansFor(agentId: string): Promise<MyPlans> {
    const partner = await this.partner(agentId);
    const month = istMonthKey(new Date());
    const [plans, settings] = await Promise.all([
      this.plans.inEffect(month),
      this.settings.get(),
    ]);
    if (!plans.some((p) => p.cohort === partner.cohort)) {
      const own = (await this.plans.termsFor(partner.cohort))(month);
      plans.unshift({ ...own, label: partner.cohort });
    }
    return {
      my_cohort: partner.cohort,
      month,
      plans: plans.map((p) => ({
        cohort: p.cohort,
        label: p.label,
        draft: p.draft,
        effective_from: p.effective_from,
        slabs: p.slabs,
        notes: p.notes,
      })),
      tds: {
        rate_with_pan: settings.tds_rate_with_pan,
        rate_without_pan: settings.tds_rate_without_pan,
        section: TDS_SECTION,
      },
      min_withdrawal: settings.min_withdrawal,
      return_window_days: settings.return_window_days,
    };
  }

  /** Orders placed in `month` with what each earns, and the month's TDS at the partner's rate. */
  async statement(
    agentId: string,
    month: string,
  ): Promise<CommissionStatement> {
    const [{ partner, book, settings }, payout] = await Promise.all([
      this.bookOf(agentId),
      this.partner(agentId).then((p) =>
        this.onboarding.payoutFacts([p.agent_ref]),
      ),
    ]);
    const from = istMonthStart(month).getTime();
    const to = istMonthStart(addMonths(month, 1)).getTime();
    const rows = book.rows
      .filter(
        (r) => r.placed_at.getTime() >= from && r.placed_at.getTime() < to,
      )
      .reverse();
    const sum = (match: (s: CommissionStatus) => boolean) =>
      rows.filter((r) => match(r.status)).reduce((n, r) => n + r.amount, 0);
    const earned = sum((s) => s === 'confirmed' || s === 'paid');
    const tdsRate = payout.get(partner.agent_ref)?.pan_verified
      ? settings.tds_rate_with_pan
      : settings.tds_rate_without_pan;
    const tds = round2((earned * tdsRate) / 100);
    return {
      month,
      rows: rows.map((r) => ({
        order_id: r.order_id,
        order_date: istDate(r.placed_at),
        customer_name: r.customer_name,
        order_value: r.order_value,
        order_status: r.stage,
        rate: r.rate,
        amount: r.amount,
        status: r.status,
      })),
      earned,
      pending: sum((s) => s === 'pending'),
      reversed: sum((s) => s === 'reversed'),
      tds_rate: tdsRate,
      tds,
      net_payable: round2(earned - tds),
    };
  }

  /** TDS actually deducted at payout, month by month, and the quarter's Form 16A. */
  async tds(agentId: string, quarter: string): Promise<TdsReport> {
    const partner = await this.partner(agentId);
    const months = quarterMonths(quarter);
    const [paid, certificate, payout, settings] = await Promise.all([
      this.withdrawals.all(
        {
          agentId: partner.agent_id,
          statuses: ['paid'],
          paidFrom: istMonthStart(months[0]),
          paidTo: istMonthStart(addMonths(months[2], 1)),
        },
        1_000,
      ),
      this.certificates.find(partner.agent_id, quarter),
      this.onboarding.payoutFacts([partner.agent_ref]),
      this.settings.get(),
    ]);
    const facts = payout.get(partner.agent_ref);
    const rateNow = facts?.pan_verified
      ? settings.tds_rate_with_pan
      : settings.tds_rate_without_pan;
    const rows = months.map((month) => {
      const inMonth = paid.filter((w) => istMonthKey(w.paid_at!) === month);
      const gross = inMonth.reduce((n, w) => n + w.amount, 0);
      const tds = round2(inMonth.reduce((n, w) => n + w.tds_amount, 0));
      return {
        month,
        gross,
        tds_rate: gross ? round2((tds * 100) / gross) : rateNow,
        tds,
        net: round2(gross - tds),
      };
    });
    const url = certificate
      ? ((await this.storage.sign([certificate.path])).get(certificate.path) ??
        null)
      : null;
    return {
      quarter,
      deductor: DEDUCTOR,
      section: TDS_SECTION,
      pan_number: facts?.pan_number ?? null,
      months: rows,
      total: {
        gross: rows.reduce((n, r) => n + r.gross, 0),
        tds: round2(rows.reduce((n, r) => n + r.tds, 0)),
        net: round2(rows.reduce((n, r) => n + r.net, 0)),
      },
      form16a_url: url,
    };
  }

  /** The partner as commission needs them (cached a minute); 404 when unknown. */
  async partner(agentId: string): Promise<PartnerTerms> {
    const id = agentId.toUpperCase();
    return this.partners.get(id, async () => {
      const a = await this.agents.requireByAgentId(id);
      return {
        agent_ref: a._id,
        agent_id: a.agent_id ?? id,
        pii_id: a.pii_id,
        name: a.profile?.name ?? a.preview?.name ?? null,
        cohort: a.cohort ?? '',
        stage: a.stage,
        is_active: a.is_active,
        monthly_target: a.monthly_target ?? 0,
      };
    });
  }
}

function commissionOf(r: LedgerRow): OrderCommission {
  return {
    base: r.order_value,
    rate: r.rate,
    amount: r.amount,
    status: r.status,
    confirms_at: r.confirms_at,
    confirmed_at: r.confirmed_at,
    paid_at: r.paid_at,
    withdrawal_id: r.withdrawal_id,
    reversed_reason: r.reversed_reason,
  };
}

function itemOf(r: LedgerRow): LedgerItem {
  return {
    id: `cm-${r.order_id}`,
    order_id: r.order_id,
    customer_id: r.pii_id,
    customer_name: r.customer_name,
    order_value: r.order_value,
    order_status: r.stage,
    paid_amount: r.paid_amount,
    created_at: r.placed_at,
    delivered_at: r.delivered_at,
    ...commissionOf(r),
  };
}
