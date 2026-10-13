/**
 * The partner pipeline — the stages the HO portal's tabs are built from.
 *
 *   signed_up → onboarding → kyc_review → approved
 *                   ↑            │  └──→ rejected ──(reopen)──→ onboarding
 *                   │            ↓
 *                   └── changes_requested (partner fixes the flagged fields)
 *
 * `blocked` can be entered from any stage and returns to the one it left.
 */
/**
 * `userroles` id every partner carries. Partners live here, not in
 * `agents_v2`; their head is Offline Head (USR-1037, see `access.domain`).
 */
export const PARTNER_ROLE_CODE = 'USR-1040';

export const STAGES = [
  'signed_up',
  'onboarding',
  'kyc_review',
  'changes_requested',
  'approved',
  'rejected',
  'blocked',
] as const;

export type Stage = (typeof STAGES)[number];

/** Stages in which the partner may still write their onboarding data. */
export const PARTNER_EDITABLE: ReadonlySet<Stage> = new Set([
  'signed_up',
  'onboarding',
  'changes_requested',
]);

export type StageAction =
  | 'start_onboarding'
  | 'submit'
  | 'request_changes'
  | 'approve'
  | 'reject'
  | 'reopen'
  | 'block';

/** Where each action may start from, and where it lands. */
export const TRANSITIONS: Record<
  StageAction,
  { from: readonly Stage[]; to: Stage }
> = {
  start_onboarding: { from: ['signed_up'], to: 'onboarding' },
  submit: { from: ['onboarding', 'changes_requested'], to: 'kyc_review' },
  request_changes: { from: ['kyc_review'], to: 'changes_requested' },
  approve: { from: ['kyc_review'], to: 'approved' },
  reject: { from: ['kyc_review', 'changes_requested'], to: 'rejected' },
  reopen: { from: ['rejected'], to: 'onboarding' },
  block: {
    from: [
      'signed_up',
      'onboarding',
      'kyc_review',
      'changes_requested',
      'approved',
      'rejected',
    ],
    to: 'blocked',
  },
};

export const canMove = (action: StageAction, stage: Stage): boolean =>
  TRANSITIONS[action].from.includes(stage);

/** A stage as HO staff say it, to finish "This partner is …". */
export const STAGE_LABELS: Record<Stage, string> = {
  signed_up: 'signed up but has not started the form',
  onboarding: 'still filling the form',
  kyc_review: 'in KYC review',
  changes_requested: 'waiting to make the changes asked for',
  approved: 'already approved',
  rejected: 'rejected',
  blocked: 'blocked',
};

/** An action as HO staff say it, to finish "You cannot … this partner". */
export type RefusedAction = StageAction | 'unblock' | 'edit';

export const ACTION_LABELS: Record<RefusedAction, string> = {
  start_onboarding: 'start onboarding for',
  submit: 'submit the form for',
  request_changes: 'ask for changes from',
  approve: 'approve',
  reject: 'reject',
  reopen: 'reopen',
  block: 'block',
  unblock: 'unblock',
  edit: 'edit the form of',
};

/** Why a stage move was refused, in words HO staff use. */
export const stageRefusal = (action: RefusedAction, stage: Stage): string =>
  `You cannot ${ACTION_LABELS[action]} this partner right now. This partner is ${STAGE_LABELS[stage]}.`;
