import {
  CAPABILITIES,
  can,
  capabilitiesOf,
  roleOf,
  type Capability,
} from './access.domain';

describe('roleOf', () => {
  it.each([
    ['USR-1037', true, 'head'],
    ['USR-1000', true, 'admin'],
    ['USR-1001', true, 'admin'],
    ['USR-1001', false, null],
    ['USR-1012', true, null],
    [null, true, null],
  ])('%s active=%s → %s', (code, active, expected) => {
    expect(roleOf(code, active)).toBe(expected);
  });
});

describe('capabilities', () => {
  const all = Object.keys(CAPABILITIES) as Capability[];

  it('head can do everything in the table except the payment keys', () => {
    expect(can('head', 'agents.decide')).toBe(true);
    expect(capabilitiesOf('head')).toContain('config.publish');
    expect(can('head', 'payments.credentials')).toBe(false);
    expect(capabilitiesOf('head')).toEqual(
      all.filter((c) => c !== 'payments.credentials'),
    );
  });

  it('admin can do everything a head can, plus the payment keys', () => {
    expect(capabilitiesOf('admin')).toEqual(all);
  });
});
