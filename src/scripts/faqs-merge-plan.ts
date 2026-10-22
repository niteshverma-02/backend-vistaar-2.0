/**
 * What `migrate-faqs-merge` has to do, worked out from what is on the
 * database — kept apart from the script so the decisions can be tested.
 */

export interface StoredRow {
  _id: string;
  kind?: string;
  category?: string;
  updated_at?: Date;
  [field: string]: unknown;
}

export interface StoredIndex {
  name: string;
  key: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: unknown;
}

export interface MergePlan {
  /** FAQ rows from before the merge (a `category`, no `kind`) to tag `kind: 'faq'`. */
  tagFaqs: string[];
  /** Sections not in the merged collection yet. */
  insert: StoredRow[];
  /** Sections the old code changed after they were copied: newer `updated_at`. */
  replace: { row: StoredRow; seen: Date | undefined }[];
  unchanged: string[];
  /** Section rows only in the merged collection: added since, or deleted in the old one since. */
  onlyMerged: string[];
  /** A section key that is already a non-section row's `_id`. */
  collisions: string[];
  /** Rows that are neither kind and have no `category`. */
  unknown: string[];
  /** The pre-merge `{q_key}` unique index: every section after the first would break it on `null`. */
  blockingIndex: string | null;
}

const time = (d: Date | undefined) => (d ? new Date(d).getTime() : 0);

export function mergePlan(
  oldSections: StoredRow[],
  merged: StoredRow[],
  indexes: StoredIndex[],
): MergePlan {
  const byId = new Map(merged.map((r) => [r._id, r]));
  const oldIds = new Set(oldSections.map((s) => s._id));
  const plan: MergePlan = {
    tagFaqs: [],
    insert: [],
    replace: [],
    unchanged: [],
    onlyMerged: [],
    collisions: [],
    unknown: [],
    blockingIndex: null,
  };

  for (const row of merged) {
    if (row.kind === 'section') {
      if (!oldIds.has(row._id)) plan.onlyMerged.push(row._id);
    } else if (row.kind === undefined) {
      if (typeof row.category === 'string') plan.tagFaqs.push(row._id);
      else plan.unknown.push(row._id);
    } else if (row.kind !== 'faq') {
      plan.unknown.push(row._id);
    }
  }

  for (const section of oldSections) {
    const there = byId.get(section._id);
    if (!there) plan.insert.push(section);
    else if (there.kind !== 'section') plan.collisions.push(section._id);
    else if (time(section.updated_at) > time(there.updated_at)) {
      plan.replace.push({ row: section, seen: there.updated_at });
    } else plan.unchanged.push(section._id);
  }

  const blocking = indexes.find(
    (i) =>
      i.unique === true &&
      !i.sparse &&
      i.partialFilterExpression === undefined &&
      Object.keys(i.key).includes('q_key'),
  );
  plan.blockingIndex = blocking?.name ?? null;
  return plan;
}

/** Nothing left to write: a re-run after `--apply` lands here. */
export function isDone(plan: MergePlan): boolean {
  return (
    plan.tagFaqs.length === 0 &&
    plan.insert.length === 0 &&
    plan.replace.length === 0
  );
}

/** What stops `--apply`; empty when it may run. */
export function blockers(plan: MergePlan): string[] {
  const out: string[] = [];
  if (plan.collisions.length) {
    out.push(
      `section key(s) already used by another row: ${plan.collisions.join(', ')}`,
    );
  }
  if (plan.unknown.length) {
    out.push(`rows of no known kind: ${plan.unknown.join(', ')}`);
  }
  if (plan.blockingIndex && plan.insert.length > 0) {
    out.push(
      `index ${plan.blockingIndex} is unique on q_key for every row; drop it and ` +
        `build the partial one first (docs/PROD-CHECKLIST.md, FAQs)`,
    );
  }
  return out;
}
