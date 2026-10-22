import type { StoryContentKind } from '../schemas/story-content.schema';

/** A kind's row as `vistaar_v2_story_content` holds it. */
export type StoredContent<T extends { _id: string }> = T & {
  kind: StoryContentKind;
  key: string;
};

/** The kind in the id keeps every kind's ids apart in the one collection. */
export const storedId = (kind: StoryContentKind, id: string): string =>
  `${kind}:${id}`;

/** A row put in by hand without the prefix still opens under its own id. */
export function apiId(kind: StoryContentKind, id: string): string {
  const prefix = `${kind}:`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

/** A card has no `key` field of its own: its id is its key. */
function keyOf(kind: StoryContentKind, row: { _id: string; key?: unknown }) {
  if (kind === 'template') return row._id;
  if (typeof row.key !== 'string' || !row.key) {
    throw new Error(`${kind} ${row._id} has no key`);
  }
  return row.key;
}

/** The API's row → the stored one. Also how the old collections' rows are copied in. */
export function toStored<T extends { _id: string }>(
  kind: StoryContentKind,
  row: T,
): StoredContent<T> {
  return {
    ...row,
    _id: storedId(kind, row._id),
    kind,
    key: keyOf(kind, row),
  };
}

/** The stored row → exactly the row the API returned before the merge. */
export function fromStored<T extends { _id: string }>(
  kind: StoryContentKind,
  row: StoredContent<T>,
): T {
  const out: Record<string, unknown> = { ...row, _id: apiId(kind, row._id) };
  delete out.kind;
  if (kind === 'template') delete out.key;
  return out as unknown as T;
}
