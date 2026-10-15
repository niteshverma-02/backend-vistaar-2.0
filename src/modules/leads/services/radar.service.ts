import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { badRequest } from '@common/errors/api-error';
import { haversineKm, isIndiaFix } from '@common/utils/geo.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { OrderService } from '@modules/orders/services/order.service';
import { PincodeService } from '@modules/spine/services/pincode.service';

import type { RadarQueryDto } from '../dto/radar.dto';
import { placeOf } from '../lead-views';
import {
  KkdStoreRepository,
  type KkdStoreRow,
} from '../repositories/kkd-store.repository';
import { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';

const DEFAULT_KM = 10;
/** Read at most this many rows in the ring, show the nearest ones. */
const READ_CAP = 2_000;
const SHOW_CAP = 500;
const STORE_CAP = 50;
/** Stores change rarely; each process re-reads them at most once a minute. */
const STORES_TTL_MS = 60_000;

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
}

export interface RadarView {
  centre: { lat: number; lng: number; source: 'gps' | 'signup' | 'pincode' };
  km: number;
  counts: {
    customers: number;
    leads: number;
    unplaced: number;
    stores: number;
  };
  /** Nearest first. */
  items: RadarDot[];
  /** KKD stores in the ring, nearest first. */
  stores: RadarStore[];
}

/**
 * The nearby radar (PRD C9): the partner's own customers and open leads
 * within N km, and the KKD stores there — no retailers, nobody else's
 * farmers, and not the PRD's "new farmers" layer (needs TL and consent). One query on the
 * partner's rows (`agent_id` first), distances in memory; business only for
 * the customers in the ring. Nothing is written.
 */
@Injectable()
export class RadarService {
  constructor(
    private readonly rows: VistaarLeadsRepository,
    private readonly agents: AgentsService,
    private readonly orders: OrderService,
    private readonly pincodes: PincodeService,
    private readonly stores: KkdStoreRepository,
  ) {}

  private storeBook: { at: number; rows: KkdStoreRow[] } | null = null;

  async around(partner: PartnerRef, query: RadarQueryDto): Promise<RadarView> {
    const km = query.km ?? DEFAULT_KM;
    const centre = await this.centreOf(partner, query);
    const [rows, unplaced, stores] = await Promise.all([
      this.rows.nearby(partner.agent_id, centre, km, READ_CAP),
      this.rows.countUnplaced(partner.agent_id),
      this.storesAround(centre, km),
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
        distance_km: Math.round(distance * 10) / 10,
        lat: place.lat,
        lng: place.lng,
        exact: place.exact,
      };
    });

    return {
      centre,
      km,
      counts: {
        customers: customers.length,
        leads: items.length - customers.length,
        unplaced,
        stores: stores.length,
      },
      items,
      stores,
    };
  }

  /** A store read failing leaves the farmers on the radar, with no stores. */
  private async storesAround(
    centre: { lat: number; lng: number },
    km: number,
  ): Promise<RadarStore[]> {
    let book = this.storeBook;
    if (!book || Date.now() - book.at > STORES_TTL_MS) {
      try {
        book = { at: Date.now(), rows: await this.stores.all() };
        this.storeBook = book;
      } catch {
        return [];
      }
    }
    return book.rows
      .map((s) => ({
        s,
        d: haversineKm(centre.lat, centre.lng, s.lat, s.lng),
      }))
      .filter(({ d }) => d <= km)
      .sort((a, b) => a.d - b.d)
      .slice(0, STORE_CAP)
      .map(({ s, d }) => ({
        id: s.id,
        name: `Katyayani Krishi Kendra${s.city ? ` · ${s.city}` : ''}`,
        address: s.address,
        city: s.city,
        state: s.state,
        pincode: s.pincode,
        phone: s.phone,
        lat: s.lat,
        lng: s.lng,
        distance_km: Math.round(d * 10) / 10,
      }));
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
