/**
 * Vistaar's product testimonials. They live in `product_testimonials`, the
 * collection Stockship v3 owns for every app, told apart by `source`. This API
 * reads and writes **only** `source: 'vistaar'` rows, so a Vistaar role can
 * never touch another app's stories, and Stockship refuses writes on Vistaar's.
 */
export const VISTAAR_SOURCE = 'vistaar';

/** The shared collection — Stockship's schema, Stockship's indexes. */
export const TESTIMONIALS_COLLECTION = 'product_testimonials';
/** Where `bulk` and `family` must exist (Stockship's catalogue). */
export const BULK_COLLECTION = 'bulk_v2';
export const COMBO_COLLECTION = 'combos_v2';

export const MEDIA_TYPES = ['image', 'video', 'audio'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const TESTIMONIAL_TYPES = ['product', 'combo'] as const;
export type TestimonialType = (typeof TESTIMONIAL_TYPES)[number];

/**
 * The desk's three trays: sent in but not approved, approved (shown on the
 * product page), and soft-deleted (restorable).
 */
export const TESTIMONIAL_STATUSES = ['pending', 'approved', 'removed'] as const;
export type TestimonialStatus = (typeof TESTIMONIAL_STATUSES)[number];

export interface TestimonialFlags {
  verified: boolean;
  deleted: boolean;
}

export function statusOf(t: TestimonialFlags): TestimonialStatus {
  if (t.deleted) return 'removed';
  return t.verified ? 'approved' : 'pending';
}

/** The Mongo side of `statusOf` — keep the two in step. */
export function statusFilter(
  status: TestimonialStatus,
): Record<string, unknown> {
  switch (status) {
    case 'removed':
      return { deleted: true };
    case 'approved':
      return { deleted: { $ne: true }, verified: true };
    case 'pending':
      return { deleted: { $ne: true }, verified: { $ne: true } };
  }
}

/** Stockship stores contacts as `+91` and ten digits. */
export const toContact = (tenDigits: string): string => `+91${tenDigits}`;

/** A 24-hex Mongo id; anything else is a 400, not a 500 from the cast. */
export const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** `q` matches words, name, phone or product key; escaped so `+91…` is literal. */
export const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const MEDIA_URL = /^https:\/\/\S+$/i;
