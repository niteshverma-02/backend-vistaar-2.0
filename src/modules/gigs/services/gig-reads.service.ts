import { Injectable } from '@nestjs/common';

import {
  DAY_MS,
  istDayStart,
  istMonthKey,
  istMonthStart,
} from '@common/utils/ist-day.util';

import { GigRepository } from '../repositories/gig.repository';
import type { Gig } from '../schemas/gig.schema';

/** A gig as other modules see it (Today, My Story, earnings). */
export interface GigBrief {
  id: string;
  title: string;
  village: string;
  venue: string | null;
  starts_at: Date;
  ends_at: Date;
  payout: number;
  status: Gig['status'];
}

/** One approved gig's pay, as the commission book takes it. */
export interface GigCredit {
  id: string;
  amount: number;
  approved_at: Date;
}

export interface GigMonthStats {
  /** Approved gigs held this IST month. */
  done: number;
  /** Σ their payout, ₹. */
  earnings: number;
  /** Farmers present at them. */
  farmers: number;
  /** Gigs the partner holds that have not started yet. */
  upcoming: number;
}

const briefOf = (g: Gig): GigBrief => ({
  id: g._id,
  title: g.title,
  village: g.village,
  venue: g.venue,
  starts_at: g.starts_at,
  ends_at: g.ends_at,
  payout: g.payout,
  status: g.status,
});

/**
 * The reads other modules make about a partner's gigs. Kept apart from the
 * gig services so commission, Today and My Story can import it without
 * pulling in the gig desks.
 */
@Injectable()
export class GigReadsService {
  constructor(private readonly gigs: GigRepository) {}

  /** Gigs the partner holds starting today or tomorrow (IST), soonest first — Today's tasks. */
  async soon(agentId: string, now: Date): Promise<GigBrief[]> {
    const from = istDayStart(now);
    const rows = await this.gigs.forAgentBetween(
      agentId,
      ['accepted', 'checked_in'],
      from,
      new Date(from.getTime() + 2 * DAY_MS),
    );
    return rows.map(briefOf);
  }

  /** Gigs the partner holds from now on — the My Story invite picker. */
  async upcoming(agentId: string, now: Date): Promise<GigBrief[]> {
    const rows = await this.gigs.forAgentBetween(
      agentId,
      ['accepted'],
      now,
      null,
    );
    return rows.map(briefOf);
  }

  /** Approved gigs' pay, oldest approval first — what the wallet adds when gig pay is on. */
  async creditsFor(agentId: string): Promise<GigCredit[]> {
    const rows = await this.gigs.approvedFor(agentId);
    return rows.map((r) => ({
      id: r._id,
      amount: r.payout,
      approved_at: r.reviewed_at ?? new Date(0),
    }));
  }

  /** My Performance's gigs block for the IST month of `now`. */
  async monthStats(agentId: string, now: Date): Promise<GigMonthStats> {
    const from = istMonthStart(istMonthKey(now));
    const [held, ahead] = await Promise.all([
      this.gigs.approvedStats(agentId, from, now),
      this.gigs.forAgentBetween(agentId, ['accepted'], now, null),
    ]);
    return { ...held, upcoming: ahead.length };
  }
}
