import { StoryDesignRepository } from './story-design.repository';
import { StoryTemplateRepository } from './story-template.repository';

/** A query that resolves to `value` however it is chained. */
const query = (value: unknown) => {
  const q = {
    sort: () => q,
    limit: () => q,
    skip: () => q,
    lean: () => q,
    exec: () => Promise.resolve(value),
  };
  return q;
};

function fakeModel(stored: Record<string, unknown> | null) {
  return {
    findById: jest.fn(() => query(stored)),
    find: jest.fn(() => query(stored ? [stored] : [])),
    findOneAndUpdate: jest.fn(() => query(stored)),
    deleteOne: jest.fn(() => query({ deletedCount: 1 })),
    updateOne: jest.fn(() => query({ upsertedCount: 1 })),
    create: jest.fn((row: Record<string, unknown>) =>
      Promise.resolve({ toObject: () => row }),
    ),
  };
}

const designs = (model: ReturnType<typeof fakeModel>) =>
  new StoryDesignRepository(
    model as unknown as ConstructorParameters<typeof StoryDesignRepository>[0],
  );
const templates = (model: ReturnType<typeof fakeModel>) =>
  new StoryTemplateRepository(
    model as unknown as ConstructorParameters<
      typeof StoryTemplateRepository
    >[0],
  );

describe('story content repositories', () => {
  it('reads a design by the UUID the API shows, and returns it without kind', async () => {
    const model = fakeModel({
      _id: 'design:u1',
      kind: 'design',
      key: 'green',
      order: 0,
    });
    const row = await designs(model).find('u1');
    expect(model.findById).toHaveBeenCalledWith('design:u1');
    expect(row).toEqual({ _id: 'u1', key: 'green', order: 0 });
  });

  it('writes a new design under its kind', async () => {
    const model = fakeModel(null);
    const saved = await designs(model).create({
      _id: 'u2',
      key: 'harvest',
    } as never);
    expect(model.create).toHaveBeenCalledWith({
      _id: 'design:u2',
      kind: 'design',
      key: 'harvest',
    });
    expect(saved).toEqual({ _id: 'u2', key: 'harvest' });
  });

  it('updates and deletes by the stored id', async () => {
    const model = fakeModel({ _id: 'design:u1', kind: 'design', key: 'g' });
    await designs(model).update('u1', { order: 3 });
    await designs(model).remove('u1');
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'design:u1' },
      { $set: { order: 3 } },
      { returnDocument: 'after' },
    );
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'design:u1' });
  });

  it('keeps a card addressed by its key, with no stored key in the row', async () => {
    const model = fakeModel({
      _id: 'template:product',
      kind: 'template',
      key: 'product',
      base: 'product',
    });
    expect(await templates(model).all()).toEqual([
      { _id: 'product', base: 'product' },
    ]);
    await templates(model).remove('diwali_offer');
    expect(model.deleteOne).toHaveBeenCalledWith({
      _id: 'template:diwali_offer',
      builtin: false,
    });
  });

  it('seeds a missing card with its key, never over an existing one', async () => {
    const model = fakeModel(null);
    await templates(model).insertIfMissing({
      _id: 'tip',
      base: 'tip',
    } as never);
    expect(model.updateOne).toHaveBeenCalledWith(
      { _id: 'template:tip' },
      { $setOnInsert: { base: 'tip', kind: 'template', key: 'tip' } },
      { upsert: true },
    );
  });
});
