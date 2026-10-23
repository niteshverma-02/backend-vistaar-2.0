import { Injectable, Logger } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import type { AdminPrincipal } from '@common/interfaces/principal.interface';
import { istDate, istDayRange } from '@common/utils/ist-day.util';
import type { Capability } from '@modules/access/access.domain';
import { AccessService } from '@modules/access/services/access.service';
import { AgentsService } from '@modules/agents/services/agents.service';
import { rangeError } from '@modules/attendance/attendance.domain';
import { AdminAttendanceService } from '@modules/attendance/services/admin-attendance.service';
import { WalletService } from '@modules/commission/services/wallet.service';
import { AdminFeedbackService } from '@modules/feedback/services/admin-feedback.service';
import { AdminGigsQueryDto } from '@modules/gigs/dto/gig.dto';
import { AdminGigsService } from '@modules/gigs/services/admin-gigs.service';
import { LeadsService } from '@modules/leads/services/leads.service';
import { AdminOrdersQueryDto } from '@modules/orders/dto/admin-order.dto';
import { AdminOrderService } from '@modules/orders/services/admin-order.service';
import { RewardsService } from '@modules/rewards/services/rewards.service';

import type {
  AdminOverview,
  OverviewAttendance,
  OverviewGigs,
  OverviewLeads,
  OverviewNps,
  OverviewOrders,
  OverviewPartners,
  OverviewPayouts,
  OverviewQueryDto,
  OverviewRewards,
} from '../dto/overview.dto';
import { periodOf, previousOf, type Period } from '../overview.domain';

/**
 * HO Home's Vistaar cards in one read. Each block is the service call its
 * own route makes — `/admin/orders/summary` (period and prev), the agents'
 * stage counts and window counts (`/admin/agents/summary`),
 * `/admin/leads/summary` (all time and the period), `/admin/attendance`,
 * `/admin/withdrawals/totals`, `/admin/rewards/summary` (the period and all
 * time), `/admin/gigs/summary`, `/admin/feedback/summary` — in parallel,
 * nothing recomputed here. Writes nothing, stores nothing; the commission
 * board stays out (every partner's book, too heavy for Home).
 */
@Injectable()
export class OverviewQueryService {
  private readonly logger = new Logger(OverviewQueryService.name);

  constructor(
    private readonly access: AccessService,
    private readonly orders: AdminOrderService,
    private readonly agents: AgentsService,
    private readonly leads: LeadsService,
    private readonly attendance: AdminAttendanceService,
    private readonly wallet: WalletService,
    private readonly rewards: RewardsService,
    private readonly gigs: AdminGigsService,
    private readonly feedback: AdminFeedbackService,
  ) {}

  async get(
    admin: AdminPrincipal,
    query: OverviewQueryDto,
  ): Promise<AdminOverview> {
    const period = periodOf(query.from, query.to, istDate(new Date()));
    const refused = rangeError(period.from, period.to);
    if (refused) throw badRequest('VALIDATION_FAILED', refused, [refused]);
    const prev = previousOf(period);
    const range = istDayRange(period.from, period.to) as {
      from: Date;
      to: Date;
    };

    // The guard has read this token's access already; this is its cached copy.
    const { capabilities } = await this.access.accessFor(admin);
    const block = <T>(
      capability: Capability,
      name: string,
      read: () => Promise<T>,
    ): Promise<T | null> => {
      if (!capabilities.includes(capability)) return Promise.resolve(null);
      // One source down must not blank Home: its block is null and logged.
      return read().catch((error: unknown) => {
        this.logger.warn(
          `Overview without ${name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      });
    };

    const [orders, partners, leads, attendance, payouts, rewards, gigs, nps] =
      await Promise.all([
        block('orders.read', 'orders', () => this.ordersOf(period, prev)),
        block('agents.read', 'partners', () => this.partnersOf(range)),
        block('leads.read', 'leads', () => this.leadsOf(period)),
        block('attendance.read', 'attendance', () => this.attendanceToday()),
        block('commission.read', 'payouts', () => this.payouts()),
        block('rewards.read', 'rewards', () => this.rewardsOf(period)),
        block('gigs.read', 'gigs', () => this.gigsOf(period)),
        block('feedback.read', 'nps', () => this.npsOf(period)),
      ]);
    return {
      from: period.from,
      to: period.to,
      prev,
      orders,
      partners,
      leads,
      attendance_today: attendance,
      payouts,
      rewards,
      gigs,
      nps,
    };
  }

  private async ordersOf(
    period: Period,
    prev: Period,
  ): Promise<OverviewOrders> {
    const [now, before] = await Promise.all([
      this.orders.summary(Object.assign(new AdminOrdersQueryDto(), period)),
      this.orders.summary(Object.assign(new AdminOrdersQueryDto(), prev)),
    ]);
    return {
      orders: now.orders,
      value: now.value,
      partners: now.partners,
      customers: now.customers,
      prev: { orders: before.orders, value: before.value },
    };
  }

  private async partnersOf(range: {
    from: Date;
    to: Date;
  }): Promise<OverviewPartners> {
    const [counts, inRange] = await Promise.all([
      this.agents.stageCounts(),
      this.agents.rangeCounts(range.from, range.to),
    ]);
    return {
      total: counts.total,
      approved: counts.stages.approved,
      signups_in_range: inRange.signed_up,
      approved_in_range: inRange.approved,
      stages: counts.stages,
    };
  }

  /** The cards all time, and the same summary over the period for what it added and won. */
  private async leadsOf(period: Period): Promise<OverviewLeads> {
    const [all, added] = await Promise.all([
      this.leads.summary(),
      this.leads.summary(period),
    ]);
    return {
      total: all.total,
      today: all.today,
      last_7_days: all.last_7_days,
      added_in_range: added.total,
      won_in_range: added.by_stage.find((s) => s.key === 'won')?.count ?? 0,
      due_today: all.due_today,
      overdue: all.overdue,
      by_stage: all.by_stage,
    };
  }

  /** `/admin/attendance`'s own read for today; only its summary is kept. */
  private async attendanceToday(): Promise<OverviewAttendance> {
    const { summary } = await this.attendance.board();
    return {
      partners: summary.partners,
      on_duty: summary.on_duty,
      day_closed: summary.day_closed,
      not_started: summary.not_started,
    };
  }

  private async payouts(): Promise<OverviewPayouts> {
    const t = await this.wallet.totals();
    return {
      requested_count: t.requested.count,
      requested_amount: t.requested.amount,
      approved_net: t.approved.net,
    };
  }

  /** What the period earned and HO approved; what waits now, from any day (the desk's queue). */
  private async rewardsOf(period: Period): Promise<OverviewRewards> {
    const [earned, all] = await Promise.all([
      this.rewards.summary(period),
      this.rewards.summary({}),
    ]);
    return {
      coin_approved: earned.coin.approved.amount,
      gig_approved: earned.gig.approved.amount,
      coin_pending: all.coin.pending.amount,
      gig_pending: all.gig.pending.amount,
      pending: all.pending,
    };
  }

  private async gigsOf(period: Period): Promise<OverviewGigs> {
    const s = await this.gigs.summary(
      Object.assign(new AdminGigsQueryDto(), period),
    );
    return {
      by_status: s.by_status,
      partners: s.partners,
      approved_payout: s.approved_payout,
      farmers: s.farmers,
    };
  }

  private async npsOf(period: Period): Promise<OverviewNps> {
    const s = await this.feedback.summary(period.from, period.to);
    return {
      nps: s.nps,
      open_follow_ups: s.follow_ups.open,
      overdue: s.follow_ups.overdue,
    };
  }
}
