/**
 * One Node process uses about one CPU core; load tests put a single process
 * at ~500 partner requests/s. This runs one worker per core (or
 * `WEB_CONCURRENCY`) on the same port — the OS spreads connections — and
 * replaces a worker that dies.
 *
 *   pnpm build && pnpm start:cluster
 *
 * On Kubernetes, prefer one process per pod (`pnpm start:prod`) and scale
 * pods instead. Caches and the per-partner request limit live in each
 * process's memory; OTP attempt counts are shared through Mongo.
 */
import cluster from 'node:cluster';
import { availableParallelism } from 'node:os';

import { clusterWorkerCount } from './config/env.schema';

/** A worker that keeps dying is restarted at most this often. */
const RESTART_DELAY_MS = 1_000;

if (cluster.isPrimary) {
  const workers = clusterWorkerCount(availableParallelism());
  console.log(`[cluster] starting ${workers} workers`);
  for (let i = 0; i < workers; i++) cluster.fork();

  let stopping = false;
  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return;
    console.error(
      `[cluster] worker ${worker.process.pid} exited (${signal ?? code}); restarting`,
    );
    setTimeout(() => cluster.fork(), RESTART_DELAY_MS);
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      stopping = true;
      for (const worker of Object.values(cluster.workers ?? {})) {
        worker?.process.kill(signal);
      }
    });
  }
} else {
  void import('./main.js');
}
