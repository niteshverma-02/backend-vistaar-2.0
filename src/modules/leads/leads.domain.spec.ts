import {
  contactDocOf,
  cropsOf,
  farmerBand,
  farmerCopyOf,
  holderOf,
  isFarmerProfile,
  leadDocOf,
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

  it('treats a Vistaar lead with no partner row as its creator’s', () => {
    const lead = { source: 'vistaar', created_by: 'VST-000002' };
    expect(holderOf({ ...base, lead })).toBe('other_partner');
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
