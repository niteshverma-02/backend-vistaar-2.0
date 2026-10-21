import { Injectable, Logger } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { notFound } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { istDayRange, istMonthKey } from '@common/utils/ist-day.util';
import { TtlCache } from '@common/utils/ttl-cache';
import { AgentsService } from '@modules/agents/services/agents.service';
import { LeadsService } from '@modules/leads/services/leads.service';
import { PincodeService } from '@modules/spine/services/pincode.service';
import { ProductFactsService } from '@modules/spine/services/product-facts.service';

import type {
  KkdActivityQueryDto,
  KkdSummaryQueryDto,
} from '../dto/kkd-activity.dto';
import {
  STORE_RADIUS_KM,
  activitiesOf,
  filterActivities,
  indexFarmers,
  storeBookOf,
  storesWithin,
  summaryOf,
  type ActivitySources,
  type KkdActivity,
  type KkdSummary,
  type NearbyStore,
  type ProductLabel,
  type StoreBook,
} from '../kkd-activity.domain';
import { FarmerOrdersRepository } from '../repositories/farmer-orders.repository';
import { KkdEventsRepository } from '../repositories/kkd-events.repository';
import { StoreActivityRepository } from '../repositories/store-activity.repository';
import { StoreDirectoryRepository } from '../repositories/store-directory.repository';

/** Rows read per source for one partner's farmers — far above one book. */
const READ_CAP = 2_000;
/** Other apps write these; a minute's lag is fine for a follow-up list. */
const TTL_MS = 60_000;

const EMPTY_BOOK: StoreBook = {
  stores: new Map(),
  byWarehouse: new Map(),
  byLogin: new Map(),
};

export interface KkdStoresView {
  /** The partner's registration point: onboarding GPS, else their pincode's centre; `null` when neither is known. */
  centre: { lat: number; lng: number; source: 'signup' | 'pincode' } | null;
  km: number;
  stores: NearbyStore[];
}

/**
 * KKD & App activity: the farmers a partner holds, at the stores and on the
 * app, read from the other apps' records on every call (cached a minute per
 * partner). Nothing is written anywhere.
 */
@Injectable()
export class KkdActivityService {
  private readonly logger = new Logger(KkdActivityService.name);
  private readonly feeds = new TtlCache<KkdActivity[]>(TTL_MS, 2_000);
  private readonly books = new TtlCache<StoreBook>(TTL_MS, 1);

  constructor(
    private readonly leads: LeadsService,
    private readonly agents: AgentsService,
    private readonly pincodes: PincodeService,
    private readonly products: ProductFactsService,
    private readonly orders: FarmerOrdersRepository,
    private readonly store: StoreActivityRepository,
    private readonly events: KkdEventsRepository,
    private readonly directory: StoreDirectoryRepository,
  ) {}

  async feed(
    partner: PartnerRef,
    query: KkdActivityQueryDto,
  ): Promise<PageResult<KkdActivity>> {
    if (query.customer) await this.requireHeld(partner, query.customer);
    const range = istDayRange(query.from, query.to);
    const items = filterActivities(await this.activities(partner.agent_id), {
      customer: query.customer,
      channel: query.channel,
      from: range.from,
      to: range.to,
    });
    const start = (query.page - 1) * query.limit;
    return new PageResult(
      items.slice(start, start + query.limit),
      items.length,
      query,
    );
  }

  async summary(
    partner: PartnerRef,
    query: KkdSummaryQueryDto,
  ): Promise<KkdSummary> {
    if (query.customer) await this.requireHeld(partner, query.customer);
    const items = filterActivities(await this.activities(partner.agent_id), {
      customer: query.customer,
    });
    return summaryOf(items, query.month ?? istMonthKey(new Date()));
  }

  /** KKD stores within 50 km of where the partner registered (TL). */
  async stores(partner: PartnerRef): Promise<KkdStoresView> {
    const agent = await this.agents.requireByAgentId(partner.agent_id);
    const signup = agent.location?.coordinates;
    let centre: KkdStoresView['centre'] = signup
      ? { lat: signup[1], lng: signup[0], source: 'signup' }
      : null;
    if (!centre) {
      const pin = await this.pincodes.centre(
        agent.profile?.pincode ?? agent.preview?.pincode,
      );
      if (pin) centre = { ...pin, source: 'pincode' };
    }
    const book = await this.storeBook();
    return {
      centre,
      km: STORE_RADIUS_KM,
      stores: centre
        ? storesWithin(centre, book.stores.values(), STORE_RADIUS_KM)
        : [],
    };
  }

  private async requireHeld(partner: PartnerRef, piiId: string): Promise<void> {
    if (!(await this.leads.holds(partner.agent_id, piiId))) {
      throw notFound('This farmer is not one of yours.');
    }
  }

  private activities(agentId: string): Promise<KkdActivity[]> {
    return this.feeds.get(agentId.toUpperCase(), () => this.load(agentId));
  }

  private storeBook(): Promise<StoreBook> {
    return this.books.get('all', async () =>
      storeBookOf(await this.directory.load()),
    );
  }

  private async load(agentId: string): Promise<KkdActivity[]> {
    const farmers = await this.leads.heldFarmers(agentId);
    if (farmers.length === 0) return [];
    const index = indexFarmers(farmers);
    const since = new Date(Math.min(...farmers.map((f) => f.since.getTime())));
    const piiIds = [...index.byPii.keys()];
    const phones = [...index.byPhone.keys()];

    const [book, products, orders, posOrders, walkins, prescriptions, events] =
      await Promise.allSettled([
        this.storeBook(),
        this.products.facts(),
        this.orders.since(piiIds, since, READ_CAP),
        this.store.posOrders(piiIds, phones, since, READ_CAP),
        this.store.walkins(piiIds, phones, since, READ_CAP),
        this.store.prescriptions(piiIds, phones, since, READ_CAP),
        this.events.since(phones, since, READ_CAP),
      ]);

    // One source down must not blank the screen: its rows are left out and logged.
    const sources: ActivitySources = {
      orders: this.settled('app and store orders', orders) ?? [],
      posOrders: this.settled('POS archive orders', posOrders) ?? [],
      walkins: this.settled('walk-ins', walkins) ?? [],
      prescriptions: this.settled('crop advice', prescriptions) ?? [],
      events: this.settled('app events', events) ?? [],
    };
    return activitiesOf(
      sources,
      index,
      this.settled('stores', book) ?? EMPTY_BOOK,
      this.settled('catalogue', products) ?? new Map<string, ProductLabel>(),
    );
  }

  private settled<T>(name: string, result: PromiseSettledResult<T>): T | null {
    if (result.status === 'fulfilled') return result.value;
    this.logger.warn(
      `KKD activity without ${name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
    );
    return null;
  }
}
