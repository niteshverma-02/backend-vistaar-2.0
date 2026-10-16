import { Injectable } from '@nestjs/common';

import { badRequest, conflict, forbidden } from '@common/errors/api-error';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import {
  bankFields,
  bankValues,
  last4,
  type BankChange,
  type BankChangeStatus,
  type BankRequest,
} from '../bank-change.domain';
import { checkValue, type FieldDef } from '../form.domain';
import { OnboardingRepository } from '../repositories/onboarding.repository';
import type {
  AdminEdit,
  OnboardingData,
} from '../schemas/onboarding-data.schema';
import { ConfigsService } from './configs.service';
import { OnboardingService, type PayoutFacts } from './onboarding.service';

export interface BankChangeView {
  status: BankChangeStatus;
  account_holder: string;
  account_last4: string;
  ifsc: string;
  requested_at: Date;
  decided_at: Date | null;
  /** HO's reason when rejected. */
  reason: string | null;
}

export interface AdminBankChangeView extends Omit<
  BankChangeView,
  'account_last4'
> {
  agent_id: string;
  account_number: string;
  proof_path: string;
  proof_url: string | null;
  decided_by: string | null;
  /** The account payouts go to now, to compare against. */
  current_account: PayoutFacts['bank_account'];
}

/**
 * "Change bank account" (PRD N4): an approved partner asks for a new payout
 * account; HO checks the proof and approves it into the form, as a verified
 * bank proof — so payouts, and the org copy on `piis`, follow the new one.
 */
@Injectable()
export class BankChangeService {
  constructor(
    private readonly repo: OnboardingRepository,
    private readonly forms: OnboardingService,
    private readonly configs: ConfigsService,
    private readonly agents: AgentsService,
    private readonly storage: StorageService,
  ) {}

  // ── Partner ───────────────────────────────────────────────────────────

  async mine(agentRef: string): Promise<BankChangeView | null> {
    const doc = await this.repo.findByAgent(agentRef);
    return doc?.bank_change ? partnerView(doc.bank_change) : null;
  }

  async request(agentRef: string, input: BankRequest): Promise<BankChangeView> {
    const agent = await this.agents.require(agentRef);
    if (agent.stage === 'blocked' || !agent.is_active)
      throw forbidden(
        'ACCOUNT_BLOCKED',
        'Your account is blocked. Please contact Katyayani support.',
      );
    if (agent.stage !== 'approved')
      throw forbidden(
        'PARTNER_NOT_APPROVED',
        'You can change your bank account once your account is approved.',
      );
    const doc = await this.requireDoc(agent);
    if (doc.bank_change?.status === 'pending') throw changePending();

    const { account, proof } = await this.fieldsOf(doc);
    const wanted = bankValues(doc.raw_data[account.key], {
      ...input,
      ifsc: input.ifsc.trim().toUpperCase(),
    });
    // The partner's own form rules: account pattern, upload in their own folder.
    const ctx = { piiId: agent.pii_id as string };
    const next = passes(account, wanted.account, ctx) as Record<string, string>;
    passes(proof, wanted.proof, ctx);
    const now = doc.raw_data[account.key] as Record<string, unknown> | null;
    if (now?.account_number === next.account_number && now?.ifsc === next.ifsc)
      throw badRequest(
        'VALIDATION_FAILED',
        'This is already your payout bank account.',
      );

    const saved = await this.repo.startBankChange(agent._id, {
      status: 'pending',
      account_holder: next.account_holder,
      account_number: next.account_number,
      ifsc: next.ifsc,
      proof_path: input.proof_path,
      requested_at: new Date(),
      decided_at: null,
      decided_by: null,
      reason: null,
    });
    if (!saved?.bank_change) throw changePending();
    return partnerView(saved.bank_change);
  }

  /** The partner takes back a request HO has not decided yet. */
  async withdraw(agentRef: string): Promise<BankChangeView> {
    const doc = await this.requireDoc(await this.agents.require(agentRef));
    const saved = await this.close(doc, 'self', {
      'bank_change.status': 'withdrawn',
    });
    return partnerView(saved.bank_change as BankChange);
  }

  // ── HO ────────────────────────────────────────────────────────────────

  async forDesk(agentId: string): Promise<AdminBankChangeView | null> {
    const agent = await this.agents.requireByAgentId(agentId);
    const doc = await this.repo.findByAgent(agent._id);
    return doc?.bank_change ? this.adminView(doc) : null;
  }

  /**
   * The new account and proof go into the form, the proof verified by HO the
   * way the KYC review desk verifies it (same entry, same `piis` copy).
   */
  async approve(agentId: string, by: string): Promise<AdminBankChangeView> {
    const agent = await this.agents.requireByAgentId(agentId);
    const doc = await this.requireDoc(agent);
    const change = pendingOf(doc);
    const { account, proof } = await this.fieldsOf(doc);
    const values = bankValues(doc.raw_data[account.key], change);
    const at = new Date();
    const audit: AdminEdit[] = [
      { field: account.key, new_value: values.account },
      { field: proof.key, new_value: values.proof },
    ].map((edit) => ({
      ...edit,
      old_value: doc.raw_data[edit.field] ?? null,
      by,
      at,
    }));
    const saved = await this.close(
      doc,
      by,
      {
        'bank_change.status': 'approved',
        [`raw_data.${account.key}`]: values.account,
        [`raw_data.${proof.key}`]: values.proof,
        [`documents_review.${proof.key}`]: this.forms.reviewEntry(
          'verified',
          null,
          by,
          values.proof,
          at,
        ),
      },
      audit,
      at,
    );
    await this.forms.mirrorReviewed(
      agent.pii_id as string,
      proof,
      'verified',
      values.proof,
    );
    // Approval copied the form's account onto the profile; keep that copy current.
    await this.agents.setProfileBankAccount(agent, {
      account_holder: change.account_holder,
      account_number: change.account_number,
      ifsc: change.ifsc,
    });
    return this.adminView(saved);
  }

  async reject(
    agentId: string,
    reason: string,
    by: string,
  ): Promise<AdminBankChangeView> {
    if (!reason.trim())
      throw badRequest(
        'VALIDATION_FAILED',
        'Please write why the new account is rejected, so the partner knows what to fix.',
      );
    const agent = await this.agents.requireByAgentId(agentId);
    const doc = await this.requireDoc(agent);
    const saved = await this.close(doc, by, {
      'bank_change.status': 'rejected',
      'bank_change.reason': reason.trim(),
    });
    return this.adminView(saved);
  }

  // ── internals ─────────────────────────────────────────────────────────

  private async requireDoc(agent: AgentRecord): Promise<OnboardingData> {
    const doc = await this.repo.findByAgent(agent._id);
    if (!doc) throw notPending();
    return doc;
  }

  private async fieldsOf(
    doc: OnboardingData,
  ): Promise<{ account: FieldDef; proof: FieldDef }> {
    const { steps } = await this.configs.version(
      doc.cohort,
      doc.config_version,
    );
    const { account, proof } = bankFields(steps);
    if (!account || !proof)
      throw conflict(
        'CONFIG_INVALID',
        'Your form has no payout bank account to change. Please contact Katyayani support.',
      );
    return { account, proof };
  }

  /** Decides the pending change — refused if it was decided or replaced meanwhile. */
  private async close(
    doc: OnboardingData,
    by: string,
    set: Record<string, unknown>,
    audit: AdminEdit[] = [],
    at = new Date(),
  ): Promise<OnboardingData> {
    const change = pendingOf(doc);
    const saved = await this.repo.closeBankChange(
      doc.agent_ref,
      change.requested_at,
      doc.version,
      {
        ...set,
        'bank_change.decided_at': at,
        'bank_change.decided_by': by,
        updated_by: by,
      },
      audit,
    );
    if (!saved?.bank_change) throw notPending();
    return saved;
  }

  private async adminView(doc: OnboardingData): Promise<AdminBankChangeView> {
    const change = doc.bank_change as BankChange;
    const [urls, facts] = await Promise.all([
      this.storage.sign([change.proof_path]),
      this.forms.payoutFacts([doc.agent_ref]),
    ]);
    return {
      agent_id: doc.agent_id,
      status: change.status,
      account_holder: change.account_holder,
      account_number: change.account_number,
      ifsc: change.ifsc,
      proof_path: change.proof_path,
      proof_url: urls.get(change.proof_path) ?? null,
      requested_at: change.requested_at,
      decided_at: change.decided_at,
      decided_by: change.decided_by,
      reason: change.reason,
      current_account: facts.get(doc.agent_ref)?.bank_account ?? null,
    };
  }
}

function partnerView(change: BankChange): BankChangeView {
  return {
    status: change.status,
    account_holder: change.account_holder,
    account_last4: last4(change.account_number),
    ifsc: change.ifsc,
    requested_at: change.requested_at,
    decided_at: change.decided_at,
    reason: change.reason,
  };
}

/** The cleaned value, or a 400 with the form's own sentence. */
function passes(
  field: FieldDef,
  value: unknown,
  ctx: { piiId: string },
): unknown {
  const checked = checkValue(field, value, ctx);
  if (!checked.ok)
    throw badRequest('VALIDATION_FAILED', checked.error, [checked.error]);
  return checked.value;
}

function pendingOf(doc: OnboardingData): BankChange {
  if (doc.bank_change?.status !== 'pending') throw notPending();
  return doc.bank_change;
}

function changePending() {
  return conflict(
    'BANK_CHANGE_PENDING',
    'Your new bank account is waiting for Katyayani to check it. You can withdraw that request first.',
  );
}

function notPending() {
  return conflict(
    'BANK_CHANGE_NOT_PENDING',
    'There is no bank account change waiting. Please reload.',
  );
}
