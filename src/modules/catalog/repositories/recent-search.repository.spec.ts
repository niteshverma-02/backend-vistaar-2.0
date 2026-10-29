import { RecentSearchRepository } from './recent-search.repository';

/** A query that resolves to `value` however it is chained. */
const query = (value: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
});

function fakeModel(stored: { terms: string[] } | null) {
  return {
    findById: jest.fn(() => query(stored)),
    updateOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
    deleteOne: jest.fn(() => ({ exec: () => Promise.resolve({}) })),
  };
}

const repo = (model: ReturnType<typeof fakeModel>) =>
  new RecentSearchRepository(
    model as unknown as ConstructorParameters<typeof RecentSearchRepository>[0],
  );

describe('RecentSearchRepository', () => {
  it('reads no row as an empty list', async () => {
    const model = fakeModel(null);
    await expect(repo(model).findMine('VST-1')).resolves.toEqual([]);
    expect(model.findById).toHaveBeenCalledWith('VST-1');
  });

  it('reads the partner`s own stored terms', async () => {
    const model = fakeModel({ terms: ['urea', 'dap'] });
    await expect(repo(model).findMine('VST-1')).resolves.toEqual([
      'urea',
      'dap',
    ]);
  });

  it('writes the term to the front and upserts the row', async () => {
    const model = fakeModel({ terms: ['urea'] });
    const result = await repo(model).record('VST-1', 'humic acid');

    expect(result).toEqual(['humic acid', 'urea']);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: 'VST-1' },
      { $set: { terms: ['humic acid', 'urea'] } },
      { upsert: true },
    );
  });

  it('clears the partner`s row', async () => {
    const model = fakeModel(null);
    await repo(model).clearMine('VST-1');
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'VST-1' });
  });
});
