import { Injectable } from '@nestjs/common';

import { PageResult } from '@common/http/page-result';
import {
  addMonths,
  istDaysBetween,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';
import { TtlCache } from '@common/utils/ttl-cache';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import { AttendanceService } from '@modules/attendance/services/attendance.service';
import type { Book, LedgerRow } from '@modules/commission/commission.domain';
import { CommissionService } from '@modules/commission/services/commission.service';
import {
  GigReadsService,
  type GigMonthStats,
} from '@modules/gigs/services/gig-reads.service';
import { LeadsService } from '@modules/leads/services/leads.service';
import { firstUrl } from '@modules/orders/orders.domain';
import { ProductFactsService } from '@modules/spine/services/product-facts.service';

import {
  healthOf,
  lifecycleOf,
  periodMonths,
  previousMonths,
  shares,
  tierOf,
  type HealthFactor,
  type LifecycleStage,
  type Period,
  type Tier,
  type TierStanding,
} from '../performance.domain';
import type { AdminPerformanceQueryDto } from '../dto/performance.dto';

/** Tier, stage and health move over days; Home and Profile ask on every open. */
const STANDING_TTL_MS = 5 * 60_000;
const STANDING_MAX = 10_000;
const TOP = 4;

/**
 * Partners worked out at once for HO's table — each book is up to two
 * queries in flight, so 10 leaves most of the pool to the app.
 */
const BOOKS_AT_ONCE = 10;
/** Rows per page on HO's table: each row is a partner's book. */
const MAX_ROWS = 50;

/** One partner's month on HO's table. */
export interface PartnerMonthRow {
  agent_id: string;
  name: string | null;
  cohort: string;
  district: string | null;
  state: string | null;
  month: string;
  /** Delivered sales (base, before GST) in the month. */
  sales: number;
  rate: number;
  commission: number;
  orders_placed: number;
  monthly_target: number;
  achieved_pct: number;
  /** All-time confirmed + paid commission, and what can be withdrawn now. */
  earned: number;
  withdrawable: number;
  pending: number;
  /** All-time commission paid out. */
  paid: number;
  last_order_at: Date | null;
  lifecycle_stage: LifecycleStage;
  tier: Tier;
}

/** One partner on HO's commission board: the month row plus their book of farmers. */
export interface BoardRow extends PartnerMonthRow {
  farmers: number;
  customers: number;
}

/** Every approved partner's month, exact (each from their own book). */
export interface CommissionBoard {
  month: string;
  computed_at: Date;
  partners: number;
  /** Partners whose book could not be worked out this time (left out of rows). */
  failed: number;
  totals: {
    sales: number;
    commission: number;
    earned: number;
    withdrawable: number;
    pending: number;
    paid: number;
  };
  rows: BoardRow[];
}

/**
 * The board sweeps every approved partner's book. Ten minutes old is fine for
 * HO's dashboards, and one sweep serves every HO viewer in that time.
 */
const BOARD_TTL_MS = 10 * 60_000;
/** Books worked out at once in a sweep — a few, so the app keeps the pool. */
const BOARD_AT_ONCE = 5;

/** What Home and Profile show of the partner's standing. */
export interface Standing {
  cohort: string;
  tier: Tier;
  lifecycle_stage: LifecycleStage;
  health_score: number;
  monthly_target: number;
}

interface Compared {
  value: number;
  previous: number | null;
}

export interface PerformanceView {
  period: Period;
  /** First IST day of the period, and the day after it ends. */
  from: string;
  to: string;
  first_app_order_at: Date | null;
  sales: Compared;
  target: { value: number; achieved_pct: number };
  orders_placed: Compared;
  active_customers: Compared;
  lead_conversion: {
    total: number;
    won: number;
    lost: number;
    pct: number | null;
  };
  /** Meeting gigs in the IST month of today, whatever the period; `null` if they could not be read. */
  gigs: GigMonthStats | null;
  commission: { value: number; draft_rate: boolean };
  monthly: {
    month: string;
    sales: number;
    rate: number;
    commission: number;
    in_period: boolean;
  }[];
  by_category: { name: string; value: number; pct: number }[];
  top_products: {
    sku: string;
    name: string;
    image: string | null;
    qty: number;
    value: number;
  }[];
  tier: TierStanding;
  health: { score: number; factors: HealthFactor[] };
  lifecycle_stage: LifecycleStage;
  monthly_target: number;
}

/**
 * My Performance and the partner's standing, from the commission book (the
 * same orders, read once a minute), leads, attendance and the catalogue in
 * memory. Nothing is stored: every number is worked out when asked.
 */
@Injectable()
export class PerformanceService {
  private readonly boards = new TtlCache<CommissionBoard>(BOARD_TTL_MS, 13);
  private readonly standings = new TtlCache<Standing>(
    STANDING_TTL_MS,
    STANDING_MAX,
  );

  constructor(
    private readonly commission: CommissionService,
    private readonly leads: LeadsService,
    private readonly attendance: AttendanceService,
    private readonly products: ProductFactsService,
    private readonly agents: AgentsService,
    private readonly gigs: GigReadsService,
  ) {}

  async performance(
    agentId: string,
    period: Period,
    now = new Date(),
  ): Promise<PerformanceView> {
    const thisMonth = istMonthKey(now);
    const months = periodMonths(period, thisMonth);
    const before = previousMonths(period, months);
    const from = istMonthStart(months[0]);
    const to = istMonthStart(addMonths(months[months.length - 1], 1));

    const [{ partner, book }, leads, fieldDays, catalogue, gigs] =
      await Promise.all([
        this.commission.bookOf(agentId, now),
        this.leads.performance(agentId.toUpperCase(), from, to),
        this.attendance.fieldDays(agentId.toUpperCase(), thisMonth),
        this.products.facts(),
        // A side block: the rest of the page must not fail with it.
        this.gigs.monthStats(agentId.toUpperCase(), now).catch(() => null),
      ]);

    const sales = (list: readonly string[]) =>
      list.reduce((sum, m) => sum + book.month(m).sales, 0);
    const placedIn = (list: readonly string[]) => {
      const a = istMonthStart(list[0]).getTime();
      const b = istMonthStart(addMonths(list[list.length - 1], 1)).getTime();
      return book.rows.filter(
        (r) => r.placed_at.getTime() >= a && r.placed_at.getTime() < b,
      );
    };
    const customers = (rows: LedgerRow[]) =>
      new Set(
        rows
          .filter((r) => r.pii_id && r.stage !== 'cancelled')
          .map((r) => r.pii_id),
      ).size;

    const inPeriod = placedIn(months);
    const earlier = before ? placedIn(before) : null;
    const salesNow = sales(months);
    const target = partner.monthly_target * months.length;

    // Delivered lines in the period, by category and by pack.
    const byCategory = new Map<string, number>();
    const byProduct = new Map<string, { qty: number; value: number }>();
    for (const r of book.rows) {
      if (
        !r.delivered_at ||
        r.status === 'reversed' ||
        r.delivered_at < from ||
        r.delivered_at >= to
      )
        continue;
      for (const l of r.lines) {
        const category = catalogue.get(l.sku)?.category ?? 'Other';
        byCategory.set(category, (byCategory.get(category) ?? 0) + l.base);
        const p = byProduct.get(l.sku) ?? { qty: 0, value: 0 };
        p.qty += l.qty;
        p.value += l.base;
        byProduct.set(l.sku, p);
      }
    }

    const fy: string[] = periodMonths('fy', thisMonth);
    const monthly = fy.map((m) => {
      const f = book.month(m);
      return {
        month: m,
        sales: f.sales,
        rate: f.rate,
        // Each order at its own plan's rate: one month can mix earning cohorts.
        commission: f.commission,
        in_period: months.includes(m),
      };
    });

    const standing = this.standingFrom(book, now, {
      field_days: fieldDays,
      overdue_follow_ups: leads.overdue_follow_ups,
    });

    return {
      period,
      from: `${months[0]}-01`,
      to: `${addMonths(months[months.length - 1], 1)}-01`,
      first_app_order_at: book.rows.at(-1)?.placed_at ?? null,
      sales: { value: salesNow, previous: before ? sales(before) : null },
      target: {
        value: target,
        achieved_pct: target
          ? Math.min(100, Math.round((salesNow * 100) / target))
          : 0,
      },
      orders_placed: {
        value: inPeriod.length,
        previous: earlier ? earlier.length : null,
      },
      active_customers: {
        value: customers(inPeriod),
        previous: earlier ? customers(earlier) : null,
      },
      lead_conversion: {
        total: leads.total,
        won: leads.won,
        lost: leads.lost,
        pct: leads.conversion_pct,
      },
      gigs,
      commission: {
        value: months.reduce((sum, m) => sum + book.month(m).commission, 0),
        draft_rate: months.some((m) => book.month(m).draft),
      },
      monthly,
      by_category: shares(byCategory),
      top_products: [...byProduct]
        .sort((a, b) => b[1].value - a[1].value || a[0].localeCompare(b[0]))
        .slice(0, TOP)
        .map(([sku, p]) => {
          const fact = catalogue.get(sku);
          return {
            sku,
            name: fact?.name ?? sku,
            image: firstUrl(fact?.image),
            qty: p.qty,
            value: Math.round(p.value),
          };
        }),
      tier: standing.tier,
      health: standing.health,
      lifecycle_stage: standing.lifecycle_stage,
      monthly_target: partner.monthly_target,
    };
  }

  /** Home and Profile: tier, lifecycle stage, health score, target (cached 5 min). */
  standing(agentId: string): Promise<Standing> {
    const id = agentId.toUpperCase();
    return this.standings.get(id, async () => {
      const now = new Date();
      const [{ partner, book }, leads, fieldDays] = await Promise.all([
        this.commission.bookOf(id, now),
        // An empty range: only the overdue follow-ups are wanted here.
        this.leads.performance(id, now, now),
        this.attendance.fieldDays(id, istMonthKey(now)),
      ]);
      const s = this.standingFrom(book, now, {
        field_days: fieldDays,
        overdue_follow_ups: leads.overdue_follow_ups,
      });
      return {
        cohort: partner.cohort,
        tier: s.tier.current,
        lifecycle_stage: s.lifecycle_stage,
        health_score: s.health.score,
        monthly_target: partner.monthly_target,
      };
    });
  }

  /**
   * HO's partner table (Commission, Sales): approved partners one page at a
   * time, each with the month's numbers from their book (cached a minute, so
   * paging back and forth costs nothing), 50 rows a page at most.
   */
  async adminList(
    query: AdminPerformanceQueryDto,
  ): Promise<PageResult<PartnerMonthRow>> {
    const now = new Date();
    const month = query.month ?? istMonthKey(now);
    query.limit = Math.min(query.limit, MAX_ROWS);
    const { items, total } = await this.agents.list(
      {
        stage: 'approved',
        cohort: query.cohort,
        state: query.state,
        district: query.district,
        q: query.q,
      },
      { skip: query.skip, limit: query.limit, sort: { decided_at: -1 } },
    );
    const rows: PartnerMonthRow[] = [];
    for (let i = 0; i < items.length; i += BOOKS_AT_ONCE) {
      const batch = items.slice(i, i + BOOKS_AT_ONCE);
      rows.push(
        ...(await Promise.all(batch.map((a) => this.monthRow(a, month, now)))),
      );
    }
    return new PageResult(rows, total, query);
  }

  /**
   * HO's commission board: every approved partner's month from their own
   * book — the app's numbers exactly. Swept on demand, a few partners at a
   * time and without filling the app's caches, then kept ten minutes.
   */
  board(month?: string): Promise<CommissionBoard> {
    const key = month ?? istMonthKey(new Date());
    return this.boards.get(key, () => this.sweep(key));
  }

  private async sweep(month: string): Promise<CommissionBoard> {
    const now = new Date();
    const [agents, counts] = await Promise.all([
      this.agents.approvedBrief(),
      this.leads.countsByPartner(),
    ]);
    const rows: BoardRow[] = [];
    let failed = 0;
    for (let i = 0; i < agents.length; i += BOARD_AT_ONCE) {
      const done = await Promise.allSettled(
        agents
          .slice(i, i + BOARD_AT_ONCE)
          .map((a) => this.monthRow(a, month, now, false)),
      );
      for (const d of done) {
        if (d.status === 'rejected') {
          failed += 1;
          continue;
        }
        const c = counts.get(d.value.agent_id);
        rows.push({
          ...d.value,
          farmers: c?.farmers ?? 0,
          customers: c?.customers ?? 0,
        });
      }
    }
    const sum = (k: keyof CommissionBoard['totals']) =>
      rows.reduce((n, r) => n + r[k], 0);
    return {
      month,
      computed_at: now,
      partners: rows.length,
      failed,
      totals: {
        sales: sum('sales'),
        commission: sum('commission'),
        earned: sum('earned'),
        withdrawable: sum('withdrawable'),
        pending: sum('pending'),
        paid: sum('paid'),
      },
      rows,
    };
  }

  private async monthRow(
    a: AgentRecord,
    month: string,
    now: Date,
    store = true,
  ): Promise<PartnerMonthRow> {
    const { partner, book } = await this.commission.bookOf(
      a.agent_id ?? '',
      now,
      false,
      a,
      store,
    );
    const m = book.month(month);
    const from = istMonthStart(month).getTime();
    const to = istMonthStart(addMonths(month, 1)).getTime();
    const last = book.rows[0]?.placed_at ?? null;
    const last3 = [-3, -2, -1].map((n) => addMonths(istMonthKey(now), n));
    return {
      agent_id: a.agent_id ?? '',
      name: a.profile?.name ?? a.preview?.name ?? null,
      cohort: a.cohort ?? partner.cohort,
      district: a.profile?.district ?? a.preview?.district ?? null,
      state: a.profile?.state ?? a.preview?.state ?? null,
      month,
      sales: m.sales,
      rate: m.rate,
      commission: m.commission,
      orders_placed: book.rows.filter(
        (r) => r.placed_at.getTime() >= from && r.placed_at.getTime() < to,
      ).length,
      monthly_target: partner.monthly_target,
      achieved_pct: partner.monthly_target
        ? Math.min(100, Math.round((m.sales * 100) / partner.monthly_target))
        : 0,
      earned: book.earned,
      withdrawable: book.withdrawable,
      pending: book.totals.pending.amount,
      paid: book.paid,
      last_order_at: last,
      lifecycle_stage: lifecycleOf(last ? istDaysBetween(last, now) : null),
      tier: tierOf(last3.reduce((sum, k) => sum + book.month(k).sales, 0) / 3)
        .current,
    };
  }

  /** HO sets a partner's own monthly target, or (`null`) puts them back on the default. */
  async setTarget(
    agentId: string,
    target: number | null,
    by: string,
  ): Promise<{ agent_id: string; own_target: number | null }> {
    const agent = await this.agents.setMonthlyTarget(agentId, target, by);
    const id = agent.agent_id ?? agentId.toUpperCase();
    this.commission.forget(id);
    this.standings.delete(id);
    return { agent_id: id, own_target: agent.monthly_target ?? null };
  }

  private standingFrom(
    book: Book,
    now: Date,
    facts: { field_days: number; overdue_follow_ups: number },
  ): {
    tier: TierStanding;
    lifecycle_stage: LifecycleStage;
    health: { score: number; factors: HealthFactor[] };
  } {
    const thisMonth = istMonthKey(now);
    const last3 = [-3, -2, -1].map((n) => addMonths(thisMonth, n));
    const avg = last3.reduce((sum, m) => sum + book.month(m).sales, 0) / 3;
    const last = book.rows[0]?.placed_at ?? null;
    const days = last ? istDaysBetween(last, now) : null;
    const monthStart = istMonthStart(thisMonth).getTime();
    return {
      tier: tierOf(avg),
      lifecycle_stage: lifecycleOf(days),
      health: healthOf({
        days_since_last_order: days,
        orders_this_month: book.rows.filter(
          (r) => r.placed_at.getTime() >= monthStart,
        ).length,
        // No courses in the backend yet: nothing open, nothing undone.
        training: { done: 0, total: 0 },
        field_days: facts.field_days,
        overdue_follow_ups: facts.overdue_follow_ups,
      }),
    };
  }
}
