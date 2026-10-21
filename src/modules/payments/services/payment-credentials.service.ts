import { randomUUID } from 'node:crypto';

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  apiError,
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
} from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import type { PageQueryDto } from '@common/dto/page-query.dto';
import type { Env } from '@config/env.schema';

import type { SubmitCredentialsDto } from '../dto/payment-credential.dto';
import {
  CREDENTIAL_FIELDS,
  CREDENTIAL_MODES,
  PENDING_TTL_MS,
  approvalRefusal,
  mask,
  defaultMode,
  splitFields,
  type CredentialMode,
  type CredentialStatus,
} from '../payment-credentials.domain';
import { PAYMENT_PROVIDERS, type PaymentProvider } from '../payments.domain';
import {
  CredentialCipher,
  sealContext,
  type SealedValue,
} from '../providers/credential-cipher';
import { GatewayVerifier } from '../providers/gateway-verifier';
import { PaymentAlerts } from '../providers/payment-alerts';
import { PaymentCredentialRepository } from '../repositories/payment-credential.repository';
import { PaymentOptionRepository } from '../repositories/payment-option.repository';
import type { PaymentOptionAudit } from '../schemas/payment-option-audit.schema';
import type {
  CredentialTest,
  PaymentCredential,
} from '../schemas/payment-credential.schema';

/** A set of keys as HO sees it: ids in full, secrets as `••••abcd`. */
export interface CredentialView {
  id: string;
  provider: PaymentProvider;
  mode: CredentialMode;
  status: CredentialStatus;
  public_fields: Record<string, string>;
  masked: Record<string, string>;
  note: string | null;
  submitted_by: string;
  submitted_at: Date;
  expires_at: Date;
  test: CredentialTest | null;
  decided_by: string | null;
  decided_at: Date | null;
  reason: string | null;
  activated_at: Date | null;
  retired_at: Date | null;
  retired_by: string | null;
}

export interface ProviderCredentialsView {
  provider: PaymentProvider;
  /** The form to draw: what to ask for, which ones are secret. */
  fields: {
    key: string;
    label: string;
    secret: boolean;
    hint: string;
    optional: boolean;
  }[];
  active: CredentialView | null;
  pending: CredentialView | null;
}

export interface CredentialsOverview {
  /** Off: the server has no encryption key, nothing can be submitted. */
  storage_ready: boolean;
  /** The mode the form starts on (live in production, else test); both are accepted. */
  required_mode: CredentialMode;
  modes: readonly CredentialMode[];
  providers: ProviderCredentialsView[];
}

/** Decrypted keys, for taking a payment. Never leaves the server. */
export interface UsableCredentials {
  id: string;
  mode: CredentialMode;
  fields: Record<string, string>;
}

const ACTIVE_TTL_MS = 60_000;

@Injectable()
export class PaymentCredentialsService {
  private readonly logger = new Logger(PaymentCredentialsService.name);
  private readonly production: boolean;
  /** Which providers have live keys, for the app's list — at most a minute old. */
  private active: {
    at: number;
    modes: Map<PaymentProvider, CredentialMode>;
    /** The live keys' non-secret ids (Razorpay Key ID …), never a secret. */
    publicIds: Map<PaymentProvider, Record<string, string>>;
  } | null = null;

  constructor(
    private readonly credentials: PaymentCredentialRepository,
    private readonly options: PaymentOptionRepository,
    private readonly cipher: CredentialCipher,
    private readonly verifier: GatewayVerifier,
    private readonly alerts: PaymentAlerts,
    config: ConfigService<Env, true>,
  ) {
    this.production = config.get('NODE_ENV', { infer: true }) === 'production';
  }

  async overview(): Promise<CredentialsOverview> {
    const rows = await this.liveRows();
    return {
      storage_ready: this.cipher.configured,
      required_mode: defaultMode(this.production),
      modes: CREDENTIAL_MODES,
      providers: PAYMENT_PROVIDERS.map((provider) => {
        const mine = rows.filter((r) => r.provider === provider);
        const active = mine.find((r) => r.status === 'active');
        const pending = mine.find(
          (r) => r.status === 'pending' || r.status === 'approved',
        );
        return {
          provider,
          fields: CREDENTIAL_FIELDS[provider].map(
            ({ key, label, secret, hint, optional }) => ({
              key,
              label,
              secret,
              hint,
              optional: optional === true,
            }),
          ),
          active: active ? toView(active) : null,
          pending: pending ? toView(pending) : null,
        };
      }),
    };
  }

  async history(
    provider: PaymentProvider,
    query: PageQueryDto,
  ): Promise<PageResult<CredentialView>> {
    const { rows, total } = await this.credentials.history(
      provider,
      query.skip,
      query.limit,
    );
    return new PageResult(rows.map(toView), total, query);
  }

  async submit(
    provider: PaymentProvider,
    dto: SubmitCredentialsDto,
    by: string,
  ): Promise<CredentialView> {
    this.requireStorage();
    const split = splitFields(provider, dto.fields);
    if ('errors' in split) {
      throw badRequest('VALIDATION_FAILED', split.errors[0], split.errors);
    }

    const id = randomUUID();
    const now = new Date();
    const secrets: Record<string, SealedValue> = {};
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(split.ok.secrets)) {
      secrets[key] = this.cipher.seal(value, sealContext(id, provider, key));
      masked[key] = mask(value);
    }

    const row = {
      _id: id,
      provider,
      mode: dto.mode,
      status: 'pending' as const,
      public_fields: split.ok.public_fields,
      secrets,
      masked,
      note: dto.note?.trim() || null,
      submitted_by: by,
      expires_at: new Date(now.getTime() + PENDING_TTL_MS),
      test: null,
      decided_by: null,
      decided_at: null,
      reason: null,
      activated_at: null,
      retired_at: null,
      retired_by: null,
    };
    // While another set is half-way to live, a new one could be retired by it.
    let saved = (await this.credentials.approving(provider))
      ? null
      : await this.credentials.insertPending(row);
    if (!saved && !(await this.credentials.approving(provider))) {
      // A waiting set past its day is dropped and this one takes its place.
      await this.expireStale(provider, now);
      saved = await this.credentials.insertPending(row);
    }
    if (!saved) {
      throw conflict(
        'CREDENTIALS_PENDING',
        'New keys for this payment option are already waiting for approval. Approve or reject them first.',
      );
    }

    await this.audit(
      provider,
      'credentials_submitted',
      null,
      summary(saved),
      by,
    );
    await this.alerts.send(
      `${by} submitted new ${dto.mode} keys for ${provider} (${describe(saved)}). Waiting for a second admin to approve.`,
    );
    return toView(saved);
  }

  /** Calls the gateway with the waiting keys; approval needs a pass. */
  async test(id: string, by: string): Promise<CredentialView> {
    const row = await this.requirePending(id);
    const fields = this.open(row);
    const result = await this.verifier.verify(row.provider, row.mode, fields);
    const test: CredentialTest = { ...result, by, at: new Date() };
    const saved = await this.credentials.setTest(id, test);
    if (!saved) throw this.notPending();
    await this.audit(
      row.provider,
      'credentials_tested',
      null,
      { id, ok: result.ok, message: result.message },
      by,
    );
    return toView(saved);
  }

  async approve(id: string, by: string): Promise<CredentialView> {
    const row = await this.require(id);
    // A crash between the steps below leaves the set approved: any admin but
    // the submitter finishes it (or rejects it), so it is never stuck.
    const resuming = row.status === 'approved' && row.submitted_by !== by;
    if (!resuming) {
      this.refuseApproval(row, by);
      if (!(await this.credentials.claimApproval(id, by, new Date()))) {
        throw this.notPending();
      }
    }

    await this.credentials.retireActive(
      row.provider,
      id,
      'superseded',
      by,
      `Replaced by ${id}`,
    );
    const live = await this.credentials.promote(id, new Date());
    if (!live) throw this.notPending();
    this.active = null;

    await this.audit(
      row.provider,
      'credentials_approved',
      null,
      summary(live),
      by,
    );
    await this.alerts.send(
      `${by} approved ${live.mode} keys for ${live.provider} (${describe(live)}), submitted by ${live.submitted_by}. They are live now; the previous keys were wiped.`,
    );
    return toView(live);
  }

  /** The submitter may withdraw their own set the same way. */
  async reject(
    id: string,
    by: string,
    reason: string,
  ): Promise<CredentialView> {
    const row = await this.require(id);
    const saved = await this.credentials.reject(id, by, reason.trim());
    if (!saved) throw this.notPending();
    await this.audit(
      row.provider,
      'credentials_rejected',
      null,
      { id, reason },
      by,
    );
    await this.alerts.send(
      `${by} rejected the ${row.mode} keys for ${row.provider} submitted by ${row.submitted_by}: ${reason}`,
    );
    return toView(saved);
  }

  /** The emergency stop for leaked keys: online payment by this provider ends at once. */
  async revoke(
    provider: PaymentProvider,
    by: string,
    reason: string,
  ): Promise<{ revoked: true }> {
    const done = await this.credentials.retireActive(
      provider,
      null,
      'revoked',
      by,
      reason.trim(),
    );
    if (!done) throw notFound('This payment option has no live keys.');
    this.active = null;
    await this.audit(provider, 'credentials_revoked', null, { reason }, by);
    await this.alerts.send(
      `${by} REVOKED the live keys for ${provider}: ${reason}. Online payment by ${provider} is off until new keys are approved.`,
    );
    return { revoked: true };
  }

  /** Providers with live keys and their mode; at most a minute old. */
  async activeModes(
    fresh = false,
  ): Promise<Map<PaymentProvider, CredentialMode>> {
    return (await this.activeSet(fresh)).modes;
  }

  /**
   * The live keys' public ids per provider (Razorpay `key_id`, …) — the ones HO
   * sees in full; secrets are never in here. At most a minute old.
   */
  async activePublicIds(
    fresh = false,
  ): Promise<Map<PaymentProvider, Record<string, string>>> {
    return (await this.activeSet(fresh)).publicIds;
  }

  private async activeSet(fresh: boolean): Promise<{
    modes: Map<PaymentProvider, CredentialMode>;
    publicIds: Map<PaymentProvider, Record<string, string>>;
  }> {
    if (!fresh && this.active && Date.now() - this.active.at < ACTIVE_TTL_MS) {
      return this.active;
    }
    const live = (await this.credentials.current()).filter(
      (r) => r.status === 'active',
    );
    this.active = {
      at: Date.now(),
      modes: new Map(live.map((r) => [r.provider, r.mode])),
      publicIds: new Map(live.map((r) => [r.provider, { ...r.public_fields }])),
    };
    return this.active;
  }

  /**
   * The live keys, decrypted, read fresh — for taking a payment only. Never
   * returned by any route, never logged.
   */
  async usable(provider: PaymentProvider): Promise<UsableCredentials | null> {
    const row = await this.credentials.activeSealed(provider);
    if (!row) return null;
    return { id: row._id, mode: row.mode, fields: this.open(row) };
  }

  private async liveRows(): Promise<PaymentCredential[]> {
    const rows = await this.credentials.current();
    const now = new Date();
    const stale = rows.filter(
      (r) => r.status === 'pending' && r.expires_at.getTime() <= now.getTime(),
    );
    await Promise.all(stale.map((r) => this.credentials.expire(r._id, now)));
    const staleIds = new Set(stale.map((r) => r._id));
    return rows.filter((r) => !staleIds.has(r._id));
  }

  private async expireStale(
    provider: PaymentProvider,
    now: Date,
  ): Promise<void> {
    const rows = await this.credentials.current();
    const stale = rows.find(
      (r) =>
        r.provider === provider &&
        r.status === 'pending' &&
        r.expires_at.getTime() <= now.getTime(),
    );
    if (stale) await this.credentials.expire(stale._id, now);
  }

  /** Public ids plus the opened secrets. */
  private open(row: PaymentCredential): Record<string, string> {
    // null = wiped (replaced, revoked, rejected). Missing = a Key-ID-only set:
    // Mongo does not store the empty object, so it has no secrets to open.
    if (row.secrets === null) throw this.notPending();
    const fields = { ...row.public_fields };
    try {
      for (const [key, sealed] of Object.entries(row.secrets ?? {})) {
        fields[key] = this.cipher.open(
          sealed,
          sealContext(row._id, row.provider, key),
        );
      }
    } catch (error) {
      // A wrong key or a tampered row; the reason is logged, the value is not.
      this.logger.error(
        `payment credentials ${row._id} (${row.provider}) could not be opened: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      throw serviceUnavailable(
        'CREDENTIALS_UNREADABLE',
        'These keys cannot be read on this server. Please submit them again.',
      );
    }
    return fields;
  }

  private async require(id: string): Promise<PaymentCredential> {
    const row = await this.credentials.find(id);
    if (!row) throw notFound('These keys could not be found.');
    return row;
  }

  private async requirePending(id: string): Promise<PaymentCredential> {
    const row = await this.credentials.findSealed(id);
    if (!row) throw notFound('These keys could not be found.');
    if (row.status !== 'pending') throw this.notPending();
    if (row.expires_at.getTime() <= Date.now()) {
      await this.credentials.expire(id, new Date());
      throw this.expired();
    }
    return row;
  }

  private refuseApproval(row: PaymentCredential, by: string): void {
    const refusal = approvalRefusal(
      {
        status: row.status,
        submitted_by: row.submitted_by,
        expires_at: row.expires_at,
        test_ok: row.test?.ok ?? null,
      },
      by,
      new Date(),
    );
    switch (refusal) {
      case null:
        return;
      case 'not_pending':
        throw this.notPending();
      case 'expired':
        throw this.expired();
      case 'same_person':
        throw apiError(
          HttpStatus.FORBIDDEN,
          'APPROVER_IS_SUBMITTER',
          'Keys must be approved by a different admin than the one who submitted them.',
        );
      case 'not_tested':
        throw conflict(
          'CREDENTIALS_NOT_TESTED',
          'Run the gateway check and get a pass before approving these keys.',
        );
    }
  }

  private requireStorage(): void {
    if (!this.cipher.configured) {
      throw serviceUnavailable(
        'CREDENTIALS_NOT_CONFIGURED',
        'Payment credentials cannot be stored on this server yet. Please ask the tech team to set the encryption key.',
      );
    }
  }

  private notPending() {
    return conflict(
      'CREDENTIALS_NOT_PENDING',
      'These keys are no longer waiting for approval. Reload to see their status.',
    );
  }

  private expired() {
    return conflict(
      'CREDENTIALS_EXPIRED',
      'These keys were not approved within 24 hours. Please submit them again.',
    );
  }

  private async audit(
    provider: PaymentProvider,
    action: PaymentOptionAudit['action'],
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    by: string,
  ): Promise<void> {
    try {
      await this.options.log({
        _id: randomUUID(),
        option_id: provider,
        action,
        before,
        after,
        by,
        at: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { err: error, provider, action, by },
        'payment credentials changed but the audit row was not written',
      );
    }
  }
}

// Mongo drops an empty object on save, so a Key-ID-only set (no secrets)
// comes back with `masked` missing; every reader treats that as {}.
function toView(r: PaymentCredential): CredentialView {
  return {
    id: r._id,
    provider: r.provider,
    mode: r.mode,
    status: r.status,
    public_fields: r.public_fields,
    masked: r.masked ?? {},
    note: r.note,
    submitted_by: r.submitted_by,
    submitted_at: r.created_at,
    expires_at: r.expires_at,
    test: r.test,
    decided_by: r.decided_by,
    decided_at: r.decided_at,
    reason: r.reason,
    activated_at: r.activated_at,
    retired_at: r.retired_at,
    retired_by: r.retired_by,
  };
}

/** What the audit log keeps of a set: ids and masks, never a secret. */
function summary(r: PaymentCredential): Record<string, unknown> {
  return {
    id: r._id,
    mode: r.mode,
    public_fields: r.public_fields,
    masked: r.masked ?? {},
  };
}

function describe(r: PaymentCredential): string {
  return [
    ...Object.entries(r.public_fields ?? {}),
    ...Object.entries(r.masked ?? {}),
  ]
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
}
