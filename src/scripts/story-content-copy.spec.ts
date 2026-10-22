import { planCopy, type ContentRow, type OldRow } from './story-content-copy';

const day = (n: number) => new Date(Date.UTC(2026, 9, n));

const oldDesign = (over: Partial<OldRow> = {}): OldRow => ({
  _id: 'u1',
  key: 'green',
  order: 1,
  updated_at: day(10),
  ...over,
});

const copied = (over: Partial<ContentRow> = {}): ContentRow => ({
  _id: 'design:u1',
  kind: 'design',
  key: 'green',
  order: 1,
  updated_at: day(10),
  ...over,
});

describe('planCopy', () => {
  it('copies a row under its kind, with the card key from its old id', () => {
    expect(planCopy('design', [oldDesign()], []).insert).toEqual([copied()]);
    expect(
      planCopy('template', [{ _id: 'product', base: 'product' }], []).insert,
    ).toEqual([
      {
        _id: 'template:product',
        kind: 'template',
        key: 'product',
        base: 'product',
      },
    ]);
  });

  it('changes nothing on a second run', () => {
    const plan = planCopy('design', [oldDesign()], [copied()]);
    expect(plan).toMatchObject({
      insert: [],
      replace: [],
      unchanged: 1,
      kept: [],
      skipped: [],
    });
  });

  it('brings over a later edit on the old screens', () => {
    const plan = planCopy(
      'design',
      [oldDesign({ order: 5, updated_at: day(12) })],
      [copied()],
    );
    expect(plan.replace).toEqual([
      { row: copied({ order: 5, updated_at: day(12) }), was: day(10) },
    ]);
  });

  it("never undoes HO's edit on the new collection", () => {
    const plan = planCopy(
      'design',
      [oldDesign()],
      [copied({ order: 9, updated_at: day(11) })],
    );
    expect(plan.kept).toEqual(['design:u1']);
    expect(plan.replace).toEqual([]);
  });

  it('skips a key a newer row already holds, and a key seen twice', () => {
    const taken = planCopy(
      'festival',
      [{ _id: 'f1', key: 'diwali' }],
      [{ _id: 'festival:f9', kind: 'festival', key: 'diwali' }],
    );
    expect(taken.insert).toEqual([]);
    expect(taken.skipped).toEqual([
      { id: 'f1', reason: 'key diwali already belongs to festival:f9' },
    ]);

    const twice = planCopy(
      'sample',
      [{ _id: 's1', key: 'wheat' }, { _id: 's2', key: 'wheat' }, { _id: 's3' }],
      [],
    );
    expect(twice.insert.map((r) => r._id)).toEqual(['sample:s1']);
    expect(twice.skipped.map((s) => s.id)).toEqual(['s2', 's3']);
  });
});
