/**
 * The online payment options the app's Pay online screen can offer.
 *
 * The set is closed in code on purpose: a new gateway needs its SDK, its
 * signature check and its webhook before it can take money, so HO can switch
 * one on or off but never add one. Merchant keys never live in the database —
 * a stolen HO session must not be able to point payments at another account.
 */
export const PAYMENT_PROVIDERS = ['razorpay', 'cashfree', 'phonepe'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const isPaymentProvider = (v: string): v is PaymentProvider =>
  (PAYMENT_PROVIDERS as readonly string[]).includes(v);

export const LABEL_MAX = 40;
export const HINT_MAX = 80;

/** What an option shows before HO first saves it — off, so nothing goes live by default. */
export const PROVIDER_DEFAULTS: Record<
  PaymentProvider,
  { label: string; hint: string; order: number }
> = {
  razorpay: { label: 'Razorpay', hint: 'UPI, cards, net banking', order: 0 },
  cashfree: { label: 'Cashfree', hint: 'UPI, cards, net banking', order: 1 },
  phonepe: { label: 'PhonePe', hint: 'PhonePe or any UPI app', order: 2 },
};

/**
 * Gateways whose merchant keys live in KO Utils, not here: Utils creates the
 * gateway order with its own secret (Cashfree: `POST /cashfree/order`) and the
 * app opens the checkout with the session it answers, so HO only switches these
 * on or off. User's decision, 2026-10-21.
 */
export const KEYLESS_PROVIDERS: readonly PaymentProvider[] = ['cashfree'];

export const needsKeys = (provider: PaymentProvider): boolean =>
  !KEYLESS_PROVIDERS.includes(provider);

export interface PaymentOptionRule {
  is_active: boolean;
  cohorts: readonly string[];
}

/** An empty cohort list means every partner; a partner with no cohort sees only those. */
export function isShownTo(
  option: PaymentOptionRule,
  cohort: string | null,
): boolean {
  if (!option.is_active) return false;
  if (option.cohorts.length === 0) return true;
  return cohort !== null && option.cohorts.includes(cohort);
}

/**
 * Plain text only: the tile shows it as is, and a link or markup there could
 * send a farmer somewhere that looks like a payment page.
 */
const UNSAFE_TEXT = /[<>]|https?:\/\/|www\./i;

export function textError(
  field: 'label' | 'hint',
  value: string,
): string | null {
  const max = field === 'label' ? LABEL_MAX : HINT_MAX;
  const name = field === 'label' ? 'name' : 'hint';
  if (field === 'label' && !value.trim()) return 'Please enter a name.';
  if (value.length > max)
    return `The ${name} can be at most ${max} characters.`;
  if (UNSAFE_TEXT.test(value))
    return `The ${name} cannot contain links or < > characters.`;
  return null;
}

/** A reorder must name every option exactly once. */
export function orderError(ids: readonly string[]): string | null {
  const unique = new Set(ids);
  if (
    unique.size !== ids.length ||
    ids.length !== PAYMENT_PROVIDERS.length ||
    !ids.every(isPaymentProvider)
  ) {
    return `Please send every payment option once: ${PAYMENT_PROVIDERS.join(', ')}.`;
  }
  return null;
}

/**
 * Who did it, as every payment audit row records it: one spelling per
 * person, so the two-person rule and the trail compare like with like.
 */
export const actorOf = (email: string): string => email.trim().toLowerCase();
