/**
 * Dummy TEST merchant keys for every payment option that has none, so a
 * developer can see the portal's keys flow and the app's Pay online list
 * without a real gateway account:
 *
 *   node dist/scripts/seed-test-payment-keys.js            # dry run — writes nothing
 *   node dist/scripts/seed-test-payment-keys.js --apply    # submits and approves them
 *
 * Refused in production. The keys are made up: they are sealed with this
 * machine's PAYMENTS_CREDENTIALS_KEY and go through the normal submit and
 * approve (two seed identities); only the gateway check is skipped, since
 * made-up keys cannot pass it — the check row says so. Real test keys are
 * entered in the portal instead, and replace these on approval.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import type { CredentialMode } from '../modules/payments/payment-credentials.domain';
import type { PaymentProvider } from '../modules/payments/payments.domain';
import { PaymentCredentialRepository } from '../modules/payments/repositories/payment-credential.repository';
import { PaymentCredentialsService } from '../modules/payments/services/payment-credentials.service';

const SUBMITTER = 'seed:payment-keys-submit';
const APPROVER = 'seed:payment-keys-approve';
const MODE: CredentialMode = 'test';

const DUMMY: Record<PaymentProvider, Record<string, string>> = {
  razorpay: {
    key_id: 'rzp_test_VistaarSeed01',
  },
  cashfree: {
    app_id: 'TESTVistaarSeed01',
    secret_key: 'cfsk_ma_test_seed_only_local_0001',
  },
  phonepe: {
    client_id: 'TESTVISTAARSEED',
    client_version: '1',
    client_secret: 'seed-only-local-client-secret-01',
  },
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const log = (line: string) => console.log(`[seed-test-payment-keys] ${line}`);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refused: dummy payment keys are never seeded in production.',
    );
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const keys = app.get(PaymentCredentialsService);
  const repo = app.get(PaymentCredentialRepository);

  try {
    const overview = await keys.overview();
    if (!overview.storage_ready) {
      throw new Error('PAYMENTS_CREDENTIALS_KEY is not set in .env.');
    }
    for (const p of overview.providers) {
      if (p.active || p.pending) {
        log(
          `${p.provider}: has keys (${p.active ? 'live' : 'waiting'}) — left alone`,
        );
        continue;
      }
      if (!apply) {
        log(`${p.provider}: would add dummy test keys`);
        continue;
      }
      const sent = await keys.submit(
        p.provider,
        {
          mode: MODE,
          fields: DUMMY[p.provider],
          note: 'Dummy test keys (seed script)',
        },
        SUBMITTER,
      );
      await repo.setTest(sent.id, {
        ok: true,
        message: 'Seed script: dummy keys, the gateway was not called.',
        by: SUBMITTER,
        at: new Date(),
      });
      const live = await keys.approve(sent.id, APPROVER);
      log(`${p.provider}: dummy test keys live (${live.id})`);
    }
    if (!apply) log('dry run — nothing written. Add --apply to write.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
