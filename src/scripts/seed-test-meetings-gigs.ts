/**
 * Test meetings and gigs — beta and local only, never production. Five of
 * each for VST-000006 (the main test partner); who is for what:
 * docs/TEST-DATA.md.
 *
 *   node dist/scripts/seed-test-meetings-gigs.js            # dry run — writes nothing
 *   node dist/scripts/seed-test-meetings-gigs.js --apply    # writes (or refreshes) them
 *   node dist/scripts/seed-test-meetings-gigs.js --remove   # deletes exactly these rows
 *
 * Writes only `vistaar_v2_meetings` and `vistaar_v2_gigs`, by fixed test ids
 * (meetings `a0000000-…-00000000000N`, gigs `GIG-90000N`, outside the counter's
 * range), so a re-run refreshes them and `--remove` takes them out. It does
 * not boot the API: no index is built on the shared host, and the gig
 * counter is left alone. Dates are set from today, so a re-run moves them.
 */
import mongoose from 'mongoose';

import { refuseUnlessTestDb } from './test-db-guard';

const PARTNER = 'VST-000006';
const BY = 'seed:test-meetings-gigs';
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
/** Bhopal: where the test partner and farmers are. */
const VENUE = { lat: 23.2599, lng: 77.4126 };

const meetingId = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const gigId = (n: number) => `GIG-90000${n}`;

/** 10:00 IST on the day `days` from today. */
function istTen(days: number): Date {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * HOUR);
  const day = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
  );
  return new Date(day + days * DAY + 10 * HOUR - 5.5 * HOUR);
}

interface Farmer {
  pii_id: string;
  name: string;
  phone: string;
  village: string;
}

const testPhone = (n: number) => `60000002${String(n).padStart(2, '0')}`;
const walkIns = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    phone: testPhone(i + 1),
    name: `Test Farmer ${i + 1}`,
    village: i % 2 ? 'Kolar' : 'Rampur',
  }));

function counts(
  attendees: { invited: boolean; present: boolean; lead_captured: boolean }[],
) {
  return {
    invited: attendees.filter((a) => a.invited).length,
    present: attendees.filter((a) => a.present).length,
    leads: attendees.filter((a) => a.lead_captured).length,
  };
}

function meetings(farmers: Farmer[]) {
  const invite = (f: Farmer, present: boolean) => ({
    phone: f.phone,
    name: f.name,
    village: f.village,
    pii_id: f.pii_id,
    invited: true,
    present,
    walk_in: false,
    lead_captured: false,
  });
  const walkIn = (w: { phone: string; name: string; village: string }) => ({
    ...w,
    pii_id: null,
    invited: false,
    present: true,
    walk_in: true,
    lead_captured: false,
  });
  const base = {
    agent_id: PARTNER,
    venue: 'Panchayat bhawan',
    pincode: '462026',
    organiser: 'self',
    completed_at: null,
    cancelled_at: null,
    cancel_note: null,
  };
  const rows = [
    {
      _id: meetingId(1),
      purpose: 'scheduled tomorrow, 3 farmers invited — Today task (tomorrow)',
      type: 'farmer_meeting',
      title: 'Farmer meeting · Rampur',
      starts_at: istTen(1),
      village: 'Rampur',
      agenda: 'Wheat sowing, seed treatment',
      status: 'scheduled',
      attendees: farmers.slice(0, 3).map((f) => invite(f, false)),
    },
    {
      _id: meetingId(2),
      purpose: 'scheduled later today — Today task (urgent), mark attendance',
      type: 'crop_demo',
      title: 'Crop demo · Kolar',
      starts_at: new Date(Date.now() + 3 * HOUR),
      village: 'Kolar',
      agenda: 'Humic acid demo plot',
      status: 'scheduled',
      attendees: farmers.slice(0, 2).map((f) => invite(f, false)),
    },
    {
      _id: meetingId(3),
      purpose:
        'completed yesterday: 2 invited (1 came) + 2 walk-ins — capture a walk-in as lead',
      type: 'field_day',
      title: 'Field day · Rampur',
      starts_at: istTen(-1),
      village: 'Rampur',
      agenda: null,
      status: 'completed',
      completed_at: new Date(istTen(-1).getTime() + 2 * HOUR),
      attendees: [
        ...farmers.slice(0, 2).map((f, i) => invite(f, i === 0)),
        ...walkIns(2).map(walkIn),
      ],
    },
    {
      _id: meetingId(4),
      purpose: 'cancelled — read-only, attendance refused',
      type: 'disease_camp',
      title: 'Disease camp · Rampur',
      starts_at: istTen(2),
      village: 'Rampur',
      agenda: null,
      status: 'cancelled',
      cancelled_at: new Date(),
      cancel_note: 'Rain',
      attendees: [],
    },
    {
      _id: meetingId(5),
      purpose:
        'scheduled next week, nobody invited — edit / reschedule / cancel',
      type: 'soil_health_camp',
      title: 'Soil health camp · Kolar',
      starts_at: istTen(7),
      village: 'Kolar',
      agenda: 'Free soil testing',
      status: 'scheduled',
      attendees: [],
    },
  ];
  return rows.map(({ purpose, ...r }) => ({
    purpose,
    row: { ...base, ...r, counts: counts(r.attendees) },
  }));
}

function gigs() {
  const base = {
    village: 'Rampur',
    district: 'BHOPAL',
    state: 'MADHYA PRADESH',
    pincode: '462026',
    venue: 'Panchayat bhawan',
    venue_point: VENUE,
    expected_farmers: 25,
    min_farmers: 15,
    photos_required: 3,
    payout: 250,
    products: ['Humic acid 98%'],
    requirements: ['Banner photo', '2 testimonials (optional)'],
    cohorts: [] as string[],
    earning_cohorts: [] as string[],
    agent_id: null as string | null,
    accepted_at: null as Date | null,
    assigned_by: null,
    releases: [],
    check_in: null as unknown,
    attendees: [] as { phone: string; name: string; village: string | null }[],
    photos: [],
    submitted_at: null as Date | null,
    reviewed_by: null,
    reviewed_at: null,
    reject_reason: null,
    cancelled_by: null,
    cancel_reason: null,
    posted_by: BY,
    updated_by: BY,
  };
  const at = (days: number) => ({
    starts_at: istTen(days),
    ends_at: new Date(istTen(days).getTime() + 2 * HOUR),
  });
  const people = (n: number) =>
    walkIns(n).map((w) => ({
      phone: w.phone,
      name: w.name,
      village: w.village,
    }));
  const rows = [
    {
      purpose: 'open in 3 days — Available tab: accept it',
      row: {
        ...base,
        _id: gigId(1),
        title: 'Paddy blast demo · Rampur',
        ...at(3),
        status: 'open',
      },
    },
    {
      purpose: 'open in 5 days — HO: edit, assign or delete it',
      row: {
        ...base,
        _id: gigId(2),
        title: 'Wheat seed treatment · Kolar',
        village: 'Kolar',
        ...at(5),
        status: 'open',
      },
    },
    {
      purpose: 'accepted, tomorrow — Today task (gig); give it back',
      row: {
        ...base,
        _id: gigId(3),
        title: 'Soil camp · Rampur',
        ...at(1),
        status: 'accepted',
        agent_id: PARTNER,
        accepted_at: new Date(),
      },
    },
    {
      purpose:
        'checked in today, 6 farmers — add farmers and photos, then submit',
      row: {
        ...base,
        _id: gigId(4),
        title: 'Crop demo · Rampur',
        starts_at: new Date(Date.now() - HOUR),
        ends_at: new Date(Date.now() + HOUR),
        status: 'checked_in',
        agent_id: PARTNER,
        accepted_at: new Date(Date.now() - DAY),
        check_in: {
          ...VENUE,
          accuracy_m: 12,
          at: new Date(Date.now() - 50 * 60 * 1000),
          distance_m: 0,
          flags: [],
        },
        attendees: people(6),
      },
    },
    {
      purpose:
        'submitted yesterday, 16 farmers, checked in 2 km off (far) — HO review: approve / reject',
      row: {
        ...base,
        _id: gigId(5),
        title: 'Farmer meeting · Rampur',
        ...at(-1),
        photos_required: 0,
        status: 'submitted',
        agent_id: PARTNER,
        accepted_at: new Date(istTen(-3)),
        check_in: {
          lat: VENUE.lat + 0.018,
          lng: VENUE.lng,
          accuracy_m: 20,
          at: istTen(-1),
          distance_m: 2001,
          flags: ['far'],
        },
        attendees: people(16),
        submitted_at: new Date(istTen(-1).getTime() + 3 * HOUR),
      },
    },
  ];
  return rows;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  refuseUnlessTestDb();
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const log = (line: string) =>
    console.log(`[seed-test-meetings-gigs] ${line}`);

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
    const meetingsCol = db.collection<{ _id: string }>('vistaar_v2_meetings');
    const gigsCol = db.collection<{ _id: string }>('vistaar_v2_gigs');
    const meetingIds = [1, 2, 3, 4, 5].map(meetingId);
    const gigIds = [1, 2, 3, 4, 5].map(gigId);

    if (remove) {
      const m = await meetingsCol.deleteMany({ _id: { $in: meetingIds } });
      const g = await gigsCol.deleteMany({ _id: { $in: gigIds } });
      log(`removed ${m.deletedCount} meetings, ${g.deletedCount} gigs`);
      return;
    }

    const farmers = await db
      .collection<Farmer & { agent_id: string; stage: string }>(
        'vistaar_v2_leads',
      )
      .find(
        { agent_id: PARTNER, stage: { $ne: 'lost' } },
        { projection: { _id: 0, pii_id: 1, name: 1, phone: 1, village: 1 } },
      )
      .limit(3)
      .toArray();
    if (farmers.length < 3)
      throw new Error(`${PARTNER} needs 3 farmers first (seed-test-leads).`);

    const now = new Date();
    for (const { purpose, row } of meetings(farmers)) {
      log(`meeting ${row._id}: ${purpose}`);
      if (apply) {
        const { _id, ...rest } = row;
        await meetingsCol.updateOne(
          { _id },
          {
            $set: { ...rest, updated_at: now },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        );
      }
    }
    for (const { purpose, row } of gigs()) {
      log(`gig ${row._id}: ${purpose}`);
      if (apply) {
        const { _id, ...rest } = row;
        await gigsCol.updateOne(
          { _id },
          {
            $set: { ...rest, updated_at: now },
            $setOnInsert: { created_at: now },
          },
          { upsert: true },
        );
      }
    }
    log(apply ? 'written.' : 'dry run — nothing written (add --apply).');
  } finally {
    await conn.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
