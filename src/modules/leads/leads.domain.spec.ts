import {
  addedRange,
  contactDocOf,
  cropsOf,
  farmerBand,
  farmerCopyOf,
  fixFits,
  holderOf,
  inviteOrder,
  isFarmerProfile,
  leadDocOf,
  releaseAtOf,
  replaceableBy,
  splitName,
  stageMoveError,
  type FarmerInput,
} from './leads.domain';

const farmer: FarmerInput = {
  phone: '9876543210',
  name: '  Ramesh  Kumar Patel ',
  village: 'rampur kalan',
  pincode: '462026',
  crops: ['wheat', ' Wheat ', 'green gram'],
  acreage: 6,
};
const now = new Date('2026-10-13T06:00:00Z');
const owner = { agent_id: 'A0-3001', ref: '674714aa1feb5afbbe0cbc29' };

describe('holderOf', () => {
  const me = 'VST-000001';
  const base = { link: null, lead: null, contact: null, agentId: me };

  it('lets the partner row decide first', () => {
    expect(holderOf({ ...base, link: { agent_id: me } })).toBe('mine');
    expect(holderOf({ ...base, link: { agent_id: 'VST-000002' } })).toBe(
      'other_partner',
    );
  });

  it('frees a Vistaar lead with no partner row (the partner removed it)', () => {
    const lead = { source: 'vistaar', created_by: 'VST-000002' };
    expect(holderOf({ ...base, lead })).toBe('katyayani');
    expect(holderOf({ ...base, lead, agentId: 'VST-000002' })).toBe(
      'katyayani',
    );
  });

  it('links a farmer from another channel, refuses a non-farmer', () => {
    expect(holderOf({ ...base, lead: { source: 'kkd_app' } })).toBe(
      'katyayani',
    );
    expect(
      holderOf({
        ...base,
        lead: { source: 'kkd_app' },
        contact: { profile: 'farmer' },
      }),
    ).toBe('katyayani');
    expect(holderOf({ ...base, contact: { profile: 'retailer' } })).toBe(
      'not_farmer',
    );
    expect(holderOf(base)).toBe('none');
  });

  it('counts a key-account farmer and an empty profile as farmers', () => {
    expect(isFarmerProfile('key_account_farmer')).toBe(true);
    expect(isFarmerProfile('')).toBe(true);
    expect(isFarmerProfile('Dealer')).toBe(false);
  });
});

describe('stageMoveError', () => {
  it('keeps won for the first order, and a customer fixed', () => {
    expect(stageMoveError('negotiation', 'won')).toMatch(/first order/);
    expect(stageMoveError('won', 'lost')).toMatch(/already a customer/);
    expect(stageMoveError('lost', 'contacted')).toBeNull();
    expect(stageMoveError('prospect', 'lost')).toBeNull();
  });
});

describe('farm', () => {
  it("sizes a farmer in ko-sales' bands", () => {
    expect(farmerBand(5)).toBe('small_farmer');
    expect(farmerBand(5.5)).toBe('medium_farmer');
    expect(farmerBand(31)).toBe('super_farmer');
  });

  it('keeps one Title Case entry per crop and splits the name', () => {
    expect(cropsOf(farmer.crops)).toEqual(['Wheat', 'Green Gram']);
    expect(splitName(farmer.name)).toEqual({
      first_name: 'ramesh',
      last_name: 'kumar patel',
    });
  });

  it('copies the basics for the partner row', () => {
    expect(
      farmerCopyOf(farmer, { state: 'MADHYA PRADESH', district: 'BHOPAL' }),
    ).toEqual({
      name: 'Ramesh Kumar Patel',
      phone: '9876543210',
      village: 'Rampur Kalan',
      district: 'BHOPAL',
      state: 'MADHYA PRADESH',
      pincode: '462026',
      crops: ['Wheat', 'Green Gram'],
      acreage: 6,
    });
  });
});

describe('leadDocOf', () => {
  const doc = leadDocOf(farmer, {
    leadId: 'L-4187723',
    piiId: 'PII-9',
    agentId: 'VST-000001',
    owner,
    state: 'MADHYA PRADESH',
    now,
  });

  it('files a profiled farmer from Vistaar, created by the partner, owned by the head', () => {
    expect(doc).toMatchObject({
      lead_id: 'L-4187723',
      lead_owner: { agent_id: 'A0-3001', agent_ref: owner.ref },
      first_name: 'ramesh',
      source: 'vistaar',
      created_by: 'VST-000001',
      status: 'contact_created',
      is_profiled: true,
      contact_profile: 'farmer',
      assigned_by: 'A0-3001',
      pipeline_id: null,
    });
  });

  it('carries no profiled_at, so the "Profiled Farmer" cohort never routes it', () => {
    expect(doc).not.toHaveProperty('profiled_at');
  });
});

describe('contactDocOf', () => {
  it('holds the farm in ko-sales’ farm_details shape', () => {
    expect(
      contactDocOf(farmer, {
        contactId: 'C0-202013',
        piiId: 'PII-9',
        agentId: 'VST-000001',
        now,
      }),
    ).toMatchObject({
      profile: 'farmer',
      profile_category: 'medium_farmer',
      farm_details: {
        farm_area: 6,
        farm_area_type: 'Acre',
        sub_profile: 'medium_farmer',
        crops: [{ crop_name: 'Wheat' }, { crop_name: 'Green Gram' }],
      },
      source: 'vistaar',
    });
  });
});

describe('releaseAtOf', () => {
  const day = 86_400_000;
  const at = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * day);
  const window = { lead_days: 15, customer_days: 45 };

  it('runs a lead 15 days from the last work, a customer 45 from the last order', () => {
    expect(
      releaseAtOf({ created_at: at(0), last_worked_at: at(3) }, window),
    ).toEqual(at(18));
    expect(
      releaseAtOf(
        { created_at: at(0), customer_at: at(5), last_order_at: at(20) },
        window,
      ),
    ).toEqual(at(65));
  });

  it('gives a partner who just took the farmer a whole window', () => {
    expect(
      releaseAtOf(
        { created_at: at(0), last_worked_at: at(3), held_since: at(30) },
        window,
      ),
    ).toEqual(at(45));
    expect(releaseAtOf({ created_at: at(0) }, window)).toEqual(at(15));
  });
});

describe('holderOf — released', () => {
  const base = { lead: null, contact: null, agentId: 'VST-000001' };
  it('frees another partner’s farmer only when released; mine stays mine', () => {
    const link = { agent_id: 'VST-000002' };
    expect(holderOf({ ...base, link, released: true })).toBe('released');
    expect(holderOf({ ...base, link, released: false })).toBe('other_partner');
    expect(
      holderOf({ ...base, link: { agent_id: 'VST-000001' }, released: true }),
    ).toBe('mine');
  });
});

describe('farmer location rules', () => {
  it('takes a precise fix in India', () => {
    expect(fixFits({ lat: 23.21, lng: 77.41, accuracy_m: 30 })).toBe(true);
    expect(fixFits({ lat: 23.21, lng: 77.41 })).toBe(true);
  });
  it('refuses a vague fix, or one outside India (0,0 from a phone with no fix)', () => {
    expect(fixFits({ lat: 23.21, lng: 77.41, accuracy_m: 900 })).toBe(false);
    expect(fixFits({ lat: 0, lng: 0 })).toBe(false);
  });
  it('lets a source replace itself and weaker ones only', () => {
    expect(replaceableBy('order')).toEqual(['pincode', 'order']);
    expect(replaceableBy('visit')).toEqual([
      'pincode',
      'order',
      'add',
      'visit',
    ]);
    expect(replaceableBy('pincode')).toEqual(['pincode']);
  });
});

describe('inviteOrder', () => {
  it("puts the meeting's village first, then sorts by name", () => {
    const rows = [
      { name: 'Suresh', village: 'Sehore' },
      { name: 'Mahesh', village: ' rampur ' },
      { name: 'Anil', village: 'Sehore' },
      { name: 'Kamal', village: 'Rampur' },
    ];
    expect(inviteOrder(rows, 'Rampur').map((r) => r.name)).toEqual([
      'Kamal',
      'Mahesh',
      'Anil',
      'Suresh',
    ]);
  });
});

describe('addedRange', () => {
  const within = (r: { from?: Date; to?: Date }, at: string) => {
    const t = new Date(at).getTime();
    return r.from!.getTime() <= t && t < r.to!.getTime();
  };

  it('reads a bare day as the whole IST day', () => {
    const r = addedRange('2026-10-22', '2026-10-22');
    expect(within(r, '2026-10-22T01:00:00+05:30')).toBe(true);
    expect(within(r, '2026-10-22T23:59:59.999+05:30')).toBe(true);
    expect(within(r, '2026-10-21T23:59:59.999+05:30')).toBe(false);
    expect(within(r, '2026-10-23T03:00:00+05:30')).toBe(false);
  });

  it('takes the portal’s IST date-times as sent, the end included', () => {
    const r = addedRange(
      '2026-10-22T00:00:00+05:30',
      '2026-10-22T23:59:59.999+05:30',
    );
    expect(within(r, '2026-10-22T01:00:00+05:30')).toBe(true);
    expect(within(r, '2026-10-22T23:59:59.999+05:30')).toBe(true);
    expect(within(r, '2026-10-23T03:00:00+05:30')).toBe(false);
    expect(addedRange()).toEqual({ from: undefined, to: undefined });
  });
});
