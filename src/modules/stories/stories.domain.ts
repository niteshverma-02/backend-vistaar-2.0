import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * My Story — the partner's WhatsApp Status maker. The app draws the
 * 1080 × 1920 image; the server keeps what it was drawn from (so the partner
 * can edit or re-share it on any phone), the image itself, a share count, and
 * the HO-managed festival greetings. Pure rules only.
 */

/** The app's `StoryTemplate` wire values. */
export const STORY_TEMPLATES = [
  'product',
  'testimonial',
  'tip',
  'meeting',
  'festival',
  'custom',
] as const;
export type StoryTemplate = (typeof STORY_TEMPLATES)[number];

export const STORY_LANGS = ['hi', 'en'] as const;
export type StoryLang = (typeof STORY_LANGS)[number];

/** Error messages name the language, never its code. */
const LANG_NAMES: Record<string, string> = { en: 'English', hi: 'Hindi' };
export const langName = (lang: string): string => LANG_NAMES[lang] ?? lang;

/**
 * A story's look is a design `key` from `vistaar_v2_story_content` (HO adds
 * and recolours them). The four below are the app's bundled ones, which it
 * draws even when the server's list is not loaded.
 */
export const BUILT_IN_DESIGNS = ['green', 'harvest', 'earth', 'sky'] as const;
export type StoryTheme = string;

export const PHOTO_MODES = ['background', 'inset'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

/** Where a share went — the app's four buttons. */
export const SHARE_CHANNELS = ['status', 'download', 'farmer', 'copy'] as const;
export type ShareChannel = (typeof SHARE_CHANNELS)[number];

/** The app's `maxSavedStories`: older ones drop off the list. */
export const MAX_SAVED_STORIES = 20;

export interface StoryFields {
  emoji: string;
  headline: string;
  body: string;
  detail1: string;
  detail2: string;
  detail3: string;
  price: string;
  mrp: string;
  stars: number;
}

export interface StoryConfig {
  template: StoryTemplate;
  lang: StoryLang;
  theme: StoryTheme;
  fields: StoryFields;
  show_whatsapp: boolean;
  photo_mode: PhotoMode;
  /**
   * The card it was made from when that is one of HO's custom cards (its
   * words are printed on the story); `null`/absent = the layout's own card.
   */
  card?: string | null;
}

/** What the app's picker chose, so "Edit" reopens on the same product or crop. */
export interface StorySelection {
  product_id: string;
  testimonial_id: string;
  crop_id: string;
  stage_idx: number;
  meeting_key: string;
  festival: string;
}

/**
 * Same config and same photo = the same story: saving it again moves it to
 * the top instead of adding a copy (the app's `sameStorySignature`). The
 * selection is left out, as in the app — it only says where the text came from.
 */
export function signatureOf(
  config: StoryConfig,
  photoPath: string | null,
): string {
  const f = config.fields;
  // Fixed key order, so the same story always hashes the same.
  const parts: unknown[] = [
    config.template,
    config.lang,
    config.theme,
    [
      f.emoji,
      f.headline,
      f.body,
      f.detail1,
      f.detail2,
      f.detail3,
      f.price,
      f.mrp,
      f.stars,
    ],
    config.show_whatsapp,
    config.photo_mode,
    photoPath ?? '',
  ];
  // Appended only when set, so stories saved before cards existed keep their signature.
  if (config.card) parts.push(config.card);
  const canonical = JSON.stringify(parts);
  return createHash('sha256').update(canonical).digest('hex');
}

// ── Images ──────────────────────────────────────────────────────────────

/**
 * `render` is the finished status image; `photo` is the partner's own photo
 * the story was drawn on, kept so "Edit" can redraw it.
 */
export const STORY_IMAGE_KINDS = ['render', 'photo'] as const;
export type StoryImageKind = (typeof STORY_IMAGE_KINDS)[number];

export const STORY_IMAGE_MAX_BYTES: Record<StoryImageKind, number> = {
  render: 3 * 1024 * 1024,
  photo: 5 * 1024 * 1024,
};

/**
 * Private, under the partner's own folder: the `VST-` id in the path is how
 * a partner is stopped from saving someone else's file as their story.
 */
export const storyImageFolder = (agentId: string): string =>
  `vistaar/stories/${agentId}`;

/** `<uuid>[~receipt].<ext>`; uploads made before receipts have none. */
export const STORY_IMAGE_PATTERN =
  /^vistaar\/stories\/VST-\d+\/[0-9a-f-]{36}(~[rp]~\d{1,5}x\d{1,5}~[0-9a-z]{1,10}~[0-9a-f]{20})?\.(jpg|png|webp)$/;

// ── Upload receipts ─────────────────────────────────────────────────────

/**
 * A story upload's file name carries a signed receipt — kind, pixel size and
 * when it was issued — so `POST /stories` can trust a fresh upload without
 * asking the bucket (two metadata calls, ~100 ms warm, 1–2 s cold). An old
 * or receipt-less path is still checked against the bucket: its file may
 * have gone with a story that was trimmed.
 */
export const RECEIPT_FRESH_MS = 60 * 60 * 1000;

export interface UploadReceipt {
  kind: StoryImageKind;
  width: number;
  height: number;
  issuedAt: number;
}

const receiptPayload = (
  folder: string,
  id: string,
  r: Omit<UploadReceipt, 'issuedAt'> & { issued: string },
) =>
  `story-upload|${folder}|${id}|${r.kind}|${r.width}x${r.height}|${r.issued}`;

const hmac = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('hex').slice(0, 20);

/** File stem for a new upload: `<uuid>~<r|p>~<w>x<h>~<issued>~<sig>`. */
export function receiptStem(
  folder: string,
  id: string,
  r: UploadReceipt,
  secret: string,
): string {
  const issued = Math.floor(r.issuedAt / 1000).toString(36);
  const sig = hmac(secret, receiptPayload(folder, id, { ...r, issued }));
  return `${id}~${r.kind[0]}~${r.width}x${r.height}~${issued}~${sig}`;
}

/** The receipt in `path` when its signature holds; `null` otherwise. */
export function readReceipt(
  path: string,
  secret: string,
): UploadReceipt | null {
  const m =
    /^(.*)\/([0-9a-f-]{36})~([rp])~(\d{1,5})x(\d{1,5})~([0-9a-z]{1,10})~([0-9a-f]{20})\.[a-z]+$/.exec(
      path,
    );
  if (!m) return null;
  const [, folder, id, k, w, h, issued, sig] = m;
  const kind: StoryImageKind = k === 'r' ? 'render' : 'photo';
  const width = Number(w);
  const height = Number(h);
  const expected = hmac(
    secret,
    receiptPayload(folder, id, { kind, width, height, issued }),
  );
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  ) {
    return null;
  }
  return { kind, width, height, issuedAt: parseInt(issued, 36) * 1000 };
}

export const ownsImage = (agentId: string, path: string): boolean =>
  STORY_IMAGE_PATTERN.test(path) &&
  path.startsWith(`${storyImageFolder(agentId)}/`);

/** A WhatsApp Status is 9:16; the app draws 1080 × 1920. */
const RENDER_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.02;
const RENDER_MIN_WIDTH = 540;
const RENDER_MAX_WIDTH = 2160;
const PHOTO_MIN_SIDE = 200;
const PHOTO_MAX_SIDE = 4096;

/** The sentence the app shows, or `null` when the image fits its kind. */
export function storyImageError(
  kind: StoryImageKind,
  width: number,
  height: number,
): string | null {
  if (kind === 'render') {
    if (width < RENDER_MIN_WIDTH || width > RENDER_MAX_WIDTH) {
      return `This story image is ${width} pixels wide. It must be between ${RENDER_MIN_WIDTH} and ${RENDER_MAX_WIDTH} pixels wide — 1080 × 1920 works best.`;
    }
    if (Math.abs(width / height - RENDER_RATIO) > RATIO_TOLERANCE) {
      return `This story image is ${width} × ${height} pixels. A status image must be tall, like 1080 × 1920 pixels.`;
    }
    return null;
  }
  if (Math.min(width, height) < PHOTO_MIN_SIDE) {
    return `This photo is too small (${width} × ${height} pixels). Please choose a photo at least ${PHOTO_MIN_SIDE} pixels on each side.`;
  }
  if (Math.max(width, height) > PHOTO_MAX_SIDE) {
    return `This photo is too large (${width} × ${height} pixels). Please choose a photo no more than ${PHOTO_MAX_SIDE} pixels on its longest side.`;
  }
  return null;
}

// ── Festivals (HO) ──────────────────────────────────────────────────────

export const FESTIVAL_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export interface FestivalText {
  headline: string;
  body: string;
}

export const FESTIVAL_STATUSES = [
  'live',
  'scheduled',
  'expired',
  'inactive',
] as const;
export type FestivalStatus = (typeof FESTIVAL_STATUSES)[number];

export interface FestivalWindow {
  is_active: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
}

export function festivalStatus(f: FestivalWindow, now: Date): FestivalStatus {
  if (!f.is_active) return 'inactive';
  if (f.ends_at && f.ends_at <= now) return 'expired';
  if (f.starts_at && f.starts_at > now) return 'scheduled';
  return 'live';
}

/**
 * The app opens My Story in English and falls back to it, so `en` is
 * required; every language that is sent needs both lines.
 */
export function festivalTextError(
  text: Record<string, Partial<FestivalText>>,
): string | null {
  if (!text.en) return 'Please add the greeting in English.';
  for (const [lang, t] of Object.entries(text)) {
    if (!t.headline?.trim() || !t.body?.trim()) {
      return `The ${langName(lang)} greeting needs both a headline and a message.`;
    }
  }
  return null;
}

export function windowError(
  startsAt: Date | null,
  endsAt: Date | null,
): string | null {
  if (startsAt && endsAt && endsAt <= startsAt) {
    return 'The end date must be after the start date.';
  }
  return null;
}

// ── Designs (HO) ────────────────────────────────────────────────────────

/** Same shape as a festival key: it is what a saved story's `theme` keeps. */
export const DESIGN_KEY = FESTIVAL_KEY;

/** Colours the app paints with; `#RRGGBB` or `#RRGGBBAA` (alpha last). */
export const DESIGN_COLOR_KEYS = [
  'bg_from',
  'bg_to',
  'text',
  'subtext',
  'accent',
  'accent_text',
  'soft',
  'deco',
  'avatar',
] as const;
export type DesignColorKey = (typeof DESIGN_COLOR_KEYS)[number];
export type DesignColors = Record<DesignColorKey, string>;

/** HO must pick these; the rest follow from them when left out. */
export const REQUIRED_DESIGN_COLORS = [
  'bg_from',
  'bg_to',
  'text',
  'accent',
] as const satisfies readonly DesignColorKey[];

export const HEX_COLOR = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** The names the HO design editor shows for each colour. */
const COLOR_NAMES: Record<DesignColorKey, string> = {
  bg_from: 'background (top)',
  bg_to: 'background (bottom)',
  text: 'text',
  subtext: 'small text',
  accent: 'highlight',
  accent_text: 'highlight text',
  soft: 'panel',
  deco: 'decoration',
  avatar: 'photo circle',
};
const colorName = (key: string): string =>
  COLOR_NAMES[key as DesignColorKey] ?? key;

/** `#RRGGBB` + alpha byte; an 8-digit colour keeps its own alpha. */
function withAlpha(hex: string, alpha: number): string {
  const base = hex.slice(0, 7);
  const byte = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${base}${byte}`.toUpperCase();
}

/**
 * The full palette from what HO sent: the four required colours, and the
 * optional ones derived the way the bundled designs are built (light panels
 * in the text colour, the avatar in the first background colour).
 */
export function completeColors(
  input: Partial<Record<DesignColorKey, string>>,
): { colors: DesignColors } | { error: string } {
  for (const key of REQUIRED_DESIGN_COLORS) {
    if (!input[key]) {
      return { error: `Please choose the ${colorName(key)} colour.` };
    }
  }
  for (const [key, value] of Object.entries(input)) {
    if (!(DESIGN_COLOR_KEYS as readonly string[]).includes(key)) {
      return { error: 'One of the colours is not part of a design.' };
    }
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      return {
        error: `The ${colorName(key)} colour is not valid. Use a colour code, for example #1D5A26.`,
      };
    }
  }
  const up = (v: string) => v.toUpperCase();
  const text = up(input.text!);
  const bgFrom = up(input.bg_from!);
  return {
    colors: {
      bg_from: bgFrom,
      bg_to: up(input.bg_to!),
      text,
      subtext: up(input.subtext ?? withAlpha(text, 0.82)),
      accent: up(input.accent!),
      accent_text: up(input.accent_text ?? bgFrom.slice(0, 7)),
      soft: up(input.soft ?? withAlpha('#FFFFFF', 0.16)),
      deco: up(input.deco ?? withAlpha('#FFFFFF', 0.07)),
      avatar: up(input.avatar ?? bgFrom.slice(0, 7)),
    },
  };
}

/** WCAG relative luminance of `#RRGGBB[AA]` (alpha ignored). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Below this, the headline is hard to read on a phone in the sun. */
const MIN_CONTRAST = 3;

/**
 * Advice for the portal, never a refusal: HO may want a soft look, and an
 * image design's art decides readability more than its colours do.
 */
export function designWarnings(
  colors: DesignColors,
  hasImage: boolean,
): string[] {
  const warnings: string[] = [];
  if (!hasImage) {
    for (const key of ['bg_from', 'bg_to'] as const) {
      const ratio = contrastRatio(colors.text, colors[key]);
      if (ratio < MIN_CONTRAST) {
        warnings.push(
          `The text may be hard to read on the ${colorName(key)} colour. Try a darker or lighter colour.`,
        );
      }
    }
  }
  const pill = contrastRatio(colors.accent_text, colors.accent);
  if (pill < MIN_CONTRAST) {
    warnings.push(
      'The highlight text may be hard to read on the highlight colour. Try a darker or lighter colour.',
    );
  }
  return warnings;
}

/** Public art (every partner draws it), cached forever by its path. */
export const DESIGN_IMAGE_FOLDER = 'vistaar/story-designs';
export const DESIGN_IMAGE_PATTERN =
  /^vistaar\/story-designs\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export const DESIGN_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const DESIGN_IMAGE_HINT =
  'a tall 1080 × 1920 pixel JPG, PNG or WEBP image, up to 3 MB';
const DESIGN_MIN_WIDTH = 720;
const DESIGN_MAX_WIDTH = 2160;

/** Design art fills the whole status, so it must be 9:16 like the status itself. */
export function designImageError(width: number, height: number): string | null {
  if (width < DESIGN_MIN_WIDTH || width > DESIGN_MAX_WIDTH) {
    return `This image is ${width} pixels wide. It must be between ${DESIGN_MIN_WIDTH} and ${DESIGN_MAX_WIDTH} pixels wide. Please use ${DESIGN_IMAGE_HINT}.`;
  }
  if (Math.abs(width / height - RENDER_RATIO) > RATIO_TOLERANCE) {
    return `This image is ${width} × ${height} pixels, but a design must be tall (9:16). Please use ${DESIGN_IMAGE_HINT}.`;
  }
  return null;
}

/** How much of `bg_from` is laid over the art so the text stays readable. */
export const DEFAULT_IMAGE_OVERLAY = 0.35;
export const MAX_OVERLAY = 0.9;

// ── Templates (HO) ──────────────────────────────────────────────────────

/**
 * "Choose a design" cards. The six built-in ones (`_id` = the layout) can be
 * edited and hidden, never deleted. HO adds custom cards on top: each reuses
 * one of the six layouts (`base`, drawn by the app) with its own name, words,
 * default text and design — a Diwali offer is the Product layout in Diwali
 * art. `suggested` cards lead the strip with a badge.
 */
export const TEMPLATE_KEY = FESTIVAL_KEY;

/** Text a card pre-fills, per language; empty or absent = the layout's default. */
export const TEMPLATE_FIELD_KEYS = [
  'emoji',
  'headline',
  'body',
  'detail1',
  'detail2',
  'detail3',
] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELD_KEYS)[number];
export type TemplateFields = Partial<Record<TemplateFieldKey, string>>;

const FIELD_NAMES: Record<TemplateFieldKey, string> = {
  emoji: 'emoji',
  headline: 'headline',
  body: 'message',
  detail1: 'first detail line',
  detail2: 'second detail line',
  detail3: 'third detail line',
};
const fieldName = (key: string): string =>
  FIELD_NAMES[key as TemplateFieldKey] ?? key;

export function templateFieldsError(
  fields: Record<string, TemplateFields>,
): string | null {
  for (const [lang, f] of Object.entries(fields)) {
    if (!(STORY_LANGS as readonly string[]).includes(lang)) {
      return 'Ready-made text can only be in English or Hindi.';
    }
    if (typeof f !== 'object' || f === null)
      return `The ${langName(lang)} ready-made text is not valid.`;
    for (const [key, value] of Object.entries(f)) {
      if (!(TEMPLATE_FIELD_KEYS as readonly string[]).includes(key)) {
        return `The ${langName(lang)} ready-made text has a box a card cannot fill. Use only emoji, headline, message and the three detail lines.`;
      }
      if (typeof value !== 'string')
        return `The ${langName(lang)} ready-made ${fieldName(key)} must be text.`;
      if (value.length > (key === 'body' ? 400 : 120)) {
        return `The ${langName(lang)} ready-made ${fieldName(key)} is too long. Please shorten it.`;
      }
    }
  }
  return null;
}
export interface TemplateTexts {
  /** Line at the top of the story, e.g. "Special offer". */
  kicker: string;
  /** Call to action printed under the content; '' = none. */
  cta: string;
}

/** `en` is required (the app falls back to it); each sent language needs a kicker. */
export function templateTextsError(
  texts: Record<string, Partial<TemplateTexts>>,
): string | null {
  if (!texts.en) return 'Please add the card words in English.';
  for (const [lang, t] of Object.entries(texts)) {
    if (!(STORY_LANGS as readonly string[]).includes(lang)) {
      return 'Card words can only be in English or Hindi.';
    }
    if (!t.kicker?.trim())
      return `Please add the ${langName(lang)} top line of the card.`;
    if (typeof t.cta !== 'string')
      return `The ${langName(lang)} closing line must be text. Leave it empty for none.`;
  }
  return null;
}

export const MAX_TEMPLATE_EMOJIS = 24;

// ── Stats ───────────────────────────────────────────────────────────────

/** Partners work in India; a share counts on the IST day it was made. */
const IST_OFFSET_MS = 330 * 60_000;

export function istDate(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` `n` days before `date`. */
export function shiftDate(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_STATS_DAYS = 30;
/** One quarter: the summary reads one row per partner per day. */
export const MAX_STATS_DAYS = 92;

/** `from` / `to` resolved against today, or the sentence the portal shows. */
export function statsRange(
  from: string | undefined,
  to: string | undefined,
  today: string,
): { from: string; to: string } | { error: string } {
  const end = to ?? today;
  const start = from ?? shiftDate(end, DEFAULT_STATS_DAYS - 1);
  if (start > end)
    return { error: 'The start date must be on or before the end date.' };
  if (start < shiftDate(end, MAX_STATS_DAYS - 1)) {
    return {
      error: `Please choose a period of ${MAX_STATS_DAYS} days or less.`,
    };
  }
  return { from: start, to: end };
}
