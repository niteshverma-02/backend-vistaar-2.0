/**
 * Help FAQs (PRD Learn · FAQs), written by HO and read by the app's /faqs
 * screen. HO also manages the sections (the app's category chips); a FAQ's
 * `category` is a section key.
 */

/** A section's stable key, e.g. `payments`; the app's `FaqCategory` wire value. */
export const SECTION_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export const MAX_SECTION_LABEL = 40;
export const MAX_QUESTION = 300;
export const MAX_ANSWER = 2000;

/**
 * The question as the uniqueness check sees it. The app opens a FAQ linked
 * from the Learn hub by its question, so two that differ only in case or
 * spacing would be ambiguous there.
 */
export function questionKey(q: string): string {
  return q.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * What the app shows: FAQs only under a live section, and only the sections
 * that have one — an empty chip would filter to nothing.
 */
export function liveSections<
  S extends { _id: string },
  F extends { category: string },
>(sections: S[], faqs: F[]): { sections: S[]; faqs: F[] } {
  const keys = new Set(sections.map((s) => s._id));
  const shown = faqs.filter((f) => keys.has(f.category));
  const used = new Set(shown.map((f) => f.category));
  return { sections: sections.filter((s) => used.has(s._id)), faqs: shown };
}
