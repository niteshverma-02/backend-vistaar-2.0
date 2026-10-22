import {
  earningCohortsOf,
  forCohort,
  forEarningCohort,
  isForPartner,
  type GigAudience,
} from './gigs.domain';

const SINCE = new Date('2026-10-01T00:00:00Z');

const partner = (cohort: string | null, earning: string | null) => ({
  cohort,
  earning_cohort: earning ? { id: earning, since: SINCE } : null,
});

const audience = (
  cohorts: string[],
  earning_cohorts?: string[] | null,
): GigAudience => ({ cohorts, earning_cohorts });

describe('who an open gig is for', () => {
  it('empty lists, or a gig from before earning cohorts, are for everyone', () => {
    for (const g of [audience([], []), audience([]), audience([], null)]) {
      expect(isForPartner(g, partner('vistaar_agent', 'ec_bhopal_belt'))).toBe(
        true,
      );
      expect(isForPartner(g, partner(null, null))).toBe(true);
    }
    expect(earningCohortsOf({})).toEqual([]);
  });

  it('a partner in a listed earning cohort sees it', () => {
    const g = audience([], ['ec_bhopal_belt', 'ec_indore']);
    expect(isForPartner(g, partner('vistaar_agent', 'ec_indore'))).toBe(true);
  });

  it('a partner in another earning cohort, or in none yet, does not', () => {
    const g = audience([], ['ec_bhopal_belt']);
    expect(isForPartner(g, partner('vistaar_agent', 'ec_default'))).toBe(false);
    expect(isForPartner(g, partner('vistaar_agent', null))).toBe(false);
    expect(
      isForPartner(g, { cohort: 'vistaar_agent', earning_cohort: undefined }),
    ).toBe(false);
  });

  it('both lists must hold: partner type AND earning cohort', () => {
    const g = audience(['shop_owner'], ['ec_bhopal_belt']);
    expect(isForPartner(g, partner('shop_owner', 'ec_bhopal_belt'))).toBe(true);
    // Right earning cohort, wrong partner type.
    expect(isForPartner(g, partner('vistaar_agent', 'ec_bhopal_belt'))).toBe(
      false,
    );
    // Right partner type, wrong earning cohort.
    expect(isForPartner(g, partner('shop_owner', 'ec_indore'))).toBe(false);
  });

  it('each list on its own, for HO’s assign messages', () => {
    const g = audience(['shop_owner'], ['ec_bhopal_belt']);
    expect(forCohort(g, 'shop_owner')).toBe(true);
    expect(forCohort(g, null)).toBe(false);
    expect(forEarningCohort(g, 'ec_bhopal_belt')).toBe(true);
    expect(forEarningCohort(g, null)).toBe(false);
  });
});
