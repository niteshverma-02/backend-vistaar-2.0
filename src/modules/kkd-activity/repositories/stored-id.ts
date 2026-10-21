import { Types } from 'mongoose';

/** A warehouse id as stored — a `WH-*` string on some rows, an ObjectId on others. */
export function idString(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  return v instanceof Types.ObjectId ? v.toHexString() : null;
}
