import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { badRequest } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import { haversineKm, isIndiaFix } from '@common/utils/geo.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { OrderService } from '@modules/orders/services/order.service';
import { PiiService } from '@modules/spine/services/pii.service';
import { PincodeService } from '@modules/spine/services/pincode.service';

import type { RadarPincodeQueryDto, RadarQueryDto } from '../dto/radar.dto';
import { placeOf } from '../lead-views';
import {
  maskPhone,
  RADAR_LAYERS,
  storesOnMap,
  type PoolLayer,
  type StoreSpot,
} from '../radar.domain';
import { KkdStoreRepository } from '../repositories/kkd-store.repository';
import {
  RadarPoolRepository,
  type KkdLeadRow,
  type OrgCustomerRow,
} from '../repositories/radar-pool.repository';
import { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';
import { RadarPoolService } from './radar-pool.service';

const DEFAULT_KM = 10;
/** Read at most this many rows in the ring, show the nearest ones. */
const READ_CAP = 2_000;
const SHOW_CAP = 500;
const STORE_CAP = 50;
/** A 50 km ring holds ~150 pincodes; this only bounds a runaway answer. */
const PINCODE_CAP = 300;
/** Stores change rarely; each process re-reads them at most once a minute. */
const STORES_TTL_MS = 60_000;
/** A pincode's list moves by the hour (the pools); five minutes is fresh enough. */
const PAGE_TTL_MS = 5 * 60 * 1000;
const PAGE_CACHE_CAP = 1_000;

export interface RadarDot {
  pii_id: string;
  kind: 'customer' | 'lead';
  name: string;
  phone: string;
  village: string;
  district: string | null;
  crops: string[];
  acreage: number;
  stage: string;
  expected_value: number | null;
  /** Customers only: confirmed orders, ₹ and the latest. */
  orders: number | null;
  spend: number | null;
  last_order_at: Date | null;
  distance_km: number;
  lat: number;
  lng: number;
  /** `false` = the pincode's centre: draw it as approximate. */
  exact: boolean;
}

/** A Katyayani Krishi Kendra in the ring — where to send a farmer. */
export interface RadarStore {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  distance_km: number;
  /** `false` = no map pin on record: placed at its pincode's centre. */
  exact: boolean;
}

/** One pincode marker: how many people of each layer are filed there. */
export interface RadarPincode {
  pincode: string;
  district: string | null;
  state: string | null;
  /** The pincode area's centre — where the marker goes. */
  lat: number;
  lng: number;
  distance_km: number;
  kkd_leads: number;
  org_customers: number;
}

export interface RadarView {
  centre: { lat: number; lng: number; source: 'gps' | 'signup' | 'pincode' };
  km: number;
  counts: {
    customers: number;
    leads: number;
    unplaced: number;
    stores: number;
    kkd_leads: number;
    org_customers: number;
  };
  /** Nearest first. */
  items: RadarDot[];
  /** KKD stores in the ring, nearest first. */
  stores: RadarStore[];
  /** The closest store anywhere, when none is in the ring; else `null`. */
  nearest_store: RadarStore | null;
  /** Pincodes in the ring with KKD leads or org customers, nearest first. */
  pincodes: RadarPincode[];
  /** `ready: false` = the pools are still being read (seconds after a start). */
  pools: { ready: boolean; built_at: Date | null };
}

/** A farmer outside the partner's book, in a pincode's list. */
export interface RadarPoolPerson {
  pii_id: string;
  layer: PoolLayer;
  name: string | null;
  /** `98******12` — the number itself comes with "Add as lead", after the farmer's OTP. */
  phone_masked: string | null;
  pincode: string;
  state: string | null;
  district: string | null;
  /** KKD leads: `kkd_app` · `kkd_web`, and whether the farmer has the KKD app. */
  channels: string[];
  has_app: boolean | null;
  /** KKD leads: when they first came in. */
  since: Date | null;
  /** Org customers: orders on record and the latest. */
  orders: number | null;
  last_order_at: Date | null;
}

const nameOf = (r: { first_name?: string | null; last_name?: string | null }) =>
  [r.first_name, r.last_name]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .join(' ') || null;

const round1 = (km: number) => Math.round(km * 10) / 10;

const toStore = (s: StoreSpot, km: number): RadarStore => ({
  id: s.id,
  name: `Katyayani Krishi Kendra${s.city ? ` · ${s.city}` : ''}`,
  address: s.address,
  city: s.city,
  state: s.state,
  pincode: s.pincode,
  phone: s.phone,
  lat: s.lat,
  lng: s.lng,
  distance_km: round1(km),
  exact: s.exact,
});

/**
 * The nearby radar (PRD C9), centred on the phone's GPS: the partner's own
 * customers and open leads as dots (their own GPS, else their pincode's
 * centre), the KKD stores, and — since KKD leads and org customers carry a
 * pincode and no GPS — a marker per pincode in the ring with how many of each
 * are filed there; tapping one lists them (`pincodeList`) with mobiles masked.
 * KKD leads another partner holds never show. Nothing is written.
 */
@Injectable()
export class RadarService {
  constructor(
    private readonly rows: VistaarLeadsRepository,
    private readonly agents: AgentsService,
    private readonly orders: OrderService,
    private readonly pincodes: PincodeService,
    private readonly stores: KkdStoreRepository,
    private readonly pools: RadarPoolService,
    private readonly poolRows: RadarPoolRepository,
    private readonly piis: PiiService,
  ) {}

  private storeBook: { at: number; rows: StoreSpot[] } | null = null;
  private readonly pages = new Map<
    string,
    { at: number; people: RadarPoolPerson[] }
  >();

  async around(partner: PartnerRef, query: RadarQueryDto): Promise<RadarView> {
    const km = query.km ?? DEFAULT_KM;
    const layers = new Set(query.layers ?? RADAR_LAYERS);
    const mine = layers.has('mine');
    const pooled = layers.has('kkd_leads') || layers.has('org_customers');
    const centre = await this.centreOf(partner, query);
    const [rows, unplaced, stores, ring] = await Promise.all([
      mine ? this.rows.nearby(partner.agent_id, centre, km, READ_CAP) : [],
      mine ? this.rows.countUnplaced(partner.agent_id) : 0,
      layers.has('stores')
        ? this.storesAround(centre, km)
        : { inRing: [], nearest: null },
      pooled ? this.pincodes.around(centre.lat, centre.lng, km) : [],
    ]);

    const dots = rows
      .map((row) => {
        const place = placeOf(row);
        return place
          ? {
              row,
              place,
              distance: haversineKm(
                centre.lat,
                centre.lng,
                place.lat,
                place.lng,
              ),
            }
          : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, SHOW_CAP);

    const customers = dots
      .filter((d) => d.row.stage === 'won')
      .map((d) => d.row.pii_id);
    const business = await this.orders.businessByCustomer(
      partner.agent_id,
      customers,
    );

    const items: RadarDot[] = dots.map(({ row, place, distance }) => {
      const isCustomer = row.stage === 'won';
      const b = business.get(row.pii_id);
      return {
        pii_id: row.pii_id,
        kind: isCustomer ? 'customer' : 'lead',
        name: row.name,
        phone: row.phone,
        village: row.village,
        district: row.district,
        crops: row.crops,
        acreage: row.acreage,
        stage: row.stage,
        expected_value: row.expected_value,
        orders: isCustomer ? (b?.orders ?? 0) : null,
        spend: isCustomer ? (b?.spend ?? 0) : null,
        last_order_at: isCustomer
          ? (b?.last_order_at ?? row.last_order_at ?? null)
          : null,
        distance_km: round1(distance),
        lat: place.lat,
        lng: place.lng,
        exact: place.exact,
      };
    });

    const pool = this.pools.countsFor(ring.map((p) => p.pincode));
    const pincodes: RadarPincode[] = [];
    for (const spot of ring) {
      const c = pool.counts.get(spot.pincode);
      const kkd = layers.has('kkd_leads') ? (c?.kkd_leads ?? 0) : 0;
      const org = layers.has('org_customers') ? (c?.org_customers ?? 0) : 0;
      if (!kkd && !org) continue;
      pincodes.push({
        pincode: spot.pincode,
        district: spot.district,
        state: spot.state,
        lat: spot.lat,
        lng: spot.lng,
        distance_km: round1(spot.distance_km),
        kkd_leads: kkd,
        org_customers: org,
      });
      if (pincodes.length >= PINCODE_CAP) break;
    }

    return {
      centre,
      km,
      counts: {
        customers: customers.length,
        leads: items.length - customers.length,
        unplaced,
        stores: stores.inRing.length,
        kkd_leads: pincodes.reduce((n, p) => n + p.kkd_leads, 0),
        org_customers: pincodes.reduce((n, p) => n + p.org_customers, 0),
      },
      items,
      stores: stores.inRing,
      nearest_store: stores.nearest,
      pincodes,
      pools: { ready: !pooled || pool.ready, built_at: pool.built_at },
    };
  }

  /**
   * One pincode's KKD leads or org customers, newest first — the list behind
   * a marker. Mobiles masked; farmers a partner holds now (and the partner
   * themself) are dropped, so a page may hold fewer than `limit`.
   */
  async pincodeList(
    partner: PartnerRef,
    pincode: string,
    query: RadarPincodeQueryDto,
  ): Promise<PageResult<RadarPoolPerson>> {
    const skip = (query.page - 1) * query.limit;
    const { ids, total } = await this.pools.page(
      query.layer,
      pincode,
      skip,
      query.limit,
    );
    const key = `${query.layer}|${pincode}|${skip}|${query.limit}`;
    const people = await this.cachedPage(key, () =>
      this.peopleOf(query.layer, pincode, ids),
    );
    const held = await this.rows.heldAmong(people.map((p) => p.pii_id));
    const items = people.filter(
      (p) => !held.has(p.pii_id) && p.pii_id !== partner.pii_id,
    );
    return new PageResult(items, total, query);
  }

  private async cachedPage(
    key: string,
    load: () => Promise<RadarPoolPerson[]>,
  ): Promise<RadarPoolPerson[]> {
    const hit = this.pages.get(key);
    if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.people;
    const people = await load();
    if (this.pages.size >= PAGE_CACHE_CAP) {
      // Oldest first: a Map iterates in insertion order.
      this.pages.delete(this.pages.keys().next().value!);
    }
    this.pages.delete(key);
    this.pages.set(key, { at: Date.now(), people });
    return people;
  }

  private async peopleOf(
    layer: PoolLayer,
    pincode: string,
    ids: string[],
  ): Promise<RadarPoolPerson[]> {
    if (!ids.length) return [];
    const area = await this.pincodes.lookup(pincode);
    const base = {
      layer,
      pincode,
      state: area?.state ?? null,
      district: area?.district ?? null,
    };
    if (layer === 'org_customers') {
      const byPii = new Map<string, OrgCustomerRow>();
      for (const r of await this.poolRows.customers(ids)) {
        const seen = byPii.get(r.pii_id);
        const at = r.last_order_date?.getTime() ?? 0;
        if (!seen || at > (seen.last_order_date?.getTime() ?? 0)) {
          byPii.set(r.pii_id, r);
        }
      }
      return ids.flatMap((pii) => {
        const r = byPii.get(pii);
        if (!r) return [];
        return [
          {
            ...base,
            pii_id: pii,
            name: nameOf(r),
            phone_masked: maskPhone(r.number),
            channels: [],
            has_app: null,
            since: null,
            orders: typeof r.order_count === 'number' ? r.order_count : null,
            last_order_at: r.last_order_date ?? null,
          },
        ];
      });
    }

    const [leads, phones] = await Promise.all([
      this.poolRows.kkdLeads(ids),
      this.piis.phonesOf(ids),
    ]);
    const byPii = new Map<string, KkdLeadRow[]>();
    for (const r of leads) {
      const list = byPii.get(r.pii_id);
      if (list) list.push(r);
      else byPii.set(r.pii_id, [r]);
    }
    return ids.flatMap((pii) => {
      const rows = byPii.get(pii);
      if (!rows) return [];
      const named = rows.find((r) => nameOf(r)) ?? rows[0];
      const since = rows
        .map((r) => r.created_at)
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0];
      return [
        {
          ...base,
          state: base.state ?? named.state ?? null,
          pii_id: pii,
          name: nameOf(named),
          phone_masked: maskPhone(phones.get(pii)),
          channels: [
            ...new Set(rows.map((r) => r.source).filter(Boolean)),
          ] as string[],
          has_app: rows.some((r) => r.has_app === true)
            ? true
            : rows.some((r) => r.has_app === false)
              ? false
              : null,
          since: since ?? null,
          orders: null,
          last_order_at: null,
        },
      ];
    });
  }

  /** A store read failing leaves the farmers on the radar, with no stores. */
  private async storesAround(
    centre: { lat: number; lng: number },
    km: number,
  ): Promise<{ inRing: RadarStore[]; nearest: RadarStore | null }> {
    let book = this.storeBook;
    if (!book || Date.now() - book.at > STORES_TTL_MS) {
      try {
        book = { at: Date.now(), rows: await this.loadStores() };
        this.storeBook = book;
      } catch {
        return { inRing: [], nearest: null };
      }
    }
    const byDistance = book.rows
      .map((s) => ({
        s,
        d: haversineKm(centre.lat, centre.lng, s.lat, s.lng),
      }))
      .sort((a, b) => a.d - b.d);
    const inRing = byDistance
      .filter(({ d }) => d <= km)
      .slice(0, STORE_CAP)
      .map(({ s, d }) => toStore(s, d));
    const first = byDistance[0];
    return {
      inRing,
      nearest: !inRing.length && first ? toStore(first.s, first.d) : null,
    };
  }

  /** The franchise master's active stores, one per spot, placed. */
  private async loadStores(): Promise<StoreSpot[]> {
    const candidates = await this.stores.all();
    const centres = new Map<string, { lat: number; lng: number } | null>();
    for (const c of candidates) {
      if (c.point || !c.pincode || centres.has(c.pincode)) continue;
      centres.set(c.pincode, await this.pincodes.centre(c.pincode));
    }
    return storesOnMap(candidates, (pin) =>
      pin ? (centres.get(pin) ?? null) : null,
    );
  }

  /** The phone's GPS; else where the partner signed up; else their pincode. */
  private async centreOf(
    partner: PartnerRef,
    query: RadarQueryDto,
  ): Promise<RadarView['centre']> {
    if ((query.lat == null) !== (query.lng == null)) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Send both lat and lng, or neither.',
      );
    }
    if (query.lat != null && query.lng != null) {
      if (!isIndiaFix(query.lat, query.lng)) {
        throw badRequest(
          'VALIDATION_FAILED',
          'This location is outside India — check the phone’s GPS.',
        );
      }
      return { lat: query.lat, lng: query.lng, source: 'gps' };
    }
    const agent = await this.agents.requireByAgentId(partner.agent_id);
    const signup = agent.location?.coordinates;
    if (signup) return { lat: signup[1], lng: signup[0], source: 'signup' };
    const pin = await this.pincodes.centre(
      agent.profile?.pincode ?? agent.preview?.pincode,
    );
    if (pin) return { ...pin, source: 'pincode' };
    throw badRequest(
      'VALIDATION_FAILED',
      'Turn on location to see farmers near you.',
    );
  }
}
