import type { GeoPoint } from '@common/utils/geo.util';

import {
  releaseAtOf,
  type LocationSource,
  type ReleaseWindow,
} from './leads.domain';
import type {
  VistaarLeadBrief,
  VistaarLeadRecord,
} from './repositories/vistaar-leads.repository';
import type { LeadActivity, StageMove } from './schemas/vistaar-lead.schema';

/** Where the farmer is, as the app pins it. */
export interface FarmerPlace {
  lat: number;
  lng: number;
  /** `false` = the pincode's centre, not a GPS fix: show it as approximate. */
  exact: boolean;
  source: LocationSource;
  at: Date | null;
}

/** A lead as the app and the HO portal see it. */
export type LeadView = Omit<
  VistaarLeadBrief,
  | '_id'
  | 'consent'
  | 'ex_employee_declared_at'
  | 'location'
  | 'location_source'
  | 'location_at'
> & {
  consent_version: number;
  /** From then another partner may take the farmer, unless worked (or ordered for) before. */
  releases_at: Date;
  location: FarmerPlace | null;
};

export function placeOf(row: {
  location?: GeoPoint | null;
  location_source?: LocationSource | null;
  location_at?: Date | null;
}): FarmerPlace | null {
  if (!row.location || !row.location_source) return null;
  const [lng, lat] = row.location.coordinates;
  return {
    lat,
    lng,
    exact: row.location_source !== 'pincode',
    source: row.location_source,
    at: row.location_at ?? null,
  };
}

export interface LeadDetail extends LeadView {
  stage_history: StageMove[];
  /** Newest first. */
  activities: LeadActivity[];
}

/** A list row: no history, the consent as its version, and when the hold lapses. */
export function viewOf(
  row: VistaarLeadBrief & { holder_history?: unknown },
  window: ReleaseWindow,
): LeadView {
  const {
    _id: _row,
    consent,
    ex_employee_declared_at: _declared,
    holder_history: _before,
    location: _point,
    location_source: _source,
    location_at: _at,
    ...view
  } = row;
  return {
    ...view,
    consent_version: consent.version,
    releases_at: releaseAtOf(row, window),
    location: placeOf(row),
  };
}

/** One lead: the row with its stage history and activities (newest first). */
export function detailOf(
  row: VistaarLeadRecord,
  window: ReleaseWindow,
): LeadDetail {
  const {
    stage_history: history,
    activities,
    holder_history: _before,
    ...brief
  } = row;
  return {
    ...viewOf(brief, window),
    stage_history: history ?? [],
    activities: [...(activities ?? [])].reverse(),
  };
}
