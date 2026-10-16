import {
  bulkOutcome,
  dueFollowUp,
  istDayKey,
  rewardIdOf,
} from './rewards.domain';

/** 16 Oct 2026, 11:00 IST. */
const NOW = new Date('2026-10-16T05:30:00Z');
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe('rewardIdOf', () => {
  it('pays a lead once ever, a follow-up once per due day — each per kind', () => {
    expect(rewardIdOf('lead_created', 'PII-9', 'coin')).toBe(
      'lead_created:PII-9:coin',
    );
    expect(rewardIdOf('follow_up_done', 'PII-9', 'gig', '2026-10-14')).toBe(
      'follow_up_done:PII-9:2026-10-14:gig',
    );
  });
});

describe('dueFollowUp', () => {
  it.each([
    ['due earlier today', ist('2026-10-16T09:00:00'), 'call', '2026-10-16', 0],
    [
      'due later today',
      ist('2026-10-16T23:59:00'),
      'whatsapp',
      '2026-10-16',
      0,
    ],
    ['two days overdue', ist('2026-10-14T18:00:00'), 'visit', '2026-10-14', 2],
    // 00:30 IST on the 15th is still the 14th in UTC: the IST day counts.
    [
      'just after IST midnight',
      ist('2026-10-15T00:30:00'),
      'call',
      '2026-10-15',
      1,
    ],
  ])('%s → pays', (_label, due, type, day, overdue) => {
    expect(dueFollowUp(due, type, NOW)).toEqual({
      due_day: day,
      days_overdue: overdue,
    });
  });

  it.each([
    ['no follow-up', null, 'call'],
    ['due tomorrow', ist('2026-10-17T00:00:00'), 'call'],
    ['a note', ist('2026-10-16T09:00:00'), 'note'],
  ])('%s → nothing', (_label, due, type) => {
    expect(dueFollowUp(due, type, NOW)).toBeNull();
  });

  it('keys the day in IST', () => {
    expect(istDayKey(new Date('2026-10-15T19:00:00Z'))).toBe('2026-10-16');
  });
});

describe('bulkOutcome', () => {
  const at = new Date('2026-10-16T06:00:00Z');
  const stamp = { by: 'ho@katyayaniorganics.com', at };

  it('counts as changed only rows this call moved; the rest are skipped with their status', () => {
    const out = bulkOutcome(
      ['a', 'b', 'c', 'd', 'a'],
      [
        {
          _id: 'a',
          status: 'approved',
          reviewed_by: stamp.by,
          reviewed_at: at,
        },
        // Approved a moment earlier by someone else.
        {
          _id: 'b',
          status: 'approved',
          reviewed_by: 'other@katyayaniorganics.com',
          reviewed_at: at,
        },
        {
          _id: 'c',
          status: 'rejected',
          reviewed_by: 'system',
          reviewed_at: at,
        },
      ],
      'approved',
      stamp,
    );
    expect(out).toEqual({
      changed: ['a'],
      skipped: [
        { id: 'b', status: 'approved' },
        { id: 'c', status: 'rejected' },
        { id: 'd', status: null },
      ],
    });
  });
});
