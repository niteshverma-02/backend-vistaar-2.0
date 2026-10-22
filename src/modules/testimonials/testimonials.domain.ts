import { createHash } from 'node:crypto';

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

/**
 * What HO may upload for a testimonial it files itself: the file goes through
 * this server (multipart, so no bucket CORS for the portal) to a public object
 * with a lasting link — what Stockship's product pages play.
 */
export const HO_MEDIA_RULES: Record<
  MediaType,
  { maxBytes: number; types: Record<string, string> }
> = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    types: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' },
  },
  video: {
    maxBytes: 60 * 1024 * 1024,
    types: {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/webm': 'webm',
    },
  },
  audio: {
    maxBytes: 20 * 1024 * 1024,
    types: {
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'weba',
    },
  },
};
export const HO_MEDIA_MAX_BYTES = Math.max(
  ...Object.values(HO_MEDIA_RULES).map((r) => r.maxBytes),
);
export const HO_MEDIA_FOLDER = 'vistaar/testimonials';

/** The kind a file of type [mime] is, or `null` when HO may not upload it. */
export function hoMediaTypeOf(mime: string): MediaType | null {
  return MEDIA_TYPES.find((t) => mime in HO_MEDIA_RULES[t].types) ?? null;
}

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

export const MEDIA_URL = /^https:\/\/\S+$/i;

// ---------------------------------------------------------------------------
// Partner submissions — what a partner sends from the app, before and after
// HO's decision. No collection of our own (user's decision, 2026-10-22): a
// submission is its `product_reviews` row, Stockship's fields plus a
// `vistaar` sub-document for what Stockship has no field for. Undecided it is
// `verified: false` (Stockship's lists hide it) with `rating: null` (its
// averages count every row not deleted). The `product_testimonials` row of a
// video or photo is written on approval only, marked with its own `vistaar`.
// ---------------------------------------------------------------------------

export const PRODUCT_REVIEWS_COLLECTION = 'product_reviews';

/**
 * The review row's `_id` for the app's submission UUID. Derived, not stored:
 * a retried submit lands on the same `_id` (the duplicate key is the retry
 * guard), and a lookup by the app's id needs no index on a collection we may
 * not index. 96 bits of SHA-256 — no clash with Stockship's own ObjectIds.
 */
export const reviewIdOf = (submissionId: string): string =>
  createHash('sha256')
    .update(`vistaar-testimonial:${submissionId.toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);

/** The app's three kinds. `text` is a quote only — a review row, no media. */
export const SUBMISSION_KINDS = ['video', 'photo', 'text'] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

export const SUBMISSION_STATUSES = [
  'submitted',
  'approved',
  'rejected',
  'removed',
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Stockship's `media.media_type` for each kind that carries a file. */
export const MEDIA_TYPE_OF: Record<
  Exclude<SubmissionKind, 'text'>,
  MediaType
> = { video: 'video', photo: 'image' };

export type HoAction = 'approve' | 'reject' | 'remove';

/**
 * Which status each HO action may start from. Approving a removed or rejected
 * one is how HO changes its mind; a withdrawn consent refuses it separately.
 */
export const ACTION_FROM: Record<HoAction, readonly SubmissionStatus[]> = {
  approve: ['submitted', 'rejected', 'removed'],
  reject: ['submitted'],
  remove: ['approved'],
};

export const canAct = (action: HoAction, from: SubmissionStatus): boolean =>
  ACTION_FROM[action].includes(from);

/**
 * Stockship's flags on the review row for each status. Only an approved one
 * is shown or carries its stars; a decided-against one sits in Stockship's
 * deleted tray, where no product page reads.
 */
export const sharedFlagsOf = (
  status: SubmissionStatus,
): { verified: boolean; deleted: boolean } => ({
  verified: status === 'approved',
  deleted: status === 'rejected' || status === 'removed',
});

/** Upload rules per kind. A minute of phone video at 720p is ~20–40 MB. */
export const UPLOAD_RULES: Record<
  Exclude<SubmissionKind, 'text'>,
  { maxBytes: number; types: Record<string, string> }
> = {
  video: {
    maxBytes: 60 * 1024 * 1024,
    types: {
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/3gpp': '3gp',
      'video/webm': 'webm',
    },
  },
  photo: {
    maxBytes: 10 * 1024 * 1024,
    types: {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
    },
  },
};

/** The app asks for "30–60 sec"; a little slack for the phone's own trim. */
export const VIDEO_MAX_SECONDS = 90;
/** How long a signed upload URL stays usable. */
export const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;

export const testimonialFolder = (agentId: string): string =>
  `vistaar/testimonials/${agentId}`;

const MEDIA_PATH =
  /^vistaar\/testimonials\/VST-\d+\/(video|photo)\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

/** `vistaar/testimonials/<agent>/<kind>/<uuid>.<ext>` — the kind is in the path. */
export const mediaPathFor = (
  agentId: string,
  kind: Exclude<SubmissionKind, 'text'>,
  id: string,
  ext: string,
): string => `${testimonialFolder(agentId)}/${kind}/${id}.${ext}`;

/**
 * Only a file in the caller's own folder, uploaded for this kind, may be
 * attached — a partner cannot put another partner's video on their story.
 */
export const ownsMedia = (
  agentId: string,
  kind: Exclude<SubmissionKind, 'text'>,
  path: string,
): boolean =>
  MEDIA_PATH.test(path) &&
  path.startsWith(`${testimonialFolder(agentId)}/${kind}/`);

/** The 1–5 stars the app asks for. */
export const RATING_MIN = 1;
export const RATING_MAX = 5;
