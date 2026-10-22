import type { Model } from 'mongoose';

import type { FaqEntryDocument } from '../schemas/faq.schema';
import { FaqSectionRepository } from './faq-section.repository';
import { FaqRepository } from './faq.repository';

type Row = Record<string, unknown>;
type Stage = Record<string, Record<string, unknown>>;

const FAQ_ID = '6c1f6d0e-5b7a-4a51-9a9a-2f1c3e8d7b10';

/** One collection holding both kinds, as on the database after the merge. */
const rows = (): Row[] => [
  {
    _id: 'payments',
    kind: 'section',
    label: 'Payments',
    emoji: '💰',
    order: 2,
    is_active: true,
    created_at: new Date('2026-10-01'),
  },
  {
    _id: 'kyc',
    kind: 'section',
    label: 'KYC',
    emoji: null,
    order: 1,
    is_active: false,
    created_at: new Date('2026-10-01'),
  },
  {
    _id: FAQ_ID,
    kind: 'faq',
    category: 'payments',
    q: 'Is TDS deducted?',
    a: 'Yes.',
    q_key: 'is tds deducted?',
    order: 1,
    is_active: true,
    created_at: new Date('2026-10-02'),
  },
];

/** Plain equality is every filter these repositories write. */
const matches = (row: Row, filter: Row) =>
  Object.entries(filter).every(([k, v]) => row[k] === v);

const withoutKind = ({ kind: _kind, ...rest }: Row): Row => rest;

const bySort =
  (sort: Record<string, number>) =>
  (a: Row, b: Row): number => {
    for (const [k, dir] of Object.entries(sort)) {
      const x = a[k] as string | number | Date;
      const y = b[k] as string | number | Date;
      if (x < y) return -dir;
      if (x > y) return dir;
    }
    return 0;
  };

function run(input: Row[], pipeline: Stage[]): Row[] {
  let out = input;
  for (const stage of pipeline) {
    if (stage.$match) out = out.filter((r) => matches(r, stage.$match));
    if (stage.$sort) out = [...out].sort(bySort(stage.$sort as never));
    if (stage.$limit) out = out.slice(0, stage.$limit as unknown as number);
    if (stage.$project) out = out.map(withoutKind);
    if (stage.$facet) {
      const facets = stage.$facet as Record<string, Stage[]>;
      out = [
        Object.fromEntries(
          Object.entries(facets).map(([k, p]) => [k, run(out, p)]),
        ),
      ];
    }
  }
  return out;
}

/** A model over an in-memory collection, enough for both repositories. */
function fakeModel(data: Row[]) {
  const chain = (result: () => unknown) => {
    const c = {
      sort: () => c,
      skip: () => c,
      limit: () => c,
      lean: () => c,
      exec: () => Promise.resolve(result()),
    };
    return c;
  };
  const project = (r: Row | undefined, projection?: Row) =>
    r && projection?.kind === 0 ? withoutKind(r) : (r ?? null);
  const model = {
    find: jest.fn((f: Row, p?: Row) =>
      chain(() => data.filter((r) => matches(r, f)).map((r) => project(r, p))),
    ),
    findOne: jest.fn((f: Row, p?: Row) =>
      chain(() =>
        project(
          data.find((r) => matches(r, f)),
          p,
        ),
      ),
    ),
    findOneAndUpdate: jest.fn(
      (f: Row, u: { $set: Row }, o: { projection?: Row }) =>
        chain(() => {
          const row = data.find((r) => matches(r, f));
          if (row) Object.assign(row, u.$set);
          return project(row, o.projection);
        }),
    ),
    deleteOne: jest.fn((f: Row) =>
      chain(() => {
        const i = data.findIndex((r) => matches(r, f));
        if (i >= 0) data.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
      }),
    ),
    exists: jest.fn((f: Row) =>
      chain(() => (data.some((r) => matches(r, f)) ? { _id: 'x' } : null)),
    ),
    countDocuments: jest.fn((f: Row) =>
      chain(() => data.filter((r) => matches(r, f)).length),
    ),
    aggregate: jest.fn((pipeline: Stage[]) => chain(() => run(data, pipeline))),
    create: jest.fn((row: Row) => {
      data.push(row);
      return Promise.resolve({ toObject: () => ({ ...row }) });
    }),
  };
  return model;
}

function setup() {
  const data = rows();
  const model = fakeModel(data) as unknown as Model<FaqEntryDocument>;
  return {
    data,
    faqs: new FaqRepository(model),
    sections: new FaqSectionRepository(model),
  };
}

describe('one collection, two kinds', () => {
  it('a section key never opens a FAQ, nor a FAQ id a section', async () => {
    const { faqs, sections } = setup();
    expect(await faqs.find('payments')).toBeNull();
    expect(await sections.find(FAQ_ID)).toBeNull();
    expect(await faqs.find(FAQ_ID)).toMatchObject({ q: 'Is TDS deducted?' });
    expect(await sections.find('payments')).toMatchObject({
      label: 'Payments',
    });
  });

  it('HO lists hold only their own kind', async () => {
    const { faqs, sections } = setup();
    const page = await faqs.page({}, 0, 20, { order: 1 });
    expect(page.rows.map((r) => r._id)).toEqual([FAQ_ID]);
    expect(page.total).toBe(1);
    expect((await sections.list()).map((s) => s._id).sort()).toEqual([
      'kyc',
      'payments',
    ]);
  });

  it('edits and deletes reach only their own kind', async () => {
    const { faqs, sections, data } = setup();
    expect(await faqs.update('payments', { order: 9 })).toBeNull();
    expect(await faqs.remove('payments')).toBe(false);
    expect(await sections.update(FAQ_ID, { order: 9 })).toBeNull();
    expect(await sections.remove(FAQ_ID)).toBe(false);
    expect(data).toHaveLength(3);
    expect(data.every((r) => r.order !== 9)).toBe(true);
  });

  it('a section is never counted as one of its own FAQs', async () => {
    const { faqs, data } = setup();
    expect(await faqs.inSection('payments')).toBe(true);
    data.splice(2, 1);
    expect(await faqs.inSection('payments')).toBe(false);
  });

  it('the app read splits the kinds, each in its own order', async () => {
    const { faqs } = setup();
    const active = await faqs.listActive();
    expect(active.sections.map((s) => s._id)).toEqual(['payments']);
    expect(active.faqs.map((f) => f._id)).toEqual([FAQ_ID]);
  });

  it('stores the kind, and hands rows out without it, as before the merge', async () => {
    const { faqs, sections, data } = setup();
    const section = await sections.create({
      _id: 'app',
      label: 'App',
      emoji: null,
      order: 3,
      is_active: true,
      created_by: 'ho',
      updated_by: 'ho',
    });
    expect(data.at(-1)).toMatchObject({ _id: 'app', kind: 'section' });
    expect(section).not.toHaveProperty('kind');
    const faq = await faqs.create({
      _id: '0b8e7a52-8f0e-4a0c-9b51-1d2c3e4f5a6b',
      category: 'app',
      q: 'Does the app work offline?',
      a: 'Partly.',
      q_key: 'does the app work offline?',
      order: 1,
      is_active: true,
      created_by: 'ho',
      updated_by: 'ho',
    });
    expect(data.at(-1)).toMatchObject({ category: 'app', kind: 'faq' });

    for (const row of [
      section,
      faq,
      await sections.find('payments'),
      await sections.update('payments', { order: 5 }),
      ...(await sections.list()),
      await faqs.find(FAQ_ID),
      await faqs.update(FAQ_ID, { order: 5 }),
      ...(await faqs.page({}, 0, 20, { order: 1 })).rows,
    ]) {
      expect(row).not.toHaveProperty('kind');
    }
    const active = await faqs.listActive();
    for (const row of [...active.sections, ...active.faqs]) {
      expect(row).not.toHaveProperty('kind');
    }
  });
});
