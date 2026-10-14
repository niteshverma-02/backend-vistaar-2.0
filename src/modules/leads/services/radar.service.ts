import { Injectable } from '@nestjs/common';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { badRequest } from '@common/errors/api-error';
import { haversineKm, isIndiaFix } from '@common/utils/geo.util';
import { AgentsService } from '@modules/agents/services/agents.service';
import { OrderService } from '@modules/orders/services/order.service';
import { PincodeService } from '@modules/spine/services/pincode.service';

import type { RadarQueryDto } from '../dto/radar.dto';
import { placeOf } from '../lead-views';
import { VistaarLeadsRepository } from '../repositories/vistaar-leads.repository';

const DEFAULT_KM = 10;
/** Read at most this many rows in the ring, show the nearest ones. */
const READ_CAP = 2_000;
const SHOW_CAP = 500;

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

export interface RadarView {
  centre: { lat: number; lng: number; source: 'gps' | 'signup' | 'pincode' };
  km: number;
  counts: { customers: number; leads: number; unplaced: number };
  /** Nearest first. */
  items: RadarDot[];
}

/**
 * The nearby radar (PRD C9): the partner's own customers and open leads
 * within N km — no retailers, nobody else's farmers. One query on the
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
  ) {}

  async around(partner: PartnerRef, query: RadarQueryDto): Promise<RadarView> {
    const km = query.km ?? DEFAULT_KM;
    const centre = await this.centreOf(partner, query);
    const [rows, unplaced] = await Promise.all([
      this.rows.nearby(partner.agent_id, centre, km, READ_CAP),
      this.rows.countUnplaced(partner.agent_id),
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
      },
      items,
    };
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
