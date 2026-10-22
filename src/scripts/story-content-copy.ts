/**
 * What `migrate-story-content` does with each old row, worked out without
 * touching the database so a dry run and `--apply` decide the same way.
 */
import { isDeepStrictEqual } from 'node:util';

import {
  toStored,
  type StoredContent,
} from '../modules/stories/repositories/story-content.mapping';
import type { StoryContentKind } from '../modules/stories/schemas/story-content.schema';

/** The four collections `vistaar_v2_story_content` replaced, by the kind each became. */
export const OLD_COLLECTIONS: Record<StoryContentKind, string> = {
  design: 'vistaar_v2_story_designs',
  festival: 'vistaar_v2_story_festivals',
  sample: 'vistaar_v2_story_samples',
  template: 'vistaar_v2_story_templates',
};

export interface OldRow {
  _id: unknown;
  key?: unknown;
  updated_at?: unknown;
  [field: string]: unknown;
}

export type ContentRow = StoredContent<{ _id: string }> & {
  updated_at?: unknown;
  [field: string]: unknown;
};

export interface CopyPlan {
  /** Not in the new collection yet. */
  insert: ContentRow[];
  /** The old row was edited after it was copied; `was` guards the write. */
  replace: { row: ContentRow; was: unknown }[];
  unchanged: number;
  /** Edited in the new collection after the copy — HO's newer version stays. */
  kept: string[];
  skipped: { id: string; reason: string }[];
}

const time = (value: unknown): number =>
  value instanceof Date ? value.getTime() : 0;

/**
 * Newer `updated_at` wins, so the copy can run before the deploy and again
 * after it: the second run brings the old screens' last edits across and
 * never undoes an edit HO made on the new one.
 */
export function planCopy(
  kind: StoryContentKind,
  oldRows: OldRow[],
  current: ContentRow[],
): CopyPlan {
  const byId = new Map(current.map((r) => [r._id, r]));
  const idOfKey = new Map(current.map((r) => [r.key, r._id]));
  const plan: CopyPlan = {
    insert: [],
    replace: [],
    unchanged: 0,
    kept: [],
    skipped: [],
  };
  const seen = new Set<string>();

  for (const old of oldRows) {
    if (typeof old._id !== 'string') {
      plan.skipped.push({ id: String(old._id), reason: '_id is not a string' });
      continue;
    }
    let row: ContentRow;
    try {
      row = toStored(kind, old as OldRow & { _id: string });
    } catch (error) {
      plan.skipped.push({ id: old._id, reason: (error as Error).message });
      continue;
    }
    // Two old rows on one key break the new unique index; a human picks.
    if (seen.has(row.key)) {
      plan.skipped.push({ id: old._id, reason: `key ${row.key} seen twice` });
      continue;
    }
    seen.add(row.key);

    const there = byId.get(row._id);
    if (!there) {
      const holder = idOfKey.get(row.key);
      if (holder) {
        plan.skipped.push({
          id: old._id,
          reason: `key ${row.key} already belongs to ${holder}`,
        });
      } else {
        plan.insert.push(row);
      }
    } else if (isDeepStrictEqual(there, row)) {
      plan.unchanged += 1;
    } else if (time(row.updated_at) > time(there.updated_at)) {
      plan.replace.push({ row, was: there.updated_at });
    } else {
      plan.kept.push(row._id);
    }
  }
  return plan;
}
