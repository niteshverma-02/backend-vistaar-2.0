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
export type RefusedAction =
  StageAction | 'unblock' | 'edit' | 'verification_call';

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
  verification_call: 'log a verification call for',
};

/** Why a stage move was refused, in words HO staff use. */
export const stageRefusal = (action: RefusedAction, stage: Stage): string =>
  `You cannot ${ACTION_LABELS[action]} this partner right now. This partner is ${STAGE_LABELS[stage]}.`;

/** What HO's verification call (PRD K1 / AD2) came to. */
export const CALL_OUTCOMES = ['reached', 'not_reached', 'verified'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

/** HO may log a call until the partner is decided; the call is not a stage. */
export const CALLABLE_STAGES: readonly Stage[] = [
  'signed_up',
  'onboarding',
  'kyc_review',
  'changes_requested',
];

/** The app's status steps, in the order it shows them. */
export const TIMELINE_STEPS = [
  'applied',
  'verification_call',
  'documents_review',
  'approved',
  'active',
] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

export interface TimelineEntry {
  step: TimelineStep;
  /** When the step was reached; `null` when nothing recorded it. */
  at: Date | null;
  /** Reached. */
  done: boolean;
}

const later = (a: Date, b: Date): Date => (a.getTime() >= b.getTime() ? a : b);

/**
 * Applied = the first submit (the only move into `kyc_review`); the call =
 * the first `verified` one; documents are under review once both happened;
 * approved = the first move into `approved` (an unblock also lands there).
 *
 * Active needs Product Knowledge L1 (PK-L1), which does not exist yet — until
 * it does, an approved partner who is not blocked or switched off is active.
 *
 * A later step reached means the earlier ones were passed even when nothing
 * recorded them (partners approved before calls were logged), so `done`
 * never has gaps; their `at` stays `null`.
 */
export const partnerTimeline = (agent: {
  stage: Stage;
  is_active: boolean;
  stage_history: readonly { to: Stage; at: Date }[];
  verification_calls?: readonly { outcome: CallOutcome; at: Date }[] | null;
}): TimelineEntry[] => {
  const firstTo = (stage: Stage): Date | null =>
    agent.stage_history.find((e) => e.to === stage)?.at ?? null;
  const applied = firstTo('kyc_review');
  const call =
    (agent.verification_calls ?? []).find((c) => c.outcome === 'verified')
      ?.at ?? null;
  const approved = firstTo('approved');
  const reached: Record<TimelineStep, Date | null> = {
    applied,
    verification_call: call,
    documents_review: applied && call ? later(applied, call) : null,
    approved,
    active:
      approved && agent.stage === 'approved' && agent.is_active
        ? approved
        : null,
  };

  let laterDone = false;
  return [...TIMELINE_STEPS]
    .reverse()
    .map((step) => {
      laterDone ||= reached[step] !== null;
      return { step, at: reached[step], done: laterDone };
    })
    .reverse();
};
