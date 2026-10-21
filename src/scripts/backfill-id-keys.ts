/**
 * One-off: onboarding rows saved before the Aadhaar / PAN duplicate check have
 * no `id_keys`, so the check cannot see them. This fills `id_keys` from each
 * row's `raw_data` (Aadhaar as a hash, PAN upper case) and prints every
 * Aadhaar / PAN that more than one partner holds — agent ids only, never the
 * number. Only `vistaar_v2_onboarding_data`; running it again changes nothing.
 *
 *   node dist/scripts/backfill-id-keys.js            # dry run — writes nothing
 *   node dist/scripts/backfill-id-keys.js --apply    # fills id_keys
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { OnboardingService } from '../modules/onboarding/services/onboarding.service';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[backfill-id-keys] ${line}`);

  try {
    const result = await app.get(OnboardingService).backfillIdKeys(apply);
    for (const group of result.duplicates)
      log(`duplicate ${group.kind}: ${group.agent_ids.join(', ')}`);
    log(
      `${result.scanned} row(s) read, ${result.changed} ${apply ? 'filled' : 'to fill'}` +
        (result.skipped
          ? `, ${result.skipped} skipped (saved meanwhile)`
          : '') +
        `, ${result.duplicates.length} duplicate group(s).` +
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
