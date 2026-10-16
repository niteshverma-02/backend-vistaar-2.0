/**
 * One-off: partners saved or approved before the onboarding form took state
 * and district from the pincode keep what was typed ("MADHYA", "madh"). This
 * puts the pincode's state and district (`pincode_map_v2`) on their `preview`
 * and, once approved, `profile`. Only `vistaar_v2_agents` (and, when it
 * corrected anyone, the earning-cohort assignments that follow from the
 * profile); an unknown pincode is left alone; running it again changes nothing.
 *
 *   node dist/scripts/backfill-partner-place.js            # dry run — writes nothing
 *   node dist/scripts/backfill-partner-place.js --apply    # corrects them
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import {
  AgentsService,
  type AgentRecord,
} from '../modules/agents/services/agents.service';
import { EarningCohortsService } from '../modules/earning/services/earning-cohorts.service';
import { PincodeService } from '../modules/spine/services/pincode.service';

const PAGE = 200;

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[backfill-partner-place] ${line}`);
  const agents = app.get(AgentsService);
  const pincodes = app.get(PincodeService);

  try {
    let changed = 0;
    for (let skip = 0; ; skip += PAGE) {
      const { items } = await agents.list(
        {},
        { skip, limit: PAGE, sort: { _id: 1 } },
      );
      for (const agent of items) {
        const fix = await placeFix(agent, pincodes);
        if (!fix) continue;
        changed += 1;
        log(`${agent.agent_id ?? agent._id}: ${JSON.stringify(fix)}`);
        if (apply) await agents.setPlace(agent, fix);
      }
      if (items.length < PAGE) break;
    }
    log(
      `${changed} partner(s) ${apply ? 'corrected' : 'to correct'}.` +
        (apply ? '' : ' Dry run — nothing written. Re-run with --apply.'),
    );
    if (apply && changed > 0) {
      // A corrected state / district can move partners to another earning cohort.
      const moved = await app
        .get(EarningCohortsService)
        .recomputeAll('profile_changed');
      log(`Earning cohorts: ${moved.changed} partner(s) moved.`);
    }
  } finally {
    await app.close();
  }
}

/** What differs from the pincode's place, or `null` when nothing does. */
async function placeFix(
  agent: AgentRecord,
  pincodes: PincodeService,
): Promise<{ state?: string; district?: string } | null> {
  const pincode = agent.profile?.pincode ?? agent.preview?.pincode;
  if (typeof pincode !== 'string') return null;
  const place = await pincodes.lookup(pincode.trim());
  if (!place) return null;
  // Both copies: the desk reads `preview`, everything after approval `profile`.
  const copies = [agent.preview, agent.profile].filter(
    (c): c is NonNullable<typeof c> => c != null,
  );
  const fix: { state?: string; district?: string } = {};
  for (const key of ['state', 'district'] as const) {
    const value = place[key];
    if (value && copies.some((c) => c[key] !== value)) fix[key] = value;
  }
  return Object.keys(fix).length > 0 ? fix : null;
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
