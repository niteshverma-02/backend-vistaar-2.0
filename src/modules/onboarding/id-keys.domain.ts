import { createHash } from 'node:crypto';

import { fieldIndex, type RawData, type StepDef } from './form.domain';

/** ko-sales' `piis.documents` keys — the org spells Aadhaar `adhar`. */
export const AADHAAR_DOCUMENT = 'adhar';
export const PAN_DOCUMENT = 'pan';

export type IdKind = 'aadhaar' | 'pan';

/**
 * What makes a partner one person, kept for the duplicate check. Aadhaar only
 * as a hash, so the number never leaves `raw_data`.
 */
export interface IdKeys {
  aadhaar_hash: string | null;
  pan: string | null;
}

export interface IdHolder {
  agent_ref: string;
  agent_id: string;
  id_keys?: IdKeys;
}

export interface DuplicateIds {
  kind: IdKind;
  agent_ids: string[];
}

export function normaliseAadhaar(value: string): string | null {
  const digits = value.replace(/[\s-]/g, '');
  return /^\d{12}$/.test(digits) ? digits : null;
}

export function normalisePan(value: string): string | null {
  return value.replace(/\s/g, '').toUpperCase() || null;
}

/** The form's Aadhaar and PAN field keys, found by `org_document`, not by key. */
export function idFieldKeys(steps: StepDef[]): Record<IdKind, string | null> {
  const fields = [...fieldIndex(steps).values()];
  const keyOf = (doc: string) =>
    fields.find((f) => f.org_document === doc)?.key ?? null;
  return { aadhaar: keyOf(AADHAAR_DOCUMENT), pan: keyOf(PAN_DOCUMENT) };
}

export function idKeysOf(steps: StepDef[], raw: RawData): IdKeys {
  const keys = idFieldKeys(steps);
  const numberOf = (key: string | null): string | null => {
    const value = key ? raw[key] : null;
    if (!value || typeof value !== 'object') return null;
    const n = (value as { number?: unknown }).number;
    return typeof n === 'string' ? n : null;
  };
  const aadhaar = numberOf(keys.aadhaar);
  const normal = aadhaar ? normaliseAadhaar(aadhaar) : null;
  const pan = numberOf(keys.pan);
  return {
    aadhaar_hash: normal
      ? createHash('sha256').update(normal).digest('hex')
      : null,
    pan: pan ? normalisePan(pan) : null,
  };
}

/** Other partners holding the same value, per kind; the caller is never one. */
export function duplicatesOf(
  mine: IdKeys,
  agentRef: string,
  holders: readonly IdHolder[],
): DuplicateIds[] {
  const others = holders.filter((h) => h.agent_ref !== agentRef);
  const out: DuplicateIds[] = [];
  const match = (kind: IdKind, field: keyof IdKeys) => {
    const value = mine[field];
    if (!value) return;
    const agentIds = others
      .filter((h) => h.id_keys?.[field] === value)
      .map((h) => h.agent_id);
    if (agentIds.length) out.push({ kind, agent_ids: [...new Set(agentIds)] });
  };
  match('aadhaar', 'aadhaar_hash');
  match('pan', 'pan');
  return out;
}

const LABEL: Record<IdKind, string> = { aadhaar: 'Aadhaar', pan: 'PAN' };

export function idInUseMessage(kinds: readonly IdKind[]): string {
  const what = kinds.map((k) => LABEL[k]).join(' and ');
  return `This ${what} is already used by another Vistaar account. Contact Katyayani support.`;
}
