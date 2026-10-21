import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { badRequest, conflict } from '@common/errors/api-error';
import { PageResult } from '@common/http/page-result';
import type { Env } from '@config/env.schema';
import { AgentsService } from '@modules/agents/services/agents.service';
import { CohortsService } from '@modules/onboarding/services/cohorts.service';

import type {
  PaymentAuditQueryDto,
  ReorderPaymentOptionsDto,
  UpdatePaymentOptionDto,
} from '../dto/payment-option.dto';
import {
  PAYMENT_PROVIDERS,
  PROVIDER_DEFAULTS,
  isShownTo,
  orderError,
  textError,
  type PaymentProvider,
} from '../payments.domain';
import {
  PaymentOptionRepository,
  type PaymentOptionPatch,
} from '../repositories/payment-option.repository';
import type { PaymentOptionAudit } from '../schemas/payment-option-audit.schema';
import type { PaymentOption } from '../schemas/payment-option.schema';
import type { CredentialMode } from '../payment-credentials.domain';
import { PaymentCredentialsService } from './payment-credentials.service';

/** What the app's `PaymentGateway` reads. */
export interface PartnerPaymentOptionView {
  id: PaymentProvider;
  provider: PaymentProvider;
  label: string;
  hint: string | null;
  /**
   * Razorpay only: the live Key ID HO approved (public — it opens the
   * checkout sheet). KO Utils creates the Razorpay order with its own secret.
   */
  key_id?: string;
}

export interface AdminPaymentOptionView {
  id: PaymentProvider;
  provider: PaymentProvider;
  label: string;
  hint: string | null;
  is_active: boolean;
  order: number;
  cohorts: string[];
  /** 0 = never saved; send it back on the next PATCH. */
  version: number;
  updated_by: string | null;
  updated_at: Date | null;
  /** Live keys are approved; without them it cannot be switched on or shown. */
  configured: boolean;
  mode: CredentialMode | null;
}

export interface AdminPaymentOptionsView {
  /** The server's kill switch; off, the app shows no online option whatever HO sets. */
  online_enabled: boolean;
  items: AdminPaymentOptionView[];
}

const ROWS_TTL_MS = 60_000;

@Injectable()
export class PaymentOptionsService {
  private readonly logger = new Logger(PaymentOptionsService.name);
  private readonly onlineEnabled: boolean;
  /**
   * Read on every Checkout; changed a few times a year. Each process re-reads
   * at most once a minute, so a switch-off reaches the app within that
   * minute. Taking a payment must re-check the stored row, not this copy.
   */
  private rows: { at: number; rows: PaymentOption[] } | null = null;

  constructor(
    private readonly options: PaymentOptionRepository,
    private readonly agents: AgentsService,
    private readonly cohorts: CohortsService,
    private readonly credentials: PaymentCredentialsService,
    config: ConfigService<Env, true>,
  ) {
    this.onlineEnabled = config.get('PAYMENTS_ONLINE_ENABLED', {
      infer: true,
    });
  }

  async forPartner(agentRef: string): Promise<PartnerPaymentOptionView[]> {
    if (!this.onlineEnabled) return [];
    const [cohort, rows, modes, publicIds] = await Promise.all([
      this.agents.cohortById(agentRef),
      this.cachedRows(),
      this.credentials.activeModes(),
      this.credentials.activePublicIds(),
    ]);
    return withDefaults(rows, modes)
      .filter((o) => o.configured && isShownTo(o, cohort))
      .map((o) => {
        const keyId =
          o.provider === 'razorpay'
            ? publicIds.get('razorpay')?.key_id
            : undefined;
        return {
          id: o.id,
          provider: o.provider,
          label: o.label,
          hint: o.hint,
          ...(keyId ? { key_id: keyId } : {}),
        };
      });
  }

  async list(): Promise<AdminPaymentOptionsView> {
    const [rows, modes] = await Promise.all([
      this.options.listAll(),
      this.credentials.activeModes(),
    ]);
    return {
      online_enabled: this.onlineEnabled,
      items: withDefaults(rows, modes),
    };
  }

  async update(
    id: PaymentProvider,
    dto: UpdatePaymentOptionDto,
    by: string,
  ): Promise<AdminPaymentOptionView> {
    const set: PaymentOptionPatch = {};
    if (dto.label !== undefined) set.label = checkText('label', dto.label);
    if (dto.hint !== undefined) {
      set.hint = dto.hint === null ? null : checkText('hint', dto.hint);
    }
    if (dto.is_active !== undefined) set.is_active = dto.is_active;
    // Fresh, not the minute-old copy: keys revoked a moment ago must block this.
    const modes = await this.credentials.activeModes(true);
    if (set.is_active === true && !modes.has(id)) {
      throw badRequest(
        'CREDENTIALS_MISSING',
        'This payment option has no approved keys yet. An admin must add and approve them first.',
      );
    }
    if (dto.cohorts !== undefined) {
      set.cohorts = await this.checkCohorts(dto.cohorts);
    }
    if (Object.keys(set).length === 0) {
      throw badRequest('VALIDATION_FAILED', 'Nothing to change was sent.');
    }

    const before = await this.options.find(id);
    const saved = await this.options.save(id, dto.version, set, by);
    if (!saved) {
      throw conflict(
        'VERSION_CONFLICT',
        'This payment option was changed on another screen. Reload and try again.',
      );
    }
    this.rows = null;
    await this.audit(id, 'update', before ? pick(before, set) : null, set, by);
    return toAdminView(saved, modes);
  }

  /** The whole list, so an option is never left sharing a position. */
  async reorder(
    dto: ReorderPaymentOptionsDto,
    by: string,
  ): Promise<{ ids: PaymentProvider[] }> {
    const error = orderError(dto.ids);
    if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
    const before = withDefaults(await this.options.listAll(), new Map()).map(
      (o) => o.id,
    );
    await this.options.reorder(dto.ids, by);
    this.rows = null;
    await this.audit('*', 'reorder', { ids: before }, { ids: dto.ids }, by);
    return { ids: dto.ids };
  }

  async auditLog(
    query: PaymentAuditQueryDto,
  ): Promise<PageResult<PaymentOptionAudit>> {
    const { rows, total } = await this.options.auditPage(
      query.option_id,
      query.skip,
      query.limit,
    );
    return new PageResult(rows, total, query);
  }

  private async cachedRows(): Promise<PaymentOption[]> {
    if (this.rows && Date.now() - this.rows.at < ROWS_TTL_MS) {
      return this.rows.rows;
    }
    const rows = await this.options.listAll();
    this.rows = { at: Date.now(), rows };
    return rows;
  }

  /** Inactive cohorts are allowed: HO may prepare an option before a launch. */
  private async checkCohorts(keys: string[]): Promise<string[]> {
    const unique = [...new Set(keys)];
    await Promise.all(unique.map((key) => this.cohorts.require(key, false)));
    return unique;
  }

  /**
   * The change is already saved; a lost log line must not undo it or fail the
   * request, but it must be loud.
   */
  private async audit(
    optionId: string,
    action: PaymentOptionAudit['action'],
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    by: string,
  ): Promise<void> {
    try {
      await this.options.log({
        _id: randomUUID(),
        option_id: optionId,
        action,
        before,
        after,
        by,
        at: new Date(),
      });
    } catch (error) {
      this.logger.error(
        { err: error, option_id: optionId, action, after, by },
        'payment option changed but the audit row was not written',
      );
    }
  }
}

type Modes = ReadonlyMap<PaymentProvider, CredentialMode>;

/** Every provider in display order, a never-saved one as its off default. */
function withDefaults(
  rows: PaymentOption[],
  modes: Modes,
): AdminPaymentOptionView[] {
  const byId = new Map(rows.map((r) => [r._id, r]));
  return PAYMENT_PROVIDERS.map((id) => {
    const row = byId.get(id);
    if (row) return toAdminView(row, modes);
    const d = PROVIDER_DEFAULTS[id];
    return {
      id,
      provider: id,
      label: d.label,
      hint: d.hint,
      is_active: false,
      order: d.order,
      cohorts: [],
      version: 0,
      updated_by: null,
      updated_at: null,
      configured: modes.has(id),
      mode: modes.get(id) ?? null,
    };
  }).sort((a, b) => a.order - b.order);
}

function toAdminView(row: PaymentOption, modes: Modes): AdminPaymentOptionView {
  return {
    id: row._id,
    provider: row._id,
    label: row.label,
    hint: row.hint,
    is_active: row.is_active,
    order: row.order,
    cohorts: row.cohorts,
    version: row.version,
    updated_by: row.updated_by ?? null,
    updated_at: row.updated_at ?? null,
    configured: modes.has(row._id),
    mode: modes.get(row._id) ?? null,
  };
}

function checkText(field: 'label' | 'hint', value: string): string {
  const text = value.trim();
  const error = textError(field, text);
  if (error) throw badRequest('VALIDATION_FAILED', error, [error]);
  return text;
}

/** The stored values of just the fields this change touches. */
function pick(
  row: PaymentOption,
  set: PaymentOptionPatch,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(set).map((k) => [k, row[k as keyof PaymentOptionPatch]]),
  );
}
