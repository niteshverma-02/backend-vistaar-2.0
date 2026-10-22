/**
 * One-off: the FAQ sections move into `vistaar_v2_faqs`, next to the FAQs, as
 * `kind: 'section'` rows with the same `_id` (the key); the FAQs already there
 * get `kind: 'faq'`. After it the code reads only `vistaar_v2_faqs`.
 *
 *   node dist/scripts/migrate-faqs-merge.js            # dry run — writes nothing
 *   node dist/scripts/migrate-faqs-merge.js --apply    # tags and copies
 *
 * Running it again changes nothing, except what the old code wrote in
 * between: a FAQ it added (no `kind`) is tagged, a section it added is
 * copied, one it edited (newer `updated_at`) replaces the copy. It never
 * deletes and never drops `vistaar_v2_faq_sections` — that is a later, manual
 * step (docs/PROD-CHECKLIST.md). It does not boot the API and builds no index:
 * `--apply` refuses while the pre-merge unique `{q_key}` index is there, since
 * every section after the first would break it on `null`.
 */
import mongoose from 'mongoose';

import {
  blockers,
  isDone,
  mergePlan,
  type StoredIndex,
  type StoredRow,
} from './faqs-merge-plan';

const OLD = 'vistaar_v2_faq_sections';
const MERGED = 'vistaar_v2_faqs';

async function main() {
  process.loadEnvFile?.('.env');
  const apply = process.argv.includes('--apply');
  const log = (line: string) => console.log(`[migrate-faqs-merge] ${line}`);

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
    const oldRows = db.collection<StoredRow>(OLD);
    const mergedRows = db.collection<StoredRow>(MERGED);
    const read = async () => {
      const [sections, merged] = await Promise.all([
        oldRows.find().toArray(),
        mergedRows.find().toArray(),
      ]);
      const indexes = (await db.listCollections({ name: MERGED }).hasNext())
        ? ((await mergedRows.indexes()) as StoredIndex[])
        : [];
      return { sections, merged, indexes };
    };
    const counts = (merged: StoredRow[]) => {
      const n = (kind?: string) => merged.filter((r) => r.kind === kind).length;
      return `${n('section')} section(s), ${n('faq')} faq(s), ${n()} untagged`;
    };

    const before = await read();
    log(`${OLD}: ${before.sections.length} section(s)`);
    log(`${MERGED}: ${before.merged.length} row(s) — ${counts(before.merged)}`);
    log(
      `${MERGED} indexes: ${
        before.indexes
          .map(
            (i) =>
              `${i.name}${i.unique ? ' unique' : ''}${
                i.partialFilterExpression
                  ? ` partial ${JSON.stringify(i.partialFilterExpression)}`
                  : ''
              }`,
          )
          .join(' · ') || 'none'
      }`,
    );

    const plan = mergePlan(before.sections, before.merged, before.indexes);
    log(`tag kind: 'faq' on ${plan.tagFaqs.length} FAQ(s)`);
    log(
      `copy ${plan.insert.length} section(s)${
        plan.insert.length
          ? `: ${plan.insert.map((s) => s._id).join(', ')}`
          : ''
      }`,
    );
    log(
      `refresh ${plan.replace.length} section(s) edited since the copy${
        plan.replace.length
          ? `: ${plan.replace.map((r) => r.row._id).join(', ')}`
          : ''
      }`,
    );
    log(`${plan.unchanged.length} section(s) already copied, unchanged`);
    if (plan.onlyMerged.length) {
      log(
        `only in ${MERGED} (added since, or deleted in ${OLD} since — left as they are): ${plan.onlyMerged.join(', ')}`,
      );
    }
    const stop = blockers(plan);
    for (const reason of stop) log(`BLOCKED: ${reason}`);

    if (!apply) {
      log('dry run — nothing written (add --apply).');
      return;
    }
    if (stop.length) throw new Error('Not applied: see BLOCKED above.');
    if (isDone(plan)) {
      log('nothing to do — already merged.');
      return;
    }

    // Only rows that are still untagged, so a re-run touches nothing.
    const tagged = await mergedRows.updateMany(
      { _id: { $in: plan.tagFaqs }, kind: { $exists: false } },
      { $set: { kind: 'faq' } },
    );
    log(`tagged ${tagged.modifiedCount} FAQ(s)`);

    let copied = 0;
    for (const { _id, ...rest } of plan.insert) {
      const r = await mergedRows.updateOne(
        { _id },
        { $setOnInsert: { kind: 'section', ...rest } },
        { upsert: true },
      );
      copied += r.upsertedCount;
    }
    log(`copied ${copied} section(s)`);

    let refreshed = 0;
    for (const { row, seen } of plan.replace) {
      const { _id, ...rest } = row;
      // Only the copy as read: an HO edit made since through the new code wins.
      const r = await mergedRows.replaceOne(
        { _id, kind: 'section', updated_at: seen },
        { kind: 'section', ...rest },
      );
      refreshed += r.modifiedCount;
    }
    log(`refreshed ${refreshed} section(s)`);

    const after = await read();
    const missing = after.sections.filter(
      (s) => !after.merged.some((r) => r._id === s._id && r.kind === 'section'),
    );
    log(
      `${MERGED} now: ${after.merged.length} row(s) — ${counts(after.merged)}`,
    );
    log(
      missing.length
        ? `NOT every section is in ${MERGED}: ${missing.map((s) => s._id).join(', ')}`
        : `every one of the ${after.sections.length} section(s) in ${OLD} is in ${MERGED}. ${OLD} is left for a manual drop.`,
    );
  } finally {
    await conn.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
