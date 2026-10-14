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
  let service: AdminCartService;

  beforeEach(() => {
    adminList = jest.fn();
    agentsList = jest.fn().mockResolvedValue({
      items: [partner('VST-1', 'PII-1'), partner('VST-2', 'PII-2')],
      total: 2,
    });
    service = new AdminCartService(
      { adminList } as unknown as CartRepository,
      { list: agentsList } as unknown as AgentsService,
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
  });

  it("shows the partner's own pii as shop stock", async () => {
    adminList.mockResolvedValue([[cart('VST-2', 'PII-2')], 1]);

    const page = await service.list(query());

    expect(page.items[0]).toMatchObject({ pii_id: null, customer: null });
  });

  it('narrows to one partner', async () => {
    adminList.mockResolvedValue([[], 0]);

    await service.list(query({ agent_id: 'vst-1' }));

    expect(agentsList).toHaveBeenCalledWith(
      { agent_ids: ['VST-1'] },
      expect.anything(),
    );
  });
});
