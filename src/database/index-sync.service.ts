import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { Env } from '@config/env.schema';

/** Only the collections this service created outright. */
const V2_COLLECTION_PREFIX = 'vistaar_v2_';

/** Marks our builds, so a timed-out one can be found and killed — only ours. */
const BUILD_TAG = 'vistaar-index-sync:';

/**
 * How long one collection's build may take before boot moves on without it.
 *
 * A healthy build on these collections is milliseconds. Anything past this is
 * not slow, it is stuck.
 */
const INDEX_BUILD_TIMEOUT_MS = 15_000;

/**
 * Builds the indexes the v2 schemas declare, and **says so when it cannot**.
 *
 * Mongoose's own `autoIndex` does this at model compile time, but in the
 * background and swallowing the outcome: the first index that fails ends the
 * run and nothing is logged. On a shared database that is how a collection
 * ends up live with only `_id_`, and every duplicate guard it was designed
 * around silently missing (prasar-backend hit exactly this).
 *
 * Three deliberate limits:
 *
 * - **`createIndexes()`, never `syncIndexes()`.** `syncIndexes()` drops
 *   indexes a schema does not declare, and `CRM-Database` is shared with
 *   ko-sales, Stockship and every other portal.
 * - **`vistaar_v2_*` only.** Shared collections (`piis`, `leads_v2`,
 *   `addresses`, …) are not ours to reindex at boot.
 * - **Every build is time-boxed.** This hook runs before `app.listen()`, so a
 *   build that never returns is a server that never binds its port. When the
 *   beta Mongo host ran out of disk, `createIndexes()` stopped answering rather
 *   than failing.
 * - **Only missing indexes, and a timed-out build is killed.** Mongo runs a
 *   few index builds at a time for the whole server and queues the rest; the
 *   queue outlives the client and `maxTimeMS`. When another app's build
 *   wedged the shared beta host, every restart left ~27 more builds of ours
 *   waiting there (969 by 2026-10-16), each one longer in line than the last.
 *
 * Outside production only. There an index build belongs in a migration, run
 * against live data deliberately (listed in `docs/PROD-CHECKLIST.md`).
 */
@Injectable()
export class IndexSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IndexSyncService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') return;

    // Concurrently: the timeout is per collection, so run serially a wedged
    // host charges boot the *sum* of them. Seven collections at fifteen
    // seconds is nearly two minutes of unbound port on every restart.
    await Promise.all(
      this.connection.modelNames().map(async (name) => {
        const model = this.connection.model(name);
        const collection = model.collection.name;

        if (!collection.startsWith(V2_COLLECTION_PREFIX)) return;

        const tag = `${BUILD_TAG}${collection}`;
        try {
          // Nothing missing → no build queued at all. On a healthy host this
          // is every restart after the first.
          const { toCreate } = await this.withTimeout(
            model.diffIndexes(),
            collection,
          );
          if (!toCreate.length) return;

          // `maxTimeMS` asks the server to give up; the race enforces it when
          // the server is too wedged to notice its own deadline.
          await this.withTimeout(
            model.createIndexes({
              maxTimeMS: INDEX_BUILD_TIMEOUT_MS,
              comment: tag,
            }),
            collection,
          );
        } catch (error) {
          await this.killBuild(tag);
          // Loud on purpose. A unique index that will not build is nearly
          // always duplicate rows already in the collection — which is exactly
          // the condition the index was meant to stop, so it has to be read by
          // a human rather than retried forever.
          this.logger.error(
            `Index build failed for ${collection}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  /**
   * Takes our timed-out build back out of Mongo's queue, so the next restart
   * does not stand behind it. Best effort: a user may kill only its own ops,
   * and the filter is our tag, so nothing of another app's is touched.
   */
  private async killBuild(tag: string): Promise<void> {
    const admin = this.connection.db?.admin();
    if (!admin) return;
    try {
      const { inprog } = (await admin.command({
        currentOp: 1,
        $ownOps: true,
        'command.comment': tag,
      })) as { inprog: { opid: unknown }[] };
      await Promise.all(
        inprog.map((op) => admin.command({ killOp: 1, op: op.opid })),
      );
    } catch {
      // Left queued; it only builds an index we declared anyway.
    }
  }

  /**
   * Rejects once the deadline passes, leaving the original build to finish or
   * fail on its own — detached, but never unhandled, since an unhandled
   * rejection arriving minutes later would take the process down long after
   * boot had recovered from it.
   */
  private async withTimeout<T>(
    build: Promise<T>,
    collection: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `no answer in ${INDEX_BUILD_TIMEOUT_MS}ms — Mongo's index-build ` +
                `queue is stuck (another build is wedged) or the host is out ` +
                `of disk; ${collection} still has only the indexes it already ` +
                `had, and the queued build was cancelled`,
            ),
          ),
        INDEX_BUILD_TIMEOUT_MS,
      );
      // Boot must not be held open by this timer alone.
      timer.unref();
    });

    build.catch(() => undefined);

    try {
      return await Promise.race([build, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }
}
