import type { Model } from 'mongoose';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { OrdersQueryDto } from '../dto/order-request.dto';
import { orderSearch } from '../orders.domain';
import type { Order } from '../schemas/order.schema';
import { OrderRepository } from './order.repository';

describe('orders search (GET /orders?q=)', () => {
  let find: jest.Mock;
  let repo: OrderRepository;

  beforeEach(() => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve([]),
    };
    find = jest.fn().mockReturnValue(chain);
    repo = new OrderRepository({ find } as unknown as Model<Order>);
  });

  const filterFor = async (q: string) => {
    await repo.list('VST-1', null, 0, 20, null, undefined, orderSearch(q));
    return (find.mock.calls.at(-1) as [Record<string, unknown>])[0];
  };

  it.each([
    ['ksk-341382', { order_id: 'KSK-341382' }],
    ['+91 98260 00000', { 'customer.phone': { $regex: '9826000000$' } }],
    [
      'ram (k',
      {
        $and: [
          {
            $or: [
              { 'customer.first_name': { $regex: 'ram', $options: 'i' } },
              { 'customer.last_name': { $regex: 'ram', $options: 'i' } },
            ],
          },
          {
            $or: [
              { 'customer.first_name': { $regex: '\\(k', $options: 'i' } },
              { 'customer.last_name': { $regex: '\\(k', $options: 'i' } },
            ],
          },
        ],
      },
    ],
  ])('%s: id exact, phone end or name contains', async (q, part) => {
    expect(await filterFor(q)).toEqual({
      agent: 'VST-1',
      marketplace: 'MKTP-5',
      ...part,
    });
  });

  it('never reaches another partner’s orders, whatever is typed', async () => {
    for (const q of ['VST-2', 'KSK-1', '98260', 'Ramesh', '$or agent']) {
      const filter = await filterFor(q);
      expect(Object.keys(filter).slice(0, 2)).toEqual(['agent', 'marketplace']);
      expect(filter.agent).toBe('VST-1');
      expect(filter).not.toHaveProperty('$or');
    }
  });

  it('a one-word name stays a name; only a numbered word is an order id', () => {
    expect(orderSearch('Ramesh')).toMatchObject({ name: 'Ramesh' });
    expect(orderSearch('k0-150')).toMatchObject({ orderId: 'K0-150' });
    expect(orderSearch('  ')).toEqual({
      orderId: null,
      phoneEnd: null,
      name: null,
    });
  });

  it.each([
    ['a', false],
    ['ab', true],
    ['x'.repeat(60), true],
    ['x'.repeat(61), false],
  ])('q %s is 2–60 characters', async (q, ok) => {
    const errors = await validate(plainToInstance(OrdersQueryDto, { q }));
    expect(errors.length === 0).toBe(ok);
  });
});

describe('HO order list (GET /admin/orders)', () => {
  it('leaves out what the cards do not count: failed, placeholder, split / merged parents', async () => {
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve([]),
    };
    const find = jest.fn().mockReturnValue(chain);
    const countDocuments = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve(0) });
    const repo = new OrderRepository({
      find,
      countDocuments,
    } as unknown as Model<Order>);

    await repo.adminList({ paymentMode: 'prepaid' } as never, 0, 50);
    const all = (find.mock.calls[0] as [Record<string, unknown>])[0];
    const { $nin } = all.order_status as { $nin: string[] };
    for (const s of ['failed', 'pseudo', 'split', 'merged'])
      expect($nin).toContain(s);

    await repo.adminList({ statuses: ['failed', 'cancelled'] } as never, 0, 50);
    const picked = (find.mock.calls[1] as [Record<string, unknown>])[0];
    expect(picked.order_status).toEqual({ $in: ['cancelled'] });
  });
});
