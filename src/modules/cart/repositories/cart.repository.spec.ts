import type { Model, PipelineStage } from 'mongoose';

import type { Cart } from '../schemas/cart.schema';
import { activeCartId, CartRepository } from './cart.repository';

describe('CartRepository.adminSummary (HO carts cards)', () => {
  let aggregate: jest.Mock;
  let find: jest.Mock;
  let countDocuments: jest.Mock;
  let repo: CartRepository;
  const ids = [activeCartId('VST-1'), activeCartId('VST-2')];
  const before = new Date('2026-10-16T18:30:00Z');

  beforeEach(() => {
    aggregate = jest.fn().mockReturnValue({
      exec: () =>
        Promise.resolve([
          { _id: null, carts: 2, value: 2393, items: 2, stale: 1 },
        ]),
    });
    const chain = {
      sort: () => chain,
      skip: () => chain,
      limit: () => chain,
      lean: () => chain,
      exec: () => Promise.resolve([]),
    };
    find = jest.fn().mockReturnValue(chain);
    countDocuments = jest
      .fn()
      .mockReturnValue({ exec: () => Promise.resolve(0) });
    repo = new CartRepository({
      aggregate,
      find,
      countDocuments,
    } as unknown as Model<Cart>);
  });

  it('reads the same carts as the list, and counts the untouched since the cut-off', async () => {
    expect(await repo.adminSummary(ids, before)).toEqual({
      carts: 2,
      value: 2393,
      items: 2,
      stale: 1,
    });
    await repo.adminList(ids, 0, 50);

    const [pipeline] = aggregate.mock.calls[0] as [PipelineStage[]];
    const listFilter = (find.mock.calls[0] as unknown[])[0];
    expect(pipeline[0]).toEqual({ $match: listFilter });
    expect(listFilter).toEqual({
      _id: { $in: ids },
      source: 'vistaar',
      'items.0': { $exists: true },
    });
    const group = (pipeline[1] as PipelineStage.Group).$group as Record<
      string,
      unknown
    >;
    expect(group.stale).toEqual({
      $sum: { $cond: [{ $lt: ['$updated_at', before] }, 1, 0] },
    });
  });

  it('answers zeros when no cart holds a line', async () => {
    aggregate.mockReturnValueOnce({ exec: () => Promise.resolve([]) });
    expect(await repo.adminSummary(ids, before)).toEqual({
      carts: 0,
      value: 0,
      items: 0,
      stale: 0,
    });
  });
});
