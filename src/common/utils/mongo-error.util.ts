/** Mongo's duplicate-key error (E11000), whichever driver class raised it. */
export const isDuplicateKey = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === 11000;
