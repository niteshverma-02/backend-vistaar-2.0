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

export const HEAD_ROLE_CODES: ReadonlySet<string> = new Set([
  OFFLINE_HEAD_ROLE,
  'USR-1000', // Super Admin
  'USR-1001', // Admin
]);

export type Role = 'head';

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
  /** Default owner, conflict radius. */
  'settings.write': ['head'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export const can = (role: Role, cap: Capability): boolean =>
  (CAPABILITIES[cap] as readonly Role[]).includes(role);

export const capabilitiesOf = (role: Role): Capability[] =>
  (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(role, c));

/** The role an active account's `user_role` grants, or `null` for none. */
export function roleOf(
  userRole: string | null | undefined,
  active: boolean,
): Role | null {
  if (!active || !userRole) return null;
  return HEAD_ROLE_CODES.has(userRole) ? 'head' : null;
}
