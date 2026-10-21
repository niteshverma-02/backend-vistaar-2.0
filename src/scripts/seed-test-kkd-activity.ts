/**
 * Test KKD & App activity — beta and local only, never production. What
 * VST-000006's farmers "did" at KKD stores and on the Katyayani app / website,
 * so `/kkd-activity` (KKD-ACTIVITY-APP.md) has rows of every type; who is for
 * what: docs/TEST-DATA.md.
 *
 *   node dist/scripts/seed-test-kkd-activity.js            # dry run — writes nothing
 *   node dist/scripts/seed-test-kkd-activity.js --apply    # writes (or refreshes) them
 *   node dist/scripts/seed-test-kkd-activity.js --remove   # deletes exactly these rows
 *
 * Unlike the other test seeds this one writes into OTHER apps' collections —
 * KKD activity has no source of its own (user's decision, 2026-10-21):
 * `franchise_v2_walkins`, `franchise_v2_prescriptions`, `franchise_v2_pos_orders`
 * (franchise backend), `orders_v2` (StockShip) and `kkd_events` (Katyayani app).
 * Every row has a fixed `TEST-KKD-…` id (fixed ObjectIds in `orders_v2` /
 * `kkd_events`), `source: 'test'` and `test_seed: 'seed-test-kkd-activity'`;
 * StockShip orders are only `delivered` / `cancelled`, so no fulfilment job
 * picks them up. A re-run refreshes them, `--remove` takes them out. It does
 * not boot the API and builds no index. Dates are set from today (1–6 days
 * back, after the farmers' hold began), so a re-run moves them.
 */
import mongoose from 'mongoose';

const PARTNER = 'VST-000006';
const TAG = 'seed-test-kkd-activity';
const BY = `seed:test-kkd-activity`;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOTE = 'TEST DATA — Vistaar KKD activity seed, not a real record';

/** Stores the KKD screen names ("Katyayani Krishi Kendra · Raisen / Bhopal"). */
const RAISEN = 'FR-100';
const BHOPAL = 'FS-1';

/** `hh:mm` IST on the day `days` before today. */
function istAt(days: number, hh: number, mm = 0): Date {
  const ist = new Date(Date.now() + 5.5 * HOUR);
  const day = Date.UTC(
    ist.getUTCFullYear(),
    ist.getUTCMonth(),
    ist.getUTCDate(),
  );
  return new Date(day - days * DAY + (hh * 60 + mm) * 60 * 1000 - 5.5 * HOUR);
}

/** A row this seed owns: string ids (franchise) or ObjectIds (StockShip, app events). */
interface TestRow {
  _id: string | mongoose.Types.ObjectId;
  test_seed?: string;
}

interface Farmer {
  pii_id: string;
  name: string;
  phone: string;
}

/** The farmers this seed is about, by mobile (seed-test-leads). */
const RAMESH = '6000000101';
const SURESH = '6000000102';
const MAHESH = '6000000103';
const KAMLA = '6000000105';
const RAJENDRA = '6000000106';
const VIKRAM = '6000000113';

const oid = (n: number) =>
  new mongoose.Types.ObjectId(`6b6b64${String(n).padStart(18, '0')}`);

function split(name: string) {
  const [first, ...rest] = name.split(' ');
  return { first_name: first, last_name: rest.join(' ') };
}

function walkin(
  n: number,
  f: Farmer,
  store: string,
  at: Date,
  status: string,
  notes: string | null,
) {
  return {
    _id: `TEST-KKD-WALKIN-${n}`,
    acreage: null,
    converted_id: null,
    converted_to: null,
    created_at: at,
    crop: null,
    franchise_id: store,
    intake_source: 'walk-in',
    name: f.name,
    notes,
    phone: f.phone,
    phone_raw: `+91${f.phone}`,
    photo_url: null,
    pii_id: f.pii_id,
    profile_complete: false,
    source: 'test',
    status,
    store_label: null,
    synced_at: at,
    updated_at: at,
    walked_in_at: at,
    test_seed: TAG,
  };
}

function prescription(n: number, f: Farmer, store: string, at: Date) {
  return {
    _id: `TEST-KKD-RX-${n}`,
    rx_id: `TEST-KKD-RX-${n}`,
    address: null,
    area_unit: 'Acres',
    area_value: 4,
    city: 'Bhopal',
    created_at: at,
    crop: 'Soybean',
    crop_stage: 'Flowering',
    customer_name: f.name,
    franchise_id: store,
    issued_by: null,
    next_stage_suggestion: null,
    phone: f.phone,
    phone_raw: `+91${f.phone}`,
    photos: [],
    pii_id: f.pii_id,
    pincode: null,
    problem: 'Yellow mosaic on leaves',
    products: [
      { name: 'IMD 178 (IMIDACLOPRID 17.8 %) 1 L', sku: 'K-10515' },
      {
        name: '3IN1 (NEEM OIL + KARANJ OIL + CASTOR OIL) 250 ML',
        sku: 'K-10507',
      },
    ],
    rx_date: at,
    soil_type: null,
    solution: 'Spray imidacloprid 0.5 ml/L, then neem oil after 7 days',
    source: 'test',
    state: 'Madhya Pradesh',
    status: 'active',
    store_label: null,
    symptoms: null,
    synced_at: at,
    updated_at: at,
    visit_store_after: null,
    test_seed: TAG,
  };
}

function posOrder(n: number, f: Farmer, store: string, at: Date) {
  const items = [
    {
      sku: 'K-06',
      product: 'MIX MICRONUTRIENT 100 GM',
      price: 380,
      quantity: 2,
      total: 760,
    },
    {
      sku: 'K-10507',
      product: '3IN1 NEEM OIL 250 ML',
      price: 480,
      quantity: 1,
      total: 480,
    },
  ];
  return {
    _id: `TEST-KKD-POS-${n}`,
    order_id: `TEST-KKD-POS-${n}`,
    amount: 1240,
    created_at: at,
    customer_id: f.pii_id,
    discount_amount: 0,
    discount_code: null,
    due_amount: 0,
    franchise_id: store,
    in_stockship: false,
    items,
    items_total: 1240,
    notes: NOTE,
    order_date: at,
    paid_amount: 1240,
    payment_method: 'cash',
    payment_status: 'paid',
    phone: f.phone,
    phone_raw: `+91${f.phone}`,
    pii_id: f.pii_id,
    source: 'test',
    supabase_status: 'confirmed',
    synced_at: at,
    updated_at: at,
    test_seed: TAG,
  };
}

/** A StockShip order the farmer placed on the app (MKTP-3) or website (MKTP-2). */
function stockshipOrder(
  n: number,
  f: Farmer,
  marketplace: 'MKTP-2' | 'MKTP-3',
  at: Date,
  status: 'delivered' | 'cancelled',
  lines: { sku: string; qty: number; unit_price: number }[],
) {
  const items = lines.map((l) => ({
    ...l,
    total_price: l.qty * l.unit_price,
    is_combo: false,
    is_free: false,
    is_sample: false,
    is_promotional: false,
    item_discount: 0,
  }));
  const total = items.reduce((s, i) => s + i.total_price, 0);
  const address = {
    ...split(f.name),
    phone: f.phone,
    address1: 'Test address, Kolar Road',
    city: 'Bhopal',
    pincode: '462042',
    state: 'Madhya Pradesh',
    state_code: 'MP',
    country: 'India',
    country_code: 'IN',
  };
  return {
    _id: oid(n),
    order_id: `TEST-KKD-APP-${n}`,
    date: at,
    created_at: at,
    pii_id: f.pii_id,
    customer: { ...split(f.name), phone: f.phone },
    billing_address: address,
    shipping_address: address,
    payment_mode: 'prepaid',
    currency_code: 'INR',
    items,
    total_amount: total,
    original_total_amount: total,
    cod_amount: 0,
    prepaid_amount: total,
    discounts: [],
    coin: 0,
    extra_charges: { delivery_charge: 0, small_cart_charge: 0, cod_charge: 0 },
    order_type: 'new_order',
    filter: 'B2C',
    order_status: status,
    order_status_map: [
      { stage_name: 'created', timestamp: at, user: BY },
      { stage_name: status, timestamp: new Date(at.getTime() + DAY), user: BY },
    ],
    marketplace,
    source: 'test',
    sub_source: marketplace === 'MKTP-2' ? 'TEST KKD WEBSITE' : 'TEST KKD APP',
    agent: null,
    created_by: BY,
    by_csv: false,
    notes: NOTE,
    test_seed: TAG,
  };
}

function appEvent(
  n: number,
  f: Farmer,
  at: Date,
  cart?: { total: number; items: { name: string; quantity: number }[] },
) {
  return {
    _id: oid(100 + n),
    user_id: f.phone,
    event_name: cart ? 'Cart Abandoned' : 'APP_LAUNCH',
    event_values: cart
      ? {
          items: cart.items,
          total_price: cart.total,
          total_discounts: 0,
          currency: 'INR',
          abandon_source: 'test',
          timestamp: at.toISOString(),
        }
      : { timestamp: at.toISOString() },
    source: 'test',
    created_at: at,
    __v: 0,
    test_seed: TAG,
  };
}

/** Every row, with what it tests (docs/TEST-DATA.md). */
function rows(by: Map<string, Farmer>) {
  const f = (phone: string) => {
    const farmer = by.get(phone);
    if (!farmer)
      throw new Error(
        `${PARTNER} has no farmer ${phone} — run seed-test-leads first.`,
      );
    return farmer;
  };
  return {
    franchise_v2_walkins: [
      {
        purpose: 'Ramesh walked in at Raisen, bought nothing → "Plan a visit"',
        row: walkin(
          1,
          f(RAMESH),
          RAISEN,
          istAt(2, 11),
          'pending',
          'Asked about wheat seed treatment',
        ),
      },
      {
        purpose: 'Suresh walked in and bought the same day → no follow-up',
        row: walkin(2, f(SURESH), RAISEN, istAt(3, 10, 30), 'approved', null),
      },
      {
        purpose: 'Kamla (lost lead) walked in at Bhopal → still shown',
        row: walkin(3, f(KAMLA), BHOPAL, istAt(1, 16), 'pending', null),
      },
      {
        purpose: 'Vikram — walk-in the store rejected → never shown',
        row: walkin(
          4,
          f(VIKRAM),
          BHOPAL,
          istAt(1, 12),
          'rejected',
          'Wrong entry',
        ),
      },
    ],
    franchise_v2_prescriptions: [
      {
        purpose:
          'Mahesh took crop advice at Bhopal → "crop — problem — solution", 2 products',
        row: prescription(1, f(MAHESH), BHOPAL, istAt(4, 12)),
      },
    ],
    franchise_v2_pos_orders: [
      {
        purpose: 'Suresh bought ₹1,240 at Raisen (store order)',
        row: posOrder(1, f(SURESH), RAISEN, istAt(3, 11)),
      },
    ],
    orders_v2: [
      {
        purpose:
          'Suresh ordered on the app ₹1,450 (delivered) — closes his earlier app cart',
        row: stockshipOrder(1, f(SURESH), 'MKTP-3', istAt(5, 19), 'delivered', [
          { sku: 'K-10515', qty: 1, unit_price: 970 },
          { sku: 'K-10507', qty: 1, unit_price: 480 },
        ]),
      },
      {
        purpose: 'Mahesh ordered on the website ₹780 (delivered)',
        row: stockshipOrder(2, f(MAHESH), 'MKTP-2', istAt(2, 9), 'delivered', [
          { sku: 'K-06', qty: 2, unit_price: 390 },
        ]),
      },
      {
        purpose: 'Vikram — app order cancelled → never shown',
        row: stockshipOrder(3, f(VIKRAM), 'MKTP-3', istAt(1, 18), 'cancelled', [
          { sku: 'K-06', qty: 1, unit_price: 390 },
        ]),
      },
    ],
    kkd_events: [
      {
        purpose:
          'Ramesh left ₹2,450 in the app cart → open cart, "Call to close"',
        row: appEvent(1, f(RAMESH), istAt(1, 20, 10), {
          total: 2450,
          items: [
            { name: 'HUMIC+FULVIC 800 GM', quantity: 1 },
            { name: '3IN1 NEEM OIL 250 ML', quantity: 2 },
          ],
        }),
      },
      {
        purpose: 'Suresh left a cart BEFORE his app order → not open',
        row: appEvent(2, f(SURESH), istAt(6, 21), {
          total: 899,
          items: [{ name: 'IMD 178 1 L', quantity: 1 }],
        }),
      },
      {
        purpose: 'Rajendra left ₹1,299 in the app cart today → open cart',
        row: appEvent(3, f(RAJENDRA), istAt(0, 8, 30), {
          total: 1299,
          items: [{ name: 'MIX MICRONUTRIENT 100 GM', quantity: 3 }],
        }),
      },
      {
        purpose: 'Rajendra opened the app yesterday → "Send WhatsApp tip"',
        row: appEvent(4, f(RAJENDRA), istAt(1, 7, 45)),
      },
      {
        purpose:
          'Rajendra opened the app twice yesterday → still one row that day',
        row: appEvent(5, f(RAJENDRA), istAt(1, 19)),
      },
      {
        purpose: 'Mahesh opened the app today',
        row: appEvent(6, f(MAHESH), istAt(0, 9, 15)),
      },
    ],
  };
}

async function main() {
  process.loadEnvFile?.('.env');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Test data is for beta and local only — not run in production.',
    );
  }
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const log = (line: string) => console.log(`[seed-test-kkd-activity] ${line}`);

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
    const collections = [
      'franchise_v2_walkins',
      'franchise_v2_prescriptions',
      'franchise_v2_pos_orders',
      'orders_v2',
      'kkd_events',
    ] as const;

    if (remove) {
      for (const name of collections) {
        const r = await db.collection(name).deleteMany({ test_seed: TAG });
        log(`removed ${r.deletedCount} from ${name}`);
      }
      return;
    }

    const farmers = await db
      .collection<Farmer & { agent_id: string }>('vistaar_v2_leads')
      .find(
        { agent_id: PARTNER },
        { projection: { _id: 0, pii_id: 1, name: 1, phone: 1 } },
      )
      .toArray();
    const all = rows(new Map(farmers.map((f) => [f.phone, f])));

    for (const name of collections) {
      for (const { purpose, row } of all[name]) {
        log(`${name} ${String(row._id)}: ${purpose}`);
        if (!apply) continue;
        const { _id, ...rest } = row;
        // Only our own tagged rows are ever replaced.
        await db
          .collection<TestRow>(name)
          .replaceOne({ _id, test_seed: TAG }, rest, { upsert: true });
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
