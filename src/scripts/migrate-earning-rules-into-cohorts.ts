/**
 * Earning rules move into their cohorts (2026-10-22): each row of
 * `vistaar_v2_earning_rules` becomes an entry of its cohort's `rules[]` in
 * `vistaar_v2_earning_cohorts` — same `_id` and fields, minus `cohort_id`
 * (the cohort holding it says that). See docs/PROD-CHECKLIST.md for when.
 *
 *   node dist/scripts/migrate-earning-rules-into-cohorts.js           # dry run — writes nothing
 *   node dist/scripts/migrate-earning-rules-into-cohorts.js --apply   # writes each cohort's rules[]
 *
 * Safe to run again, before and after the deploy. Per rule id: not in its
 * cohort yet → added; there at a lower `version` (edited by the old code
 * after an earlier run) → replaced; there at the same or a higher version →
 * kept, the cohort is the truth from the deploy on. Rules only the cohort
 * has (added by the new code) stay. A re-run with nothing new changes
 * nothing. Each cohort's write is guarded by its `rules` as read, so an HO
 * edit in between is reported, not overwritten — run again.
 *
 * Never edits or drops `vistaar_v2_earning_rules` (dropped by hand, after
 * the counts agree); once it is gone the script only reports what the
 * cohorts hold. `enabled` (the rule's ON/OFF) is copied when set and left
 * absent when absent — read as on, as the code reads it. A rule whose
 * cohort does not exist is reported and left out. Writes no `updated_at` /
 * `version` of the cohort, does not boot the API and builds no index.
 */
import mongoose from 'mongoose';

const OLD = 'vistaar_v2_earning_rules';
const COHORTS = 'vistaar_v2_earning_cohorts';
/** Stands in for a missing timestamp; one value per run keeps comparisons stable. */
const RUN_AT = new Date();

/** An embedded rule, in the schema's field order (`EarningRule`). */
interface Rule {
  _id: string;
  name: string;
  trigger: string;
  conditions: unknown[];
  reward: { kind: string; amount: number };
  order: number;
  status: string;
  /** HO's ON/OFF; absent on rules from before the switch (= on), and left absent. */
  enabled?: boolean;
  version: number;
  created_by: string;
  updated_by: string;
  archived_by: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

type OldRule = Rule & { cohort_id: string };

interface Cohort {
  _id: string;
  name: string;
  status: string;
  rules?: Rule[];
}

function embedded(r: OldRule): Rule {
  return {
    _id: r._id,
    name: r.name,
    trigger: r.trigger,
    conditions: r.conditions ?? [],
    reward: r.reward,
    order: r.order,
    status: r.status ?? 'active',
    ...(r.enabled !== undefined && { enabled: r.enabled }),
    version: r.version ?? 1,
    created_by: r.created_by,
    updated_by: r.updated_by,
    archived_by: r.archived_by ?? null,
    archived_at: r.archived_at ?? null,
    created_at: r.created_at ?? RUN_AT,
    updated_at: r.updated_at ?? r.created_at ?? RUN_AT,
  };
}

const same = (a: Rule, b: Rule): boolean =>
  JSON.stringify(embedded({ ...a, cohort_id: '' })) ===
  JSON.stringify(embedded({ ...b, cohort_id: '' }));

interface Plan {
  rules: Rule[];
  added: string[];
  replaced: string[];
  kept: number;
  /** Same id and version, different content: kept, but worth a look. */
  differs: string[];
}

function plan(current: readonly Rule[], old: readonly OldRule[]): Plan {
  const rules = [...current];
  const at = new Map(rules.map((r, i) => [r._id, i]));
  const out: Plan = { rules, added: [], replaced: [], kept: 0, differs: [] };
  const fresh = [...old].sort(
    (a, b) => a.order - b.order || a._id.localeCompare(b._id),
  );
  for (const o of fresh) {
    const row = embedded(o);
    const i = at.get(o._id);
    if (i === undefined) {
      rules.push(row);
      out.added.push(o._id);
    } else if (rules[i].version < row.version) {
      rules[i] = row;
      out.replaced.push(o._id);
    } else {
      out.kept += 1;
      if (rules[i].version === row.version && !same(rules[i], row)) {
        out.differs.push(o._id);
      }
    }
  }
  return out;
}

async function main() {
  process.loadEnvFile?.('.env');
  const apply = process.argv.includes('--apply');
  const log = (line: string) =>
    console.log(`[migrate-earning-rules-into-cohorts] ${line}`);

  // autoIndex / autoCreate off: this script never builds an index on the shared host.
  const conn = await mongoose
    .createConnection(process.env.MONGODB_URI ?? '', {
      dbName: process.env.MONGODB_DB_NAME,
      autoIndex: false,
      autoCreate: false,
    })
    .asPromise();
  try {
    const db = conn.db!;
    const cohortsNow = await db
      .collection<Cohort>(COHORTS)
      .find({}, { projection: { _id: 1, name: 1, status: 1, rules: 1 } })
      .sort({ _id: 1 })
      .toArray();
    const exists =
      (await db.listCollections({ name: OLD }, { nameOnly: true }).toArray())
        .length > 0;
    if (!exists) {
      // Already migrated and dropped: say what the cohorts hold, change nothing.
      log(`${OLD} does not exist — nothing to migrate (already dropped?).`);
      for (const c of cohortsNow) {
        const rules = c.rules ?? [];
        const active = rules.filter((r) => r.status === 'active').length;
        const off = rules.filter((r) => r.enabled === false).length;
        log(
          `${c._id} (${c.status}) "${c.name}": ${rules.length} embedded ` +
            `(${active} active, ${off} switched off)${c.rules ? '' : ' — no rules field'}.`,
        );
      }
      log('nothing written.');
      return;
    }
    const oldRules = await db
      .collection<OldRule>(OLD)
      .find()
      .sort({ cohort_id: 1, order: 1, _id: 1 })
      .toArray();
    const cohorts = cohortsNow;
    const active = oldRules.filter((r) => r.status === 'active').length;
    log(
      `${OLD}: ${oldRules.length} rules (${active} active, ${oldRules.length - active} archived); ` +
        `${COHORTS}: ${cohorts.length} cohorts.`,
    );

    const known = new Set(cohorts.map((c) => c._id));
    const orphans = oldRules.filter((r) => !known.has(r.cohort_id));
    for (const r of orphans) {
      log(
        `⚠ rule ${r._id} "${r.name}" names cohort ${r.cohort_id}, which does not exist — left out.`,
      );
    }

    // A rule id is unique across cohorts (unique index on rules._id).
    const holder = new Map<string, string>();
    for (const c of cohorts) {
      for (const r of c.rules ?? []) {
        const other = holder.get(r._id);
        if (other) log(`⚠ rule ${r._id} is in both ${other} and ${c._id}.`);
        holder.set(r._id, c._id);
      }
    }

    let writes = 0;
    let raced = 0;
    for (const c of cohorts) {
      const mine = oldRules.filter((r) => r.cohort_id === c._id);
      const p = plan(c.rules ?? [], mine);
      const change = p.added.length + p.replaced.length;
      log(
        `${c._id} (${c.status}) "${c.name}": ${c.rules?.length ?? 'no'} embedded now` +
          `${c.rules ? '' : ' (no rules field)'}, ${mine.length} in ${OLD} → ` +
          `add ${p.added.length}, replace ${p.replaced.length}, keep ${p.kept}` +
          ` → ${p.rules.length} after.`,
      );
      for (const id of p.added) log(`  + ${id}`);
      for (const id of p.replaced) log(`  ~ ${id} (older version embedded)`);
      for (const id of p.differs) {
        log(`  ⚠ ${id}: same version, different content — the cohort's kept`);
      }
      if (!apply || change === 0) continue;
      const r = await db
        .collection<Cohort>(COHORTS)
        .updateOne(
          c.rules === undefined
            ? { _id: c._id, rules: { $exists: false } }
            : { _id: c._id, rules: c.rules },
          { $set: { rules: p.rules } },
        );
      if (r.modifiedCount === 1) writes += 1;
      else {
        raced += 1;
        log(`  ⚠ ${c._id} changed since it was read — not written; run again.`);
      }
    }

    // What the counts should say once applied: every old rule with a cohort is embedded.
    const after = apply
      ? await db
          .collection<Cohort>(COHORTS)
          .find({}, { projection: { rules: 1 } })
          .toArray()
      : null;
    if (after) {
      const ids = new Set(
        after.flatMap((c) => (c.rules ?? []).map((r) => r._id)),
      );
      const missing = oldRules.filter(
        (r) => known.has(r.cohort_id) && !ids.has(r._id),
      );
      log(
        `check: ${oldRules.length - orphans.length - missing.length} of ` +
          `${oldRules.length - orphans.length} rules of ${OLD} (with a cohort) are embedded; ` +
          `${ids.size} embedded in all.`,
      );
      for (const r of missing) log(`  ⚠ not embedded: ${r._id}`);
    }
    log(
      apply
        ? `written: ${writes} cohorts${raced ? `, ${raced} changed meanwhile` : ''}. ${OLD} left as it is.`
        : 'dry run — nothing written (add --apply).',
    );
    if (orphans.length)
      log(`${orphans.length} rule(s) without a cohort — see above.`);
  } finally {
    await conn.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
