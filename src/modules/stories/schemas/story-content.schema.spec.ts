import mongoose, { type Model } from 'mongoose';

import { STORY_CONTENT_MODEL } from './story-content.schema';

/**
 * The models exactly as `forFeature` builds them, on a connection that never
 * opens: nothing here reaches a database.
 */
function compile() {
  const conn = mongoose.createConnection();
  const base = conn.model(STORY_CONTENT_MODEL.name, STORY_CONTENT_MODEL.schema);
  const kinds = Object.fromEntries(
    STORY_CONTENT_MODEL.discriminators.map((d) => [
      d.value,
      base.discriminator(d.name, d.schema, d.value),
    ]),
  ) as unknown as Record<string, Model<unknown>>;
  return { conn, base, kinds };
}

describe('vistaar_v2_story_content models', () => {
  const { conn, base, kinds } = compile();

  it('keeps every kind in the one collection', () => {
    expect(Object.keys(kinds).sort()).toEqual([
      'design',
      'festival',
      'sample',
      'template',
    ]);
    for (const model of Object.values(kinds)) {
      expect(model.collection.name).toBe('vistaar_v2_story_content');
    }
  });

  it("puts the model's kind on every read and write, so a festival key never answers as a design", () => {
    const design = kinds.design;
    const queries = [
      design.find({ is_active: true }),
      design.findOne({ key: 'diwali' }),
      design.findById('design:1'),
      design.countDocuments({ image_path: 'a.png' }),
      design.updateOne({ _id: 'design:1' }, { $set: { order: 1 } }),
      design.findOneAndUpdate({ _id: 'design:1' }, { $set: { order: 1 } }),
      design.deleteOne({ _id: 'design:1' }),
    ];
    for (const query of queries) {
      expect(query.getFilter()).toMatchObject({ kind: 'design' });
    }
    expect(kinds.festival.findOne({ key: 'diwali' }).getFilter()).toEqual({
      kind: 'festival',
      key: 'diwali',
    });
  });

  it('stamps the kind on a new row and keeps the old timestamps and no version key', () => {
    const row = new kinds.sample({ _id: 'sample:1', key: 'wheat' });
    expect(row.get('kind')).toBe('sample');
    for (const model of Object.values(kinds)) {
      expect(model.schema.get('timestamps')).toEqual({
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      });
      expect(model.schema.get('versionKey')).toBe(false);
    }
  });

  it('needs a key on a card too, for the one unique {kind, key}', async () => {
    const card = new kinds.template({ _id: 'template:x' });
    await expect(card.validate()).rejects.toMatchObject({
      errors: { key: expect.anything() as unknown },
    });
  });

  /**
   * IndexSyncService runs diffIndexes → createIndexes per model. The base
   * model owns the indexes; the four kinds must find nothing of their own
   * to build, or every boot would queue the same build five times.
   */
  it('lets only the base model build indexes', async () => {
    const stub = (
      model: { listIndexes(): Promise<unknown> },
      rows: unknown[],
    ) => {
      jest.spyOn(model, 'listIndexes').mockResolvedValue(rows);
    };
    stub(base, []);
    for (const model of Object.values(kinds)) stub(model, []);

    expect((await base.diffIndexes()).toCreate).toEqual([
      { kind: 1, key: 1 },
      { kind: 1, is_active: 1, order: 1 },
    ]);
    for (const model of Object.values(kinds)) {
      expect(await model.diffIndexes()).toEqual({ toDrop: [], toCreate: [] });
    }
    expect(base.schema.indexes()).toEqual([
      [{ kind: 1, key: 1 }, { unique: true }],
      [{ kind: 1, is_active: 1, order: 1 }, {}],
    ]);

    // Built once: nothing missing on the next boot.
    stub(base, [
      { v: 2, key: { _id: 1 }, name: '_id_' },
      { v: 2, key: { kind: 1, key: 1 }, name: 'kind_1_key_1', unique: true },
      {
        v: 2,
        key: { kind: 1, is_active: 1, order: 1 },
        name: 'kind_1_is_active_1_order_1',
      },
    ]);
    expect((await base.diffIndexes()).toCreate).toEqual([]);
  });

  afterAll(() => conn.close());
});
