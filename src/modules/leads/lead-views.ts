import { releaseAtOf, type ReleaseWindow } from './leads.domain';
import type {
  VistaarLeadBrief,
  VistaarLeadRecord,
} from './repositories/vistaar-leads.repository';
import type { LeadActivity, StageMove } from './schemas/vistaar-lead.schema';

/** A lead as the app and the HO portal see it. */
export type LeadView = Omit<
  VistaarLeadBrief,
  '_id' | 'consent' | 'ex_employee_declared_at'
> & {
  consent_version: number;
  /** From then another partner may take the farmer, unless worked (or ordered for) before. */
  releases_at: Date;
};

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
    ...view
  } = row;
  return {
    ...view,
    consent_version: consent.version,
    releases_at: releaseAtOf(row, window),
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
