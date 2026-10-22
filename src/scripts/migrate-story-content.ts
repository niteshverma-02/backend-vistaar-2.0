/**
 * Copies My Story's four HO-content collections into the one that replaced
 * them, `vistaar_v2_story_content` (a `kind` per row, `_id` `<kind>:<id>`):
 *
 *   vistaar_v2_story_designs    → kind `design`
 *   vistaar_v2_story_festivals  → kind `festival`
 *   vistaar_v2_story_samples    → kind `sample`
 *   vistaar_v2_story_templates  → kind `template` (`key` = the card's old `_id`)
 *
 *   node dist/scripts/migrate-story-content.js            # dry run — writes nothing
 *   node dist/scripts/migrate-story-content.js --apply    # copies what is missing or newer
 *
 * Safe to run again: of two versions of one row the newer `updated_at` wins
 * (`story-content-copy.ts`), so a run before the deploy and one after it
 * leave every row as its last edit — except a deletion on the old screens in
 * between, which is not copied. A key another row already holds in the new
 * collection is reported, never overwritten.
 * Never drops or changes the old collections — that is a manual step once the
 * counts match (PROD-CHECKLIST). Builds no index: create the new collection's
 * by hand first, on production. Exits 1 when a row could not be copied.
 */
import mongoose from 'mongoose';

import type { StoryContentKind } from '../modules/stories/schemas/story-content.schema';
import {
  OLD_COLLECTIONS,
  planCopy,
  type ContentRow,
  type OldRow,
} from './story-content-copy';

const TARGET = 'vistaar_v2_story_content';

async function main() {
  process.loadEnvFile?.('.env');
  const apply = process.argv.includes('--apply');
  const log = (line: string) => console.log(`[migrate-story-content] ${line}`);

  // autoIndex / autoCreate off: this script never builds an index on the shared host.
  const conn = await mongoose
    .createConnection(process.env.MONGODB_URI ?? '', {
      dbName: process.env.MONGODB_DB_NAME,
      autoIndex: false,
      autoCreate: false,
    })
    .asPromise();
  let failed = 0;
  try {
    const db = conn.db!;
    const target = db.collection<ContentRow>(TARGET);
    log(`${apply ? 'apply' : 'dry run'} on ${db.databaseName}`);

    for (const [kind, source] of Object.entries(OLD_COLLECTIONS) as [
      StoryContentKind,
      string,
    ][]) {
      const oldRows = await db.collection<OldRow>(source).find({}).toArray();
      const current = await target.find({ kind }).toArray();
      const plan = planCopy(kind, oldRows, current);

      for (const row of plan.insert) {
        log(`${verb(apply, 'insert')} ${row._id} (key ${row.key})`);
      }
      for (const { row } of plan.replace) {
        log(`${verb(apply, 'replace')} ${row._id} — newer in ${source}`);
      }
      for (const id of plan.kept) {
        log(`keep ${id} — newer in ${TARGET}`);
      }
      for (const { id, reason } of plan.skipped) {
        log(`SKIP ${source} ${id}: ${reason}`);
      }
      failed += plan.skipped.length;

      if (apply) {
        for (const { _id, ...rest } of plan.insert) {
          await target.replaceOne({ _id }, rest, { upsert: true });
        }
        for (const {
          row: { _id, ...rest },
          was,
        } of plan.replace) {
          // Only over the version this run read: an HO edit since then stays.
          await target.replaceOne({ _id, updated_at: was }, rest);
        }
      }

      const after = apply
        ? await target.countDocuments({ kind })
        : current.length + plan.insert.length;
      log(
        `${kind}: ${source} ${oldRows.length} → ${TARGET} ${after}` +
          `${apply ? '' : ' (after apply)'} · insert ${plan.insert.length}` +
          ` · replace ${plan.replace.length} · unchanged ${plan.unchanged}` +
          ` · kept ${plan.kept.length} · skipped ${plan.skipped.length}`,
      );
    }
    log(
      apply
        ? 'copied. The old collections are untouched.'
        : 'dry run — nothing written (add --apply).',
    );
  } finally {
    await conn.close();
  }
  if (failed) {
    log(`${failed} row(s) not copied — see SKIP above.`);
    process.exitCode = 1;
  }
}

function verb(apply: boolean, action: 'insert' | 'replace'): string {
  return apply ? action : `would ${action}`;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
