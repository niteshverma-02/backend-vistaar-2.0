/**
 * Vistaar's partner T&C lives in the shared `terms_and_conditions`
 * collection, in its existing shape: one row per document version, the
 * document itself behind `link`. A row is Vistaar's by `profiles: ['vistaar']`
 * — the same field the other apps read theirs by.
 */

export const VISTAAR_PROFILE = 'vistaar';

/** `TOC-n` — the collection's own id series, unique across every app's rows. */
export const TOC_ID = /^TOC-[1-9]\d*$/;

export const tocId = (n: number): string => `TOC-${n}`;
