/**
 * One-off: farmers saved before the radar existed have no place. This puts
 * each at their pincode's centre (`pincode_map_v2`; an off-district point is
 * replaced by the district's centre) — approximate, replaced by a GPS fix the
 * next time the partner adds, visits or orders for them. It also re-centres
 * farmers placed only by pincode; a GPS place is never touched. Only
 * `vistaar_v2_leads`; running it again changes nothing.
 *
 *   node dist/scripts/backfill-lead-location.js            # dry run — writes nothing
 *   node dist/scripts/backfill-lead-location.js --apply    # places them
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { LeadsService } from '../modules/leads/services/leads.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const placed = await app.get(LeadsService).placeByPincode(apply);
    console.log(
      `[backfill-lead-location] ${placed} farmer(s) ${apply ? 'placed' : 'to place'}.` +
        (apply ? '' : ' Dry run — nothing written. Re-run with --apply.'),
    );
  } finally {
    await app.close();
  }
}

// On a beta host whose index builds hang, the pool never drains and the
// process would sit there after the work is done.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
