import { canMove, PARTNER_EDITABLE, partnerTimeline } from './agents.domain';

describe('stage moves', () => {
  it.each([
    ['submit', 'onboarding', true],
    ['submit', 'changes_requested', true],
    ['submit', 'kyc_review', false],
    ['approve', 'kyc_review', true],
    ['approve', 'onboarding', false],
    ['approve', 'approved', false],
    ['reject', 'changes_requested', true],
    ['reopen', 'rejected', true],
    ['reopen', 'approved', false],
    ['block', 'blocked', false],
    ['block', 'approved', true],
  ] as const)('%s from %s → %s', (action, stage, expected) => {
    expect(canMove(action, stage)).toBe(expected);
  });

  it('locks the form once submitted', () => {
    expect(PARTNER_EDITABLE.has('kyc_review')).toBe(false);
    expect(PARTNER_EDITABLE.has('changes_requested')).toBe(true);
  });
});

describe('partnerTimeline', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
  const done = (t: ReturnType<typeof partnerTimeline>) =>
    t.map((e) => `${e.step}:${e.done ? 'y' : 'n'}`).join(' ');

  it('waits on the call after applying, and lists steps in app order', () => {
    const t = partnerTimeline({
      stage: 'kyc_review',
      is_active: true,
      stage_history: [
        { to: 'signed_up', at: at(1) },
        { to: 'onboarding', at: at(2) },
        { to: 'kyc_review', at: at(3) },
      ],
      verification_calls: [{ outcome: 'not_reached', at: at(4) }],
    });
    expect(done(t)).toBe(
      'applied:y verification_call:n documents_review:n approved:n active:n',
    );
    expect(t[0].at).toEqual(at(3));
  });

  it('reviews documents from the later of submit and the verified call', () => {
    const t = partnerTimeline({
      stage: 'kyc_review',
      is_active: true,
      stage_history: [{ to: 'kyc_review', at: at(3) }],
      verification_calls: [
        { outcome: 'reached', at: at(4) },
        { outcome: 'verified', at: at(5) },
      ],
    });
    expect(t[1].at).toEqual(at(5));
    expect(t[2]).toEqual({ step: 'documents_review', at: at(5), done: true });
    expect(t[3].done).toBe(false);
  });

  it('marks earlier steps passed when approved without a logged call', () => {
    const t = partnerTimeline({
      stage: 'approved',
      is_active: true,
      stage_history: [
        { to: 'kyc_review', at: at(3) },
        { to: 'approved', at: at(6) },
      ],
    });
    expect(done(t)).toBe(
      'applied:y verification_call:y documents_review:y approved:y active:y',
    );
    expect(t[1].at).toBeNull();
    expect(t[4].at).toEqual(at(6));
  });

  it('is not active once blocked', () => {
    const t = partnerTimeline({
      stage: 'blocked',
      is_active: true,
      stage_history: [
        { to: 'kyc_review', at: at(3) },
        { to: 'approved', at: at(6) },
        { to: 'blocked', at: at(7) },
      ],
    });
    expect(t[3].done).toBe(true);
    expect(t[4]).toEqual({ step: 'active', at: null, done: false });
  });
});
