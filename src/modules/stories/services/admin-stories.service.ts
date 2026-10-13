import { Injectable } from '@nestjs/common';

import { badRequest, notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { AgentsService } from '@modules/agents/services/agents.service';

import type {
  AdminStoryListQueryDto,
  StoryPartnersQueryDto,
  StoryStatsQueryDto,
} from '../dto/admin-story.dto';
import {
  StoryStatRepository,
  sumCounts,
  type Counts,
  type DayTotals,
  type PartnerTotals,
} from '../repositories/story-stat.repository';
import { StoryRepository } from '../repositories/story.repository';
import { istDate, statsRange } from '../stories.domain';
import { StoriesService, type StoryView } from './stories.service';

const STORY_NOT_FOUND =
  'This story could not be found. It may have been deleted.';

type AgentRecord = Awaited<ReturnType<AgentsService['requireByAgentId']>>;

export interface PartnerRef {
  agent_id: string;
  name: string | null;
  phone: string | null;
  cohort: string | null;
  district: string | null;
  state: string | null;
}

export interface StorySummary {
  from: string;
  to: string;
  totals: { saved: number; shares: number; partners: number };
  by_template: Counts;
  by_channel: Counts;
  /** Every day of the range, oldest first; a quiet day shows 0. */
  by_day: DayTotals[];
}

export type PartnerStoryRow = PartnerRef & PartnerTotals;

export type AdminStoryView = StoryView & { agent_id: string };

/**
 * Head office's side of My Story: who is promoting, with what, and the
 * partners' saved stories — read, plus taking down one that should not be
 * shared. Nobody makes a story for a partner.
 */
@Injectable()
export class AdminStoriesService {
  constructor(
    private readonly stats: StoryStatRepository,
    private readonly stories: StoryRepository,
    private readonly partnerStories: StoriesService,
    private readonly agents: AgentsService,
  ) {}

  async summary(query: StoryStatsQueryDto): Promise<StorySummary> {
    const { from, to } = range(query.from, query.to);
    const [totals, days] = await Promise.all([
      this.stats.totals(from, to),
      this.stats.perDay(from, to),
    ]);
    const byDate = new Map(days.map((d) => [d.date, d]));
    const by_day: DayTotals[] = [];
    for (let d = from; d <= to; d = nextDay(d)) {
      by_day.push(
        byDate.get(d) ?? { date: d, saved: 0, shares: 0, partners: 0 },
      );
    }
    return {
      from,
      to,
      totals: {
        saved: totals.saved,
        shares: totals.shares,
        partners: totals.partners,
      },
      by_template: totals.templates,
      by_channel: totals.channels,
      by_day,
    };
  }

  async partners(
    query: StoryPartnersQueryDto,
  ): Promise<PageResult<PartnerStoryRow> & { from: string; to: string }> {
    const { from, to } = range(query.from, query.to);
    const { rows, total } = await this.stats.perPartner(
      from,
      to,
      query.skip,
      query.limit,
    );
    const refs = await this.refs(rows.map((r) => r.agent_id));
    const items = rows.map((r) => ({
      ...(refs.get(r.agent_id) ?? bareRef(r.agent_id)),
      ...r,
    }));
    return Object.assign(new PageResult(items, total, query), { from, to });
  }

  /** One partner's days and split in the range. */
  async partner(
    agentId: string,
    query: StoryStatsQueryDto,
  ): Promise<{
    partner: PartnerRef;
    from: string;
    to: string;
    totals: { saved: number; shares: number };
    by_template: Counts;
    by_channel: Counts;
    days: { date: string; saved: number; shares: number }[];
  }> {
    const { from, to } = range(query.from, query.to);
    const [agent, days] = await Promise.all([
      this.agents.requireByAgentId(agentId),
      this.stats.forPartner(agentId, from, to),
    ]);
    return {
      partner: refOf(agent),
      from,
      to,
      totals: {
        saved: days.reduce((n, d) => n + d.saved, 0),
        shares: days.reduce((n, d) => n + d.shares, 0),
      },
      by_template: sumCounts(days.map((d) => d.templates)),
      by_channel: sumCounts(days.map((d) => d.channels)),
      days: days.map((d) => ({
        date: d.date,
        saved: d.saved,
        shares: d.shares,
      })),
    };
  }

  async list(
    query: AdminStoryListQueryDto,
  ): Promise<PageResult<AdminStoryView>> {
    const { rows, total } = await this.stories.page(
      { agent_id: query.agent_id, template: query.template },
      query.skip,
      query.limit,
      query.sortSpec,
    );
    const views = await this.partnerStories.views(rows);
    return new PageResult(
      views.map((v, i) => ({ ...v, agent_id: rows[i].agent_id })),
      total,
      query,
    );
  }

  async get(id: string): Promise<AdminStoryView> {
    const story = await this.stories.find(id);
    if (!story) throw notFound(STORY_NOT_FOUND);
    const [view] = await this.partnerStories.views([story]);
    return { ...view, agent_id: story.agent_id };
  }

  /** Takes a story off the partner's list, files and all. Its past shares stay counted. */
  async remove(id: string): Promise<{ deleted: true }> {
    const story = await this.stories.find(id);
    if (!story || !(await this.stories.remove(story.agent_id, id))) {
      throw notFound(STORY_NOT_FOUND);
    }
    await this.partnerStories.dropFiles(story.agent_id, [story]);
    return { deleted: true };
  }

  private async refs(agentIds: string[]): Promise<Map<string, PartnerRef>> {
    if (agentIds.length === 0) return new Map();
    const { items } = await this.agents.list(
      { agent_ids: agentIds, include_unverified: true },
      { skip: 0, limit: agentIds.length, sort: { agent_id: 1 } },
    );
    return new Map(
      items.filter((a) => a.agent_id).map((a) => [a.agent_id!, refOf(a)]),
    );
  }
}

function range(from?: string, to?: string): { from: string; to: string } {
  const r = statsRange(from, to, istDate(new Date()));
  if ('error' in r) throw badRequest('VALIDATION_FAILED', r.error, [r.error]);
  return r;
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function refOf(a: AgentRecord): PartnerRef {
  return {
    agent_id: a.agent_id ?? '',
    name: a.profile?.name ?? a.preview?.name ?? null,
    phone: a.phone ?? null,
    cohort: a.cohort,
    district: a.profile?.district ?? a.preview?.district ?? null,
    state: a.profile?.state ?? a.preview?.state ?? null,
  };
}

const bareRef = (agentId: string): PartnerRef => ({
  agent_id: agentId,
  name: null,
  phone: null,
  cohort: null,
  district: null,
  state: null,
});
