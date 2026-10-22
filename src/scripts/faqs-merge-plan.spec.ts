import { blockers, isDone, mergePlan, type StoredRow } from './faqs-merge-plan';

const T1 = new Date('2026-10-12T06:00:00Z');
const T2 = new Date('2026-10-20T06:00:00Z');

const section = (id: string, at = T1): StoredRow => ({
  _id: id,
  label: id,
  emoji: null,
  order: 1,
  is_active: true,
  updated_at: at,
});
const faq = (id: string, kind?: 'faq'): StoredRow => ({
  _id: id,
  ...(kind ? { kind } : {}),
  category: 'payments',
  q: 'Is TDS deducted?',
  q_key: 'is tds deducted?',
  updated_at: T1,
});

const PRE_MERGE_INDEXES = [
  { name: '_id_', key: { _id: 1 } },
  { name: 'q_key_1', key: { q_key: 1 }, unique: true },
];
const MERGED_INDEXES = [
  { name: '_id_', key: { _id: 1 } },
  {
    name: 'q_key_1',
    key: { q_key: 1 },
    unique: true,
    partialFilterExpression: { kind: 'faq' },
  },
];

const OLD = [section('payments'), section('kyc')];
const UUID = '6c1f6d0e-5b7a-4a51-9a9a-2f1c3e8d7b10';

describe('mergePlan', () => {
  it('first run: tags the FAQs and copies every section', () => {
    const plan = mergePlan(OLD, [faq(UUID)], MERGED_INDEXES);
    expect(plan.tagFaqs).toEqual([UUID]);
    expect(plan.insert.map((s) => s._id)).toEqual(['payments', 'kyc']);
    expect(blockers(plan)).toEqual([]);
  });

  it('a re-run after it changes nothing', () => {
    const merged = [
      faq(UUID, 'faq'),
      { ...section('payments'), kind: 'section' },
      { ...section('kyc'), kind: 'section' },
    ];
    const plan = mergePlan(OLD, merged, MERGED_INDEXES);
    expect(isDone(plan)).toBe(true);
    expect(plan.unchanged).toEqual(['payments', 'kyc']);
  });

  it('picks up what the old code wrote in between', () => {
    const merged = [
      faq(UUID, 'faq'),
      { ...section('payments'), kind: 'section' },
      faq('0b8e7a52-8f0e-4a0c-9b51-1d2c3e4f5a6b'),
    ];
    const plan = mergePlan(
      [section('payments', T2), section('kyc')],
      merged,
      MERGED_INDEXES,
    );
    expect(plan.tagFaqs).toEqual(['0b8e7a52-8f0e-4a0c-9b51-1d2c3e4f5a6b']);
    expect(plan.insert.map((s) => s._id)).toEqual(['kyc']);
    expect(plan.replace).toEqual([{ row: section('payments', T2), seen: T1 }]);
  });

  it('keeps an HO edit made through the new code over the old row', () => {
    const merged = [{ ...section('payments', T2), kind: 'section' }];
    const plan = mergePlan([section('payments', T1)], merged, MERGED_INDEXES);
    expect(plan.replace).toEqual([]);
    expect(isDone(plan)).toBe(true);
  });

  it('a section only in the merged collection is reported, never removed', () => {
    const merged = [{ ...section('app'), kind: 'section' }];
    const plan = mergePlan([], merged, MERGED_INDEXES);
    expect(plan.onlyMerged).toEqual(['app']);
    expect(isDone(plan)).toBe(true);
  });

  it('refuses while the pre-merge unique {q_key} index is there', () => {
    const plan = mergePlan(OLD, [faq(UUID)], PRE_MERGE_INDEXES);
    expect(plan.blockingIndex).toBe('q_key_1');
    expect(blockers(plan)).toHaveLength(1);
  });

  it('refuses a section key that is already another row’s _id', () => {
    const plan = mergePlan(
      [section('payments')],
      [{ ...faq('payments'), kind: 'faq' }],
      MERGED_INDEXES,
    );
    expect(plan.collisions).toEqual(['payments']);
    expect(blockers(plan)).toHaveLength(1);
  });

  it('refuses a row it cannot tell the kind of', () => {
    const plan = mergePlan([], [{ _id: 'x', q: 'stray' }], MERGED_INDEXES);
    expect(plan.unknown).toEqual(['x']);
    expect(blockers(plan)).toHaveLength(1);
  });
});
