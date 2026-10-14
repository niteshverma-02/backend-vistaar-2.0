/**
 * Who may do what on the HO portal's Vistaar screens — the same shape as
 * franchise-offline-hub's `franchise-scope.ts`, so the portal gates both the
 * same way.
 *
 * The role is the company-wide `agents_v2.user_role` (a `USR-nnnn` id in the
 * `userroles` directory ko-sales owns). Only that field is read — not the
 * separate `user_roles[]` array, which is StockShip v3 / Sankalp's own RBAC.
 */
/** Offline Head — the HO portal head, and the owner of farmer leads. */
export const OFFLINE_HEAD_ROLE = 'USR-1037';

/** Company admins: everything a head can do, plus the merchant payment keys. */
export const ADMIN_ROLE_CODES: ReadonlySet<string> = new Set([
  'USR-1000', // Super Admin
  'USR-1001', // Admin
]);

export const HEAD_ROLE_CODES: ReadonlySet<string> = new Set([
  OFFLINE_HEAD_ROLE,
  ...ADMIN_ROLE_CODES,
]);

/** `admin` holds every `head` capability, so the table names only what is admin-only. */
export type Role = 'head' | 'admin';

/**
 * One table, so a route cannot ship without a rule. Add a role (e.g. a KYC
 * verifier) by adding its code above and naming it on the capabilities it
 * gets here.
 */
export const CAPABILITIES = {
  /** See the pipeline, an applicant's onboarding data and the nearby check. */
  'agents.read': ['head'],
  /** Correct an applicant's onboarding data (audited). */
  'agents.edit': ['head'],
  /** Verify or reject one KYC document. */
  'kyc.review': ['head'],
  /** Approve, reject, request changes, block, unblock, reopen. */
  'agents.decide': ['head'],
  /** Change who owns an applicant. */
  'agents.assign': ['head'],
  /** Read cohorts and onboarding configs, drafts included. */
  'config.read': ['head'],
  /** Create and edit cohorts and draft configs. */
  'config.write': ['head'],
  /** Publish a draft config — the app starts showing it at once. */
  'config.publish': ['head'],
  /** Every partner's farmer leads. */
  'leads.read': ['head'],
  /** Move a farmer to another partner (PRD AD8). */
  'leads.transfer': ['head'],
  /** Default owner, conflict radius. */
  'settings.write': ['head'],
  /** See the app's Home banners, scheduled and ended ones included. */
  'content.read': ['head'],
  /** Add, edit, schedule, target and delete banners — the app shows them within a minute. */
  'content.write': ['head'],
  /** See Vistaar's product testimonials (source vistaar only), removed ones included. */
  'testimonials.read': ['head'],
  /** Add, approve, remove, restore, correct and delete Vistaar's testimonials. */
  'testimonials.write': ['head'],
  /** See every partner's punch-ins and punch-outs; nobody punches for a partner. */
  'attendance.read': ['head'],
  /** See My Story activity (who shares what) and partners' saved stories. */
  'stories.read': ['head'],
  /** Take a story off a partner's list. Festivals are `content.write`. */
  'stories.write': ['head'],
  /** See every partner's placed orders (Stockship `orders_v2`, source vistaar). Read-only. */
  'orders.read': ['head'],
  /** See partners' NPS answers, call-backs and product suggestions. */
  'feedback.read': ['head'],
  /** Close or reopen call-backs, edit the reason chips, triage suggestions. */
  'feedback.write': ['head'],
  /** See the app's online payment options and who changed them. */
  'payments.read': ['head'],
  /** Switch a payment option on or off, rename, retarget or reorder it. */
  'payments.write': ['head'],
  /**
   * Submit, check, approve, reject and revoke merchant keys. Company admins
   * only — not the Offline Head — and the two-person rule means a second
   * admin approves what one submitted.
   */
  'payments.credentials': ['admin'],
  /** See commission plans, any partner's commission and wallet, and payout totals. */
  'commission.read': ['head'],
  /** Add and change commission plans (this month and later; past months stay as paid). */
  'commission.plans': ['head'],
  /**
   * Approve, reject and mark withdrawals paid; the bank file (account numbers)
   * and Form 16A. Heads until Finance has a role code of its own.
   */
  'payouts.manage': ['head'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export const can = (role: Role, cap: Capability): boolean => {
  const roles = CAPABILITIES[cap] as readonly Role[];
  return roles.includes(role) || (role === 'admin' && roles.includes('head'));
};

export const capabilitiesOf = (role: Role): Capability[] =>
  (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));

/**
 * People who never get a capability their role would give them, by email.
 * In code, not in a setting, so taking someone off money takes a reviewed
 * change rather than a click.
 */
const WITHHELD: Partial<Record<Capability, ReadonlySet<string>>> = {
  // User's decision, 2026-10-14.
  'payments.credentials': new Set(['robinsingh@katyayaniorganics.com']),
};

/** What this person may do: the role's capabilities minus any withheld from them. */
export function capabilitiesFor(role: Role, email: string): Capability[] {
  const who = email.trim().toLowerCase();
  return capabilitiesOf(role).filter((c) => !WITHHELD[c]?.has(who));
}

/** The role an active account's `user_role` grants, or `null` for none. */
export function roleOf(
  userRole: string | null | undefined,
  active: boolean,
): Role | null {
  if (!active || !userRole) return null;
  if (ADMIN_ROLE_CODES.has(userRole)) return 'admin';
  return HEAD_ROLE_CODES.has(userRole) ? 'head' : null;
}
