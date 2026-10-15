import type { DraftOrderService } from '@modules/draft-order/services/draft-order.service';
import type { EventsService } from '@modules/events/services/events.service';
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { MeetingsService } from '@modules/meetings/services/meetings.service';
import type { OrderService } from '@modules/orders/services/order.service';

import { TodayService } from './today.service';

const PARTNER = { agent_id: 'VST-000006', pii_id: 'PII-1' };

describe('TodayService', () => {
  it('asks each source for the partner’s own records', async () => {
    const leads = { listMine: jest.fn().mockResolvedValue({ items: [] }) };
    const drafts = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const events = { upcoming: jest.fn().mockResolvedValue([]) };
    const meetings = { soon: jest.fn().mockResolvedValue([]) };
    const orders = { list: jest.fn().mockResolvedValue({ items: [] }) };
    const service = new TodayService(
      leads as unknown as LeadsService,
      drafts as unknown as DraftOrderService,
      events as unknown as EventsService,
      meetings as unknown as MeetingsService,
      orders as unknown as OrderService,
    );

    expect(await service.get(PARTNER)).toMatchObject({ count: 0, items: [] });
    expect(leads.listMine).toHaveBeenCalledWith(
      PARTNER,
      expect.objectContaining({ due: true }),
    );
    expect(drafts.list).toHaveBeenCalledWith(
      'VST-000006',
      expect.objectContaining({ limit: 200 }),
    );
    expect(events.upcoming).toHaveBeenCalledWith('VST-000006');
    expect(meetings.soon).toHaveBeenCalledWith('VST-000006', expect.any(Date));
    expect(orders.list).toHaveBeenCalledWith(
      PARTNER,
      expect.objectContaining({ status: 'placed' }),
    );
  });

  it('still answers when one source is down', async () => {
    const service = new TodayService(
      {
        listMine: jest.fn().mockResolvedValue({
          items: [
            {
              pii_id: 'PII-9',
              name: 'Ramesh',
              phone: '6000000101',
              crops: ['Wheat'],
              acreage: 5,
              expected_value: null,
              stage: 'contacted',
              next_follow_up: new Date(Date.now() - 3600_000),
            },
          ],
        }),
      } as unknown as LeadsService,
      {
        list: jest.fn().mockRejectedValue(new Error('down')),
      } as unknown as DraftOrderService,
      { upcoming: jest.fn().mockResolvedValue([]) } as unknown as EventsService,
      { soon: jest.fn().mockResolvedValue([]) } as unknown as MeetingsService,
      {
        list: jest.fn().mockResolvedValue({ items: [] }),
      } as unknown as OrderService,
    );
    const view = await service.get(PARTNER);
    expect(view.counts).toMatchObject({ follow_up: 1, saved_cart: 0 });
  });
});
