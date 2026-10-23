import { plainToInstance } from 'class-transformer';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { LeadsService } from '@modules/leads/services/leads.service';

import { AdminCartsQueryDto } from '../dto/admin-cart.dto';
import {
  activeCartId,
  type CartRepository,
} from '../repositories/cart.repository';
import type { CartRecord } from '../schemas/cart.schema';
import { AdminCartService } from './admin-cart.service';

const partner = (agentId: string, piiId: string) => ({
  agent_id: agentId,
  pii_id: piiId,
  phone: '9826000000',
  cohort: 'retailer',
  preview: {
    name: 'Ramesh Patel',
    district: 'Raisen',
    state: 'Madhya Pradesh',
  },
});

function cart(agentId: string, piiId: string): CartRecord {
  return {
    _id: activeCartId(agentId),
    __v: 0,
    source: 'vistaar',
    pii_id: piiId,
    items: [
      {
        product_id: 'BK-1',
        sku: 'K-1',
        product_name: 'Humic Acid',
        price: 150,
        quantity: 2,
        total: 300,
        gst: 0,
        moq: 1,
        packaging_size: '1',
        packaging_type: '',
        uom: 'kg',
        requested_weight: 0,
        item_type: 'bulk',
        packaging_sku: null,
        is_custom_packaging: false,
      },
    ],
    subtotal: 300,
    tax: 0,
    discount: 0,
    total: 300,
    created_at: new Date('2026-10-10T08:00:00Z'),
    updated_at: new Date('2026-10-12T08:00:00Z'),
  };
}

const query = (q: Record<string, unknown> = {}) =>
  plainToInstance(AdminCartsQueryDto, q);

describe('AdminCartService', () => {
  let adminList: jest.Mock;
  let agentsList: jest.Mock;
  let verifiedAgentIds: jest.Mock;
  let service: AdminCartService;

  beforeEach(() => {
    adminList = jest.fn();
    agentsList = jest.fn().mockResolvedValue({
      items: [partner('VST-1', 'PII-1'), partner('VST-2', 'PII-2')],
      total: 2,
    });
    verifiedAgentIds = jest.fn().mockResolvedValue(['VST-1', 'VST-2']);
    service = new AdminCartService(
      { adminList } as unknown as CartRepository,
      { list: agentsList, verifiedAgentIds } as unknown as AgentsService,
      {
        farmersByPii: jest.fn().mockResolvedValue(
          new Map([
            [
              'PII-9',
              {
                pii_id: 'PII-9',
                name: 'Mohan',
                phone: '8247554977',
                village: 'Rampur',
                district: null,
              },
            ],
          ]),
        ),
      } as unknown as LeadsService,
    );
  });

  it("asks for every partner's cart id and names the farmer", async () => {
    adminList.mockResolvedValue([[cart('VST-1', 'PII-9')], 1]);

    const page = await service.list(query());

    const ids = (adminList.mock.calls[0] as unknown[])[0] as {
      toHexString(): string;
    }[];
    expect(ids.map((i) => i.toHexString()).sort()).toEqual(
      [activeCartId('VST-1'), activeCartId('VST-2')]
        .map((i) => i.toHexString())
        .sort(),
    );
    expect(page.items[0]).toMatchObject({
      partner: { agent_id: 'VST-1', name: 'Ramesh Patel' },
      pii_id: 'PII-9',
      customer: { name: 'Mohan' },
      item_count: 2,
      subtotal: 300,
      items: [{ sku: 'K-1', size_label: '1 kg', line_total: 300 }],
    });
    // Only the page's partners are read in full.
    expect(agentsList).toHaveBeenCalledWith(
      { agent_ids: ['VST-1'] },
      expect.anything(),
    );
  });

  it("shows the partner's own pii as shop stock", async () => {
    adminList.mockResolvedValue([[cart('VST-2', 'PII-2')], 1]);

    const page = await service.list(query());

    expect(page.items[0]).toMatchObject({ pii_id: null, customer: null });
  });

  it('narrows to one partner without listing every partner', async () => {
    adminList.mockResolvedValue([[], 0]);

    await service.list(query({ agent_id: 'vst-1' }));

    const ids = (adminList.mock.calls[0] as unknown[])[0] as {
      toHexString(): string;
    }[];
    expect(ids.map((i) => i.toHexString())).toEqual([
      activeCartId('VST-1').toHexString(),
    ]);
    expect(verifiedAgentIds).not.toHaveBeenCalled();
    expect(agentsList).not.toHaveBeenCalled();
  });
});

describe('AdminCartService.summary', () => {
  let adminSummary: jest.Mock;
  let verifiedAgentIds: jest.Mock;
  let service: AdminCartService;

  beforeEach(() => {
    adminSummary = jest
      .fn()
      .mockResolvedValue({ carts: 2, value: 2393.4, items: 5, stale: 1 });
    verifiedAgentIds = jest.fn().mockResolvedValue(['VST-1', 'VST-2']);
    service = new AdminCartService(
      { adminSummary } as unknown as CartRepository,
      { verifiedAgentIds } as unknown as AgentsService,
      {} as LeadsService,
    );
  });

  it("sums every partner's cart; a partner has one, so partners = carts", async () => {
    expect(await service.summary(query())).toEqual({
      carts: 2,
      partners: 2,
      value: 2393,
      items: 5,
      stale_7d: 1,
    });
    const [ids, before] = adminSummary.mock.calls[0] as [
      { toHexString(): string }[],
      Date,
    ];
    expect(ids.map((i) => i.toHexString()).sort()).toEqual(
      [activeCartId('VST-1'), activeCartId('VST-2')]
        .map((i) => i.toHexString())
        .sort(),
    );
    // Stale = before midnight IST six days ago (7+ idle IST days).
    expect(before.getTime()).toBeLessThan(Date.now() - 6 * 24 * 3600 * 1000);
    expect(before.getTime()).toBeGreaterThan(Date.now() - 7 * 24 * 3600 * 1000);
  });

  it('narrows to one partner, and answers zeros without a partner to read', async () => {
    await service.summary(query({ agent_id: 'vst-1' }));
    expect(verifiedAgentIds).not.toHaveBeenCalled();
    expect(
      (adminSummary.mock.calls[0] as [{ toHexString(): string }[]])[0].map(
        (i) => i.toHexString(),
      ),
    ).toEqual([activeCartId('VST-1').toHexString()]);

    verifiedAgentIds.mockResolvedValueOnce([]);
    adminSummary.mockClear();
    expect(await service.summary(query())).toEqual({
      carts: 0,
      partners: 0,
      value: 0,
      items: 0,
      stale_7d: 0,
    });
    expect(adminSummary).not.toHaveBeenCalled();
  });
});
