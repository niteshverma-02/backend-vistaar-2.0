/**
 * Test farmers for the Vistaar leads flows — beta and local only, never
 * production. Partners are the two approved ones beta has (VST-000006,
 * VST-000007); farmers use the mobiles 6000000101–6000000115 (the
 * `60000xxxxx` series is test data). Who is for what: docs/TEST-DATA.md.
 *
 *   node dist/scripts/seed-test-leads.js            # dry run — writes nothing
 *   node dist/scripts/seed-test-leads.js --apply    # adds the missing farmers
 *
 * Runs through `LeadsService`, the API's own code, so every row has the
 * production shape. A farmer already there is skipped. Times the API cannot
 * make — a follow-up already passed, a lead nobody worked for 16 days — are
 * then set on `vistaar_v2_leads`, only on a row this run created.
 *
 * The farmer's OTP (mandatory on lead add) cannot be answered by a test
 * farmer, so the run signs the token `POST /leads/otp/verify` would give —
 * with this server's own secret, and never in production.
 *
 * New farmers need an owner: one active Offline Head (USR-1037), or
 * `settings.lead_owner_agent_id`. Without one the run stops at the first new
 * farmer with LEADS_NOT_CONFIGURED.
 */
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import { AppModule } from '../app.module';
import type { PartnerRef } from '../common/auth/current-partner.decorator';
import type { Env } from '../config/env.schema';
import { AgentsService } from '../modules/agents/services/agents.service';
import type {
  AddActivityDto,
  AddFarmerDto,
} from '../modules/leads/dto/lead.dto';
import type { LeadStage } from '../modules/leads/leads.domain';
import { leadOtpKey, signLeadOtp } from '../modules/leads/lead-otp.domain';
import { LeadsService } from '../modules/leads/services/leads.service';

const BY = 'seed:test-leads';
const DAY_MS = 24 * 3600 * 1000;

type Move = Exclude<LeadStage, 'won' | 'lost'> | { lost: string };

interface TestFarmer {
  partner: string;
  /** What the farmer is there to test. */
  purpose: string;
  farmer: Omit<AddFarmerDto, 'consent_version'>;
  moves?: Move[];
  acts?: [AddActivityDto['type'], string][];
  /** A follow-up already passed — the API takes future ones only. */
  pastFollowUp?: string;
  /** Days since the partner last worked the farmer: the release clock. */
  idleDays?: number;
  /** HO moves the farmer to this partner right after it is added. */
  transferTo?: string;
}

/** `YYYY-MM-DDTHH:mm:00+05:30`, `days` from today in IST. */
function ist(days: number, hh: number, mm = 0): string {
  const day = new Date(Date.now() + 5.5 * 3600 * 1000 + days * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.toISOString().slice(0, 10)}T${pad(hh)}:${pad(mm)}:00+05:30`;
}

const FARMERS: TestFarmer[] = [
  {
    partner: 'VST-000006',
    purpose: 'contacted, follow-up tomorrow',
    farmer: {
      phone: '6000000101',
      name: 'Ramesh Patel',
      village: 'Rampur',
      pincode: '462026',
      crops: ['Wheat', 'Soybean'],
      acreage: 6,
      found_via: 'meeting',
      expected_value: 4500,
      next_follow_up: ist(1, 10),
      note: 'Asked about soybean seed treatment',
    },
    moves: ['contacted'],
    acts: [['call', 'Called — will decide after the rain']],
  },
  {
    partner: 'VST-000006',
    purpose: 'interested',
    farmer: {
      phone: '6000000102',
      name: 'Suresh Yadav',
      village: 'Kheda',
      pincode: '464001',
      crops: ['Chana'],
      acreage: 3.5,
      found_via: 'referral',
      expected_value: 2000,
      next_follow_up: ist(2, 11),
      note: 'Referred by Ramesh Patel',
    },
    moves: ['contacted', 'interested'],
    acts: [['visit', 'Showed the fungicide demo on his field']],
  },
  {
    partner: 'VST-000006',
    purpose: 'negotiation',
    farmer: {
      phone: '6000000103',
      name: 'Mahesh Kushwaha',
      village: 'Ichhawar',
      pincode: '466001',
      crops: ['Wheat'],
      acreage: 12,
      found_via: 'walk_in',
      expected_value: 9000,
      next_follow_up: ist(3, 17),
    },
    moves: ['contacted', 'interested', 'negotiation'],
    acts: [
      ['whatsapp', 'Sent the price list for wheat inputs'],
      ['call', 'Wants 5% off on 10 bags'],
    ],
  },
  {
    partner: 'VST-000006',
    purpose: 'prospect, no follow-up',
    farmer: {
      phone: '6000000104',
      name: 'Dinesh Verma',
      village: 'Tarana',
      pincode: '456001',
      crops: ['Garlic', 'Onion'],
      acreage: 4,
      found_via: 'campaign',
    },
  },
  {
    partner: 'VST-000006',
    purpose: 'lost (with a reason)',
    farmer: {
      phone: '6000000105',
      name: 'Kamla Bai',
      village: 'Maksi',
      pincode: '465001',
      crops: ['Soybean'],
      acreage: 2,
      found_via: 'self',
      expected_value: 1500,
    },
    moves: ['contacted', { lost: 'Price too high' }],
    acts: [['call', 'Buys from the local dealer on credit']],
  },
  {
    partner: 'VST-000006',
    purpose: 'follow-up overdue',
    farmer: {
      phone: '6000000106',
      name: 'Rajendra Singh',
      village: 'Raghogarh',
      pincode: '473001',
      crops: ['Mustard', 'Wheat'],
      acreage: 20,
      found_via: 'meeting',
      expected_value: 15000,
      next_follow_up: ist(1, 12),
      note: 'Big farm — wants a field visit',
    },
    moves: ['contacted', 'interested'],
    acts: [['visit', 'Walked the mustard field, aphids seen']],
    pastFollowUp: ist(-1, 10),
  },
  {
    partner: 'VST-000006',
    purpose: 'follow-up due today',
    farmer: {
      phone: '6000000107',
      name: 'Gopal Meena',
      village: 'Rahatgarh',
      pincode: '470001',
      crops: ['Maize'],
      acreage: 8,
      found_via: 'referral',
      expected_value: 5000,
      next_follow_up: ist(1, 9),
    },
    moves: ['contacted'],
    acts: [['call', 'Call back in the morning']],
    pastFollowUp: ist(0, 9, 30),
  },
  {
    partner: 'VST-000006',
    purpose: 'prospect, follow-up in 5 days',
    farmer: {
      phone: '6000000108',
      name: 'Sunita Ahirwar',
      village: 'Sanwer',
      pincode: '453551',
      crops: ['Cotton'],
      acreage: 5,
      found_via: 'walk_in',
      next_follow_up: ist(5, 10),
      note: 'Came to the shop asking about pink bollworm',
    },
  },
  {
    partner: 'VST-000007',
    purpose:
      "another partner's farmer — VST-000006 gets other_partner / FARMER_TAKEN",
    farmer: {
      phone: '6000000109',
      name: 'Bhagwan Das',
      village: 'Berasia',
      pincode: '463106',
      crops: ['Wheat'],
      acreage: 7,
      found_via: 'meeting',
      expected_value: 3000,
      next_follow_up: ist(2, 10),
    },
  },
  {
    partner: 'VST-000007',
    purpose:
      'not worked for 16 days — VST-000006 gets released and can take it over',
    farmer: {
      phone: '6000000110',
      name: 'Lakshmi Patidar',
      village: 'Ashta',
      pincode: '466116',
      crops: ['Soybean', 'Wheat'],
      acreage: 9,
      found_via: 'referral',
      expected_value: 6000,
    },
    moves: ['contacted'],
    idleDays: 16,
  },
  {
    partner: 'VST-000007',
    purpose: 'moved by HO to VST-000006 — holder_history shows VST-000007',
    farmer: {
      phone: '6000000111',
      name: 'Om Prakash Lodhi',
      village: 'Sironj',
      pincode: '464228',
      crops: ['Chana'],
      acreage: 5,
      found_via: 'walk_in',
    },
    transferTo: 'VST-000006',
  },
  {
    partner: 'VST-000006',
    purpose: 'not worked for 13 days — the app warns "releases in 2 days"',
    farmer: {
      phone: '6000000112',
      name: 'Hari Ram Kirar',
      village: 'Nasrullaganj',
      pincode: '466331',
      crops: ['Maize'],
      acreage: 4,
      found_via: 'self',
      expected_value: 1200,
    },
    idleDays: 13,
  },
  // Home "Today's tasks" (GET /today) — three follow-ups to see on the card.
  {
    partner: 'VST-000006',
    purpose: "Today's tasks: follow-up 2 days overdue (red)",
    farmer: {
      phone: '6000000113',
      name: 'Vikram Chouhan',
      village: 'Sehore',
      pincode: '466001',
      crops: ['Soybean'],
      acreage: 7,
      found_via: 'meeting',
      expected_value: 3500,
      next_follow_up: ist(1, 10),
      note: 'Wants a quote for weedicide',
    },
    moves: ['contacted', 'interested'],
    acts: [['call', 'Asked to call back after two days']],
    pastFollowUp: ist(-2, 11),
  },
  {
    partner: 'VST-000006',
    purpose: "Today's tasks: follow-up due this morning",
    farmer: {
      phone: '6000000114',
      name: 'Ramvati Bai',
      village: 'Dewas',
      pincode: '455001',
      crops: ['Wheat'],
      acreage: 3,
      found_via: 'walk_in',
      expected_value: 1800,
      next_follow_up: ist(1, 9),
    },
    moves: ['contacted'],
    acts: [['visit', 'Visited the shop, asked about seed treatment']],
    pastFollowUp: ist(0, 9, 30),
  },
  {
    partner: 'VST-000006',
    purpose: "Today's tasks: follow-up due this evening",
    farmer: {
      phone: '6000000115',
      name: 'Prakash Dangi',
      village: 'Shujalpur',
      pincode: '465333',
      crops: ['Garlic'],
      acreage: 5,
      found_via: 'referral',
      expected_value: 6000,
      next_follow_up: ist(1, 18),
      note: 'Referred by Vikram Chouhan',
    },
    pastFollowUp: ist(0, 18),
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[seed-test-leads] ${line}`);

  try {
    const env = app.get(ConfigService<Env, true>);
    if (env.get('NODE_ENV', { infer: true }) === 'production') {
      throw new Error(
        'Test data is for beta and local only — not run in production.',
      );
    }
    const leads = app.get(LeadsService);
    const agents = app.get(AgentsService);
    const rows = app
      .get<Connection>(getConnectionToken())
      .collection('vistaar_v2_leads');

    const partners = new Map<string, PartnerRef>();
    for (const id of new Set(FARMERS.map((f) => f.partner))) {
      const agent = await agents.requireByAgentId(id);
      if (agent.stage !== 'approved' || !agent.pii_id) {
        throw new Error(`${id} must be an approved partner.`);
      }
      partners.set(id, { agent_id: id, pii_id: agent.pii_id });
    }
    const { version } = await leads.consent();
    const otpKey = leadOtpKey(env.get('VISTAAR_JWT_SECRET', { infer: true }));

    for (const f of FARMERS) {
      const partner = partners.get(f.partner) as PartnerRef;
      const { status } = await leads.check(partner, f.farmer.phone);
      if (status !== 'new') {
        log(
          `skip ${f.farmer.phone} ${f.farmer.name} (${f.partner}: ${status})`,
        );
        continue;
      }
      log(`${f.farmer.phone} ${f.farmer.name} → ${f.partner}: ${f.purpose}`);
      if (!apply) continue;

      const saved = await leads.upsert(partner, {
        ...f.farmer,
        consent_version: version,
        otp_token: signLeadOtp(otpKey, {
          agent_id: f.partner,
          phone: f.farmer.phone,
          verified_at: new Date(),
        }).otp_token,
      });
      for (const move of f.moves ?? []) {
        await leads.update(
          partner,
          saved.pii_id,
          typeof move === 'string'
            ? { stage: move }
            : { stage: 'lost', lost_reason: move.lost },
        );
      }
      for (const [type, text] of f.acts ?? []) {
        await leads.addActivity(partner, saved.pii_id, { type, text });
      }
      const set: Record<string, Date> = {};
      if (f.pastFollowUp) set.next_follow_up = new Date(f.pastFollowUp);
      if (f.idleDays) {
        const at = new Date(Date.now() - f.idleDays * DAY_MS);
        set.last_worked_at = at;
        set.held_since = at;
      }
      if (Object.keys(set).length > 0) {
        await rows.updateOne(
          { pii_id: saved.pii_id, agent_id: f.partner },
          { $set: set },
        );
      }
      if (f.transferTo) {
        await leads.transfer(
          saved.pii_id,
          { agent_id: f.transferTo, reason: 'Test data: moved by HO' },
          BY,
        );
      }
      log(`  ${saved.result} ${saved.pii_id} ${saved.lead_id ?? '-'}`);
    }
    log(apply ? 'Applied.' : 'Dry run — nothing written. Re-run with --apply.');
  } catch (error) {
    if (error instanceof HttpException) {
      const body = error.getResponse() as { error?: string; message?: string };
      const hint =
        body.error === 'LEADS_NOT_CONFIGURED'
          ? ' Beta needs one active Offline Head (USR-1037) to own new farmers — see docs/TEST-DATA.md.'
          : '';
      throw new Error(`${body.error}: ${body.message}${hint}`);
    }
    throw error;
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
