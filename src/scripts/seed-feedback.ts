/**
 * Test data for the Feedback desk: NPS answers and "Suggest a product" rows
 * from the partners already on `vistaar_v2_agents`, spread over the last 30
 * days, so the HO dashboard, call-back queue and "most asked-for" list have
 * something to show. Every row is tagged `seed: 'feedback-test'`.
 *
 *   node dist/scripts/seed-feedback.js            # dry run — writes nothing
 *   node dist/scripts/seed-feedback.js --apply    # adds the test rows
 *   node dist/scripts/seed-feedback.js --remove   # deletes every tagged row
 *
 * Beta only — never on production. Runs once: with tagged rows already there
 * it stops, so a second --apply cannot double the dashboard.
 */
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';

import { AppModule } from '../app.module';
import { CountersService } from '../modules/counters/services/counters.service';
import {
  DEFAULT_NPS_REASONS,
  followUpDueAt,
  formatSuggestionRef,
  npsBucket,
  productKey,
} from '../modules/feedback/feedback.domain';
import type {
  FollowUp,
  PartnerSnapshot,
} from '../modules/feedback/schemas/feedback.schema';
import { refuseUnlessTestDb } from './test-db-guard';

const TAG = 'feedback-test';
const BY = 'seed:feedback';
const DAYS = 30;
const ANSWERS = 45;
const PARTNERS_MAX = 10;
const DAY_MS = 86_400_000;

/** Weighted so the NPS lands around +20 — a believable programme, not a perfect one. */
const SCORES = [0, 2, 3, 4, 5, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10];

const COMMENTS: Record<'detractor' | 'passive' | 'promoter', string[]> = {
  detractor: [
    'Delivery to my village takes more than a week.',
    'Commission for September is still not credited.',
    'Neem oil was out of stock three times this month.',
    'Officer does not pick up the phone.',
    'मेरे गाँव में डिलीवरी बहुत देर से आती है।',
  ],
  passive: [
    'Good products, but farmers want more bio-fungicides.',
    'Payout takes too long to reach the bank.',
    'Please add training videos in Hindi.',
    '',
  ],
  promoter: [
    'Farmers are very happy with the results on chilli.',
    'Easy to place orders for my customers.',
    'My officer helps me every week. Thank you!',
    'कमीशन समय पर मिलता है, बहुत अच्छा।',
    '',
  ],
};

const SUGGESTIONS = [
  {
    product: 'Emamectin benzoate 5% SG',
    crop: 'Chilli',
    monthly_demand: '50 packs',
    note: 'Farmers buy Missile at ₹450 today.',
  },
  {
    product: 'emamectin  benzoate 5% sg',
    crop: 'Cotton',
    monthly_demand: '30 packs',
    note: null,
  },
  {
    product: 'Emamectin Benzoate 5% SG',
    crop: 'Brinjal',
    monthly_demand: '20 packs',
    note: null,
  },
  {
    product: 'Thiamethoxam 25% WG',
    crop: 'Paddy',
    monthly_demand: '40 packs',
    note: 'Actara is the brand used here.',
  },
  {
    product: 'Thiamethoxam 25% WG',
    crop: 'Wheat',
    monthly_demand: null,
    note: null,
  },
  {
    product: 'Seaweed extract granules',
    crop: 'Potato',
    monthly_demand: '100 kg',
    note: 'Price they pay ₹180/kg.',
  },
  {
    product: 'Pheromone traps for fruit fly',
    crop: 'Mango',
    monthly_demand: '200 traps',
    note: null,
  },
  {
    product: 'Mancozeb 75% WP',
    crop: 'Tomato',
    monthly_demand: '25 kg',
    note: 'Dithane is common.',
  },
  {
    product: 'Humic acid 98% flakes',
    crop: null,
    monthly_demand: '10 kg',
    note: null,
  },
  {
    product: 'Trichoderma viride 1% WP',
    crop: 'Sugarcane',
    monthly_demand: '60 kg',
    note: 'Farmers ask for a bio option.',
  },
  {
    product: 'Pheromone traps for fruit fly',
    crop: 'Guava',
    monthly_demand: '150 traps',
    note: null,
  },
  {
    product: 'Sulphur 80% WDG',
    crop: 'Grapes',
    monthly_demand: null,
    note: null,
  },
];
const SUGGESTION_STATUS = [
  'new',
  'new',
  'new',
  'reviewed',
  'planned',
  'declined',
] as const;

/** Same data on every run, so the dry run shows what --apply will write. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

interface AgentRow {
  agent_id: string;
  phone: string;
  cohort?: string | null;
  owner_agent_id?: string | null;
  profile?: { name?: string; district?: string; state?: string } | null;
  preview?: { name?: string; district?: string; state?: string } | null;
}

function snapshot(a: AgentRow): PartnerSnapshot {
  return {
    name: a.profile?.name ?? a.preview?.name ?? null,
    phone: a.phone,
    cohort: a.cohort ?? null,
    district: a.profile?.district ?? a.preview?.district ?? null,
    state: a.profile?.state ?? a.preview?.state ?? null,
    owner_agent_id: a.owner_agent_id ?? null,
  };
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  refuseUnlessTestDb();
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const log = (line: string) => console.log(`[seed-feedback] ${line}`);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get<Connection>(getConnectionToken());
  const feedback = db.collection('vistaar_v2_feedback');
  const suggestions = db.collection<{ _id: string }>(
    'vistaar_v2_product_suggestions',
  );

  try {
    if (remove) {
      const f = await feedback.deleteMany({ seed: TAG });
      const s = await suggestions.deleteMany({ seed: TAG });
      log(
        `Removed ${f.deletedCount} answers and ${s.deletedCount} suggestions.`,
      );
      return;
    }

    const already =
      (await feedback.countDocuments({ seed: TAG }, { limit: 1 })) +
      (await suggestions.countDocuments({ seed: TAG }, { limit: 1 }));
    if (already > 0) {
      log(
        'Test rows are already there. Run with --remove first to start over.',
      );
      return;
    }

    const agents = await db
      .collection<AgentRow>('vistaar_v2_agents')
      .find(
        { agent_id: { $type: 'string' }, otp_verified: true },
        {
          projection: {
            agent_id: 1,
            phone: 1,
            cohort: 1,
            owner_agent_id: 1,
            profile: 1,
            preview: 1,
          },
        },
      )
      .sort({ created_at: -1 })
      .limit(PARTNERS_MAX)
      .toArray();
    if (agents.length === 0) {
      log(
        'No verified partner (VST- id) on vistaar_v2_agents — sign one up first.',
      );
      return;
    }
    log(
      `Using ${agents.length} partner(s): ${agents.map((a) => a.agent_id).join(', ')}`,
    );

    const rand = rng(20261014);
    const pick = <T>(list: readonly T[]): T =>
      list[Math.floor(rand() * list.length)];
    const now = Date.now();

    const answers = Array.from({ length: ANSWERS }, () => {
      const agent = pick(agents);
      const partner = snapshot(agent);
      const nps = pick(SCORES);
      const bucket = npsBucket(nps);
      const chips = DEFAULT_NPS_REASONS[bucket].chips;
      const reasons = [...new Set([pick(chips), pick(chips)])].slice(
        0,
        1 + Math.floor(rand() * 2),
      );
      const created = new Date(now - Math.floor(rand() * DAYS * DAY_MS));
      let follow_up: FollowUp | null = null;
      if (bucket === 'detractor') {
        const due = followUpDueAt(created);
        // Older call-backs are mostly made; recent ones open; a few left overdue.
        const done = due.getTime() < now && rand() < 0.6;
        follow_up = {
          status: done ? 'done' : 'open',
          due_at: due,
          owner_agent_id: partner.owner_agent_id,
          note: done ? 'Called the partner; issue passed to the team.' : null,
          done_by: done ? BY : null,
          done_at: done ? new Date(Math.min(due.getTime(), now)) : null,
        };
      }
      const comment = pick(COMMENTS[bucket]) || null;
      return {
        _id: new Types.ObjectId(),
        agent_id: agent.agent_id,
        partner,
        nps,
        bucket,
        reasons,
        comment,
        rating:
          rand() < 0.75 ? Math.max(1, Math.min(5, Math.round(nps / 2))) : null,
        follow_up,
        seed: TAG,
        created_at: created,
        updated_at: follow_up?.done_at ?? created,
      };
    });

    const counts = { detractor: 0, passive: 0, promoter: 0 };
    for (const a of answers) counts[a.bucket] += 1;
    const open = answers.filter((a) => a.follow_up?.status === 'open').length;
    log(
      `${answers.length} answers over ${DAYS} days — detractor ${counts.detractor}, ` +
        `passive ${counts.passive}, promoter ${counts.promoter}; ${open} open call-back(s).`,
    );
    log(
      `${SUGGESTIONS.length} product suggestions (some the same product typed differently).`,
    );

    if (!apply) {
      log('Dry run — nothing written. Re-run with --apply.');
      return;
    }

    await feedback.insertMany(answers);

    const counters = app.get(CountersService);
    const rows = [];
    for (const s of SUGGESTIONS) {
      const agent = pick(agents);
      const created = new Date(now - Math.floor(rand() * DAYS * DAY_MS));
      const status = pick(SUGGESTION_STATUS);
      const product = s.product.trim().replace(/\s+/g, ' ');
      rows.push({
        _id: formatSuggestionRef(await counters.nextSuggestionNumber()),
        agent_id: agent.agent_id,
        partner: snapshot(agent),
        product,
        product_key: productKey(product),
        crop: s.crop,
        monthly_demand: s.monthly_demand,
        note: s.note,
        status,
        ho_note: status === 'new' ? null : 'Test note from the product team.',
        updated_by: status === 'new' ? null : BY,
        seed: TAG,
        created_at: created,
        updated_at: created,
      });
    }
    await suggestions.insertMany(rows);
    log(
      `Applied: ${answers.length} answers, ${rows.length} suggestions (${rows[0]._id}…${rows[rows.length - 1]._id}).`,
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
    console.error(error);
    process.exit(1);
  },
);
