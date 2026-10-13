/**
 * Home-screen banners HO pushes to partners (PRD H3), targeted by cohort
 * (PRD AD10). Pure rules — what is live, for whom, and what HO may save.
 */

/** The app's `BannerTone` — each one is a gradient in `banner_carousel.dart`. */
export const BANNER_TONES = ['primary', 'warning', 'success', 'info'] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

export const BANNER_STATUSES = [
  'live',
  'scheduled',
  'expired',
  'inactive',
] as const;
export type BannerStatus = (typeof BANNER_STATUSES)[number];

/** A carousel past this many slides is never swiped to the end. */
export const MAX_LIVE_BANNERS = 10;

/**
 * An in-app route the app opens with `context.push(link)`, e.g. `/products`
 * or `/products/p8?tab=info`. A web URL would crash the router, so none.
 */
export const LINK_PATTERN = /^\/[A-Za-z0-9\-._~/?=&%]*$/;

/**
 * Banner art lives here in the org bucket, readable by every partner —
 * apart from `KO-documents/`, which is private KYC.
 */
export const BANNER_IMAGE_FOLDER = 'vistaar/banners';
export const BANNER_IMAGE_PATTERN =
  /^vistaar\/banners\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/**
 * Banner art is downloaded by every partner on mobile data, so it is kept
 * small. HEIC and PDF are out: the app's image widget cannot draw them.
 */
export const BANNER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const BANNER_IMAGE_MIN_WIDTH = 600;
/**
 * Every banner is the same 2.4:1 slide, so the carousel never changes height
 * between slides. The portal crops to exactly this; the tolerance only absorbs
 * whole-pixel rounding (e.g. 1000 × 417).
 */
export const BANNER_IMAGE_RATIO = 2.4;
const RATIO_TOLERANCE = 0.03;
export const BANNER_IMAGE_HINT =
  'Best size: 1200 × 500 pixels (JPG, PNG or WEBP, up to 2 MB).';

/** The sentence the HO screen shows, or `null` when the art fits the slide. */
export function imageSizeError(width: number, height: number): string | null {
  if (width < BANNER_IMAGE_MIN_WIDTH) {
    return `This image is too small (${width} pixels wide). A banner must be at least ${BANNER_IMAGE_MIN_WIDTH} pixels wide. ${BANNER_IMAGE_HINT}`;
  }
  if (Math.abs(width / height - BANNER_IMAGE_RATIO) > RATIO_TOLERANCE) {
    return `This image is ${width} × ${height} pixels, but a banner must be 2.4 times as wide as it is tall (at this width: ${width} × ${Math.round(width / BANNER_IMAGE_RATIO)} pixels). ${BANNER_IMAGE_HINT}`;
  }
  return null;
}

/** A reorder names every banner; far above any real book, only a bound on the body. */
export const BANNER_REORDER_MAX = 200;

export interface BannerContent {
  image_path: string | null;
  subtitle: Record<string, string> | null;
  cta: Record<string, string> | null;
}

/**
 * Two kinds of banner: HO's own art (an image, tapped as a whole), or one the
 * app draws from text, tone and emoji — which needs its subtitle and button.
 */
export function contentError(banner: BannerContent): string | null {
  if (banner.image_path) return null;
  for (const key of ['subtitle', 'cta'] as const) {
    if (!banner[key]?.en?.trim()) {
      return `A banner without an image needs an English ${key === 'cta' ? 'button text' : 'subtitle'}.`;
    }
  }
  return null;
}

export interface BannerWindow {
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
}

export function statusOf(banner: BannerWindow, now: Date): BannerStatus {
  if (!banner.is_active) return 'inactive';
  if (banner.ends_at && banner.ends_at <= now) return 'expired';
  if (banner.starts_at && banner.starts_at > now) return 'scheduled';
  return 'live';
}

/** An empty `cohorts` list means every partner. */
export function isShownTo(
  banner: BannerWindow & { cohorts: string[] },
  cohort: string | null,
  now: Date,
): boolean {
  if (statusOf(banner, now) !== 'live') return false;
  if (banner.cohorts.length === 0) return true;
  return cohort !== null && banner.cohorts.includes(cohort);
}

/** The sentence the HO screen shows, or `null` when the window is fine. */
export function windowError(
  startsAt: Date | null,
  endsAt: Date | null,
): string | null {
  if (startsAt && endsAt && endsAt <= startsAt) {
    return 'The end date must be after the start date.';
  }
  return null;
}
