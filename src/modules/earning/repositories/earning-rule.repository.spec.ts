import type { Model } from 'mongoose';

import { MAX_RULES_PER_COHORT, NO_FILTERS } from '../earning.domain';
import type { EarningCohortDocument } from '../schemas/earning-cohort.schema';
import type { EarningRule } from '../schemas/earning-rule.schema';
import { EarningCohortRepository } from './earning-cohort.repository';
import { EarningRuleRepository } from './earning-rule.repository';

/*
 * A one-collection stand-in for the MongoDB operators these repositories
 * send (equality, `$elemMatch`, `rules.N $exists`, `$set` / `$inc` on
 * `rules.$[x].field` with arrayFilters, `$push`), so the guards are tested
 * by what they do to a document, not by the shape of the call.
 */
type Doc = Record<string, unknown> & { _id: string; rules?: EarningRule[] };
type Filter = Record<string, unknown>;

const clone = <T>(v: T): T => structuredClone(v);

function holds(row: Record<string, unknown>, cond: Filter): boolean {
  return Object.entries(cond).every(([k, v]) => {
    if (k === 'rules' && v && typeof v === 'object' && '$elemMatch' in v) {
      const want = (v as { $elemMatch: Filter }).$elemMatch;
      return ((row.rules as EarningRule[]) ?? []).some((r) =>
        holds(r as unknown as Record<string, unknown>, want),
      );
    }
    if (k === 'rules._id') {
      return ((row.rules as EarningRule[]) ?? []).some((r) => r._id === v);
    }
    const index = /^rules\.(\d+)$/.exec(k);
    if (index) {
      const has = ((row.rules as EarningRule[]) ?? []).length > +index[1];
      return has === (v as { $exists: boolean }).$exists;
    }
    return row[k] === v;
  });
}

function apply(
  doc: Doc,
  update: {
    $set?: Filter;
    $inc?: Record<string, number>;
    $push?: { rules: EarningRule };
  },
  arrayFilters: Filter[] = [],
): void {
  const byIdent = new Map<string, Filter>();
  for (const f of arrayFilters) {
    for (const [k, v] of Object.entries(f)) {
      const [ident, field] = k.split('.');
      byIdent.set(ident, { ...byIdent.get(ident), [field]: v });
    }
  }
  // Like MongoDB: which elements an identifier names is decided on the
  // document as it was before this update.
  const rows = (doc.rules ?? []) as unknown as Record<string, unknown>[];
  const named = new Map(
    [...byIdent].map(([ident, want]) => [
      ident,
      rows.filter((row) => holds(row, want)),
    ]),
  );
  const write = (path: string, fn: (old: unknown) => unknown) => {
    const m = /^rules\.\$\[(\w+)\]\.(\w+)$/.exec(path);
    if (!m) {
      doc[path] = fn(doc[path]);
      return;
    }
    for (const row of named.get(m[1]) ?? []) row[m[2]] = fn(row[m[2]]);
  };
  for (const [k, v] of Object.entries(update.$set ?? {})) write(k, () => v);
  for (const [k, n] of Object.entries(update.$inc ?? {}))
    write(k, (old) => (old as number) + n);
  if (update.$push) doc.rules = [...(doc.rules ?? []), update.$push.rules];
}

function fakeModel(docs: Doc[]) {
  const result = <T>(value: T) => ({
    lean: () => ({ exec: () => Promise.resolve(value) }),
    exec: () => Promise.resolve(value),
  });
  const touch = (doc: Doc, options: { timestamps?: boolean }) => {
    // What Mongoose's schema timestamps add unless the query turns them off.
    if (options.timestamps !== false) doc.updated_at = new Date('2099-01-01');
  };
  return {
    findOne: (filter: Filter) =>
      result(clone(docs.find((d) => holds(d, filter)) ?? null)),
    findById: (id: string) =>
      result(clone(docs.find((d) => d._id === id) ?? null)),
    findOneAndUpdate: (
      filter: Filter,
      update: Parameters<typeof apply>[1],
      options: { arrayFilters?: Filter[]; timestamps?: boolean },
    ) => {
      const doc = docs.find((d) => holds(d, filter));
      if (doc) {
        apply(doc, update, options.arrayFilters);
        touch(doc, options);
      }
      return result(doc ? clone(doc) : null);
    },
    updateOne: (
      filter: Filter,
      update: Parameters<typeof apply>[1],
      options: { arrayFilters?: Filter[]; timestamps?: boolean },
    ) => {
      const doc = docs.find((d) => holds(d, filter));
      if (doc) {
        apply(doc, update, options.arrayFilters);
        touch(doc, options);
      }
      return result({ matchedCount: doc ? 1 : 0 });
    },
  };
}

const HO = 'ho@katyayaniorganics.com';
const OLD = new Date('2026-10-01T00:00:00Z');

const rule = (id: string, extra: Partial<EarningRule> = {}): EarningRule => ({
  _id: id,
  name: id,
  trigger: 'lead_created',
  conditions: [],
  reward: { kind: 'coin', amount: 5 },
  order: 1,
  status: 'active',
  version: 1,
  created_by: HO,
  updated_by: HO,
  archived_by: null,
  archived_at: null,
  created_at: OLD,
  updated_at: OLD,
  ...extra,
});

const cohortDoc = (rules: EarningRule[], extra: Partial<Doc> = {}): Doc => ({
  _id: 'ec_big',
  name: 'Big books',
  description: null,
  conditions: [{ field: 'open_leads', op: 'gte', value: 10 }],
  filters: NO_FILTERS,
  priority: 1,
  status: 'active',
  meeting_gig_payout: null,
  version: 3,
  created_by: HO,
  updated_by: HO,
  archived_by: null,
  archived_at: null,
  created_at: OLD,
  updated_at: OLD,
  rules,
  ...extra,
});

function setup(doc: Doc) {
  const model = fakeModel([doc]) as unknown as Model<EarningCohortDocument>;
  return {
    doc,
    rules: new EarningRuleRepository(model),
    cohorts: new EarningCohortRepository(model),
  };
}

describe('EarningRuleRepository — rules inside the cohort document', () => {
  it('edits a rule at its own version and leaves the cohort’s version, editor and time alone', async () => {
    const { doc, rules } = setup(
      cohortDoc([rule('r1', { version: 2 }), rule('r2')]),
    );
    const saved = await rules.save('r1', 2, { name: 'Paddy' }, 'other@ho');

    expect(saved).toMatchObject({
      _id: 'r1',
      cohort_id: 'ec_big',
      name: 'Paddy',
      version: 3,
      updated_by: 'other@ho',
    });
    expect(doc).toMatchObject({ version: 3, updated_by: HO, updated_at: OLD });
    expect(doc.rules?.[1]).toEqual(rule('r2'));
  });

  it('refuses a stale rule version and an archived rule', async () => {
    const { doc, rules } = setup(
      cohortDoc([
        rule('r1', { version: 2 }),
        rule('r2', { status: 'archived' }),
      ]),
    );
    expect(await rules.save('r1', 1, { name: 'x' }, HO)).toBeNull();
    expect(await rules.save('r2', 1, { name: 'x' }, HO)).toBeNull();
    expect(doc.rules?.map((r) => [r.name, r.version])).toEqual([
      ['r1', 2],
      ['r2', 1],
    ]);
  });

  it('a cohort edit and a rule edit made from the same read both land', async () => {
    const { doc, rules, cohorts } = setup(cohortDoc([rule('r1')]));
    expect(await rules.save('r1', 1, { name: 'Paddy' }, HO)).not.toBeNull();
    expect(
      await cohorts.save('ec_big', 3, { name: 'Bigger books' }, HO),
    ).not.toBeNull();
    // …and in the other order: the cohort edit bumped only the cohort.
    expect(await rules.save('r1', 2, { name: 'Paddy 2' }, HO)).not.toBeNull();
    expect(doc).toMatchObject({ name: 'Bigger books', version: 4 });
    expect(doc.rules?.[0]).toMatchObject({ name: 'Paddy 2', version: 3 });
  });

  it('switches a rule off and on under its own version, never the cohort’s', async () => {
    const { doc, rules } = setup(cohortDoc([rule('r1')]));
    expect(await rules.save('r1', 1, { enabled: false }, HO)).toMatchObject({
      enabled: false,
      version: 2,
    });
    expect(await rules.save('r1', 1, { enabled: true }, HO)).toBeNull();
    expect(await rules.save('r1', 2, { enabled: true }, HO)).toMatchObject({
      enabled: true,
      version: 3,
    });
    expect(doc).toMatchObject({ version: 3, updated_at: OLD });
  });

  it('archives an active rule once; its version moves on', async () => {
    const { doc, rules } = setup(cohortDoc([rule('r1')]));
    expect(await rules.archive('r1', HO)).toMatchObject({
      status: 'archived',
      archived_by: HO,
      version: 2,
    });
    expect(await rules.archive('r1', HO)).toBeNull();
    expect(doc.version).toBe(3);
  });

  it('adds only to an active cohort with room, without touching the cohort', async () => {
    const live = setup(cohortDoc([rule('r1')]));
    const {
      created_at: _c,
      updated_at: _u,
      ...row
    } = rule('r2', {
      order: 2,
    });
    expect(await live.rules.add('ec_big', row)).toMatchObject({
      _id: 'r2',
      cohort_id: 'ec_big',
      order: 2,
    });
    expect(live.doc).toMatchObject({ version: 3, updated_at: OLD });
    expect(live.doc.rules).toHaveLength(2);

    const archived = setup(cohortDoc([], { status: 'archived' }));
    expect(await archived.rules.add('ec_big', row)).toBeNull();

    const full = setup(
      cohortDoc(
        Array.from({ length: MAX_RULES_PER_COHORT }, (_, i) =>
          rule(`r${i}`, { status: 'archived' }),
        ),
      ),
    );
    expect(await full.rules.add('ec_big', row)).toBeNull();
  });

  it('reorders only the active rules it names, in one write', async () => {
    const { doc, rules } = setup(
      cohortDoc([
        rule('a', { order: 1 }),
        rule('b', { order: 2 }),
        rule('gone', { order: 3, status: 'archived' }),
      ]),
    );
    await rules.setOrder('ec_big', ['b', 'a', 'gone'], HO);
    expect(doc.rules?.map((r) => [r._id, r.order])).toEqual([
      ['a', 2],
      ['b', 1],
      ['gone', 3],
    ]);
    expect(doc).toMatchObject({ version: 3, updated_at: OLD });
  });

  it('finds a rule by id in whichever cohort holds it', async () => {
    const { rules } = setup(cohortDoc([rule('r1'), rule('r2')]));
    expect(await rules.find('r2')).toMatchObject({
      _id: 'r2',
      cohort_id: 'ec_big',
    });
    expect(await rules.find('nope')).toBeNull();
  });
});

describe('EarningCohortRepository.save', () => {
  it('guards on the cohort’s own version and never writes its rules', async () => {
    const { doc, cohorts } = setup(cohortDoc([rule('r1', { version: 4 })]));
    expect(await cohorts.save('ec_big', 2, { name: 'x' }, HO)).toBeNull();
    const saved = await cohorts.save('ec_big', 3, { name: 'x' }, HO);
    expect(saved).toMatchObject({ name: 'x', version: 4 });
    expect(doc.rules).toEqual([rule('r1', { version: 4 })]);
  });
});
