import {
  fieldIndex,
  type FieldDef,
  type RawData,
  type StepDef,
} from './form.domain';

/** ko-sales' `piis.documents` key the form's bank-proof field carries. */
export const BANK_DOCUMENT = 'bank_details';
/** Where the form's payout account lands on the partner profile. */
export const BANK_ACCOUNT_FIELD = 'details.bank_account';

export type BankChangeStatus =
  'pending' | 'approved' | 'rejected' | 'withdrawn';

/**
 * An approved partner's request to be paid into another account. The form's
 * account and proof change only when HO approves, so payouts keep going to the
 * verified account until then.
 */
export interface BankChange {
  status: BankChangeStatus;
  account_holder: string;
  account_number: string;
  ifsc: string;
  /** Cheque or passbook photo under the partner's `KO-documents/<pii_id>/`. */
  proof_path: string;
  requested_at: Date;
  decided_at: Date | null;
  /** HO's email, or `self` when the partner withdrew it. */
  decided_by: string | null;
  /** Why HO refused it. */
  reason: string | null;
}

export type BankRequest = Pick<
  BankChange,
  'account_holder' | 'account_number' | 'ifsc' | 'proof_path'
>;

/**
 * The form's payout-account field and bank-proof document, found by what they
 * are (`maps_to`, `org_document`) — the same way payouts find them.
 */
export function bankFields(steps: StepDef[]): {
  account: FieldDef | null;
  proof: FieldDef | null;
} {
  const fields = [...fieldIndex(steps).values()];
  return {
    account: fields.find((f) => f.maps_to === BANK_ACCOUNT_FIELD) ?? null,
    proof: fields.find((f) => f.org_document === BANK_DOCUMENT) ?? null,
  };
}

/**
 * The form values the change writes. Sub-fields the request does not name
 * (a UPI ID) are kept: the partner is changing the account, not the rest.
 */
export function bankValues(
  current: unknown,
  change: BankRequest,
): { account: RawData; proof: RawData } {
  const kept =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as RawData)
      : {};
  return {
    account: {
      ...kept,
      account_holder: change.account_holder,
      account_number: change.account_number,
      ifsc: change.ifsc,
    },
    proof: { files: [change.proof_path] },
  };
}

export const last4 = (accountNumber: string): string => accountNumber.slice(-4);
