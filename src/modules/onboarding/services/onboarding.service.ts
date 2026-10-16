import { HttpStatus, Injectable } from '@nestjs/common';
import type { UpdateQuery } from 'mongoose';

import { apiError, badRequest, conflict } from '@common/errors/api-error';
import type { GeoPoint } from '@common/utils/geo.util';
import { PARTNER_EDITABLE, stageRefusal } from '@modules/agents/agents.domain';
import {
  AgentsService,
  type AgentRecord,
} from '@modules/agents/services/agents.service';
import { PiiService } from '@modules/spine/services/pii.service';
import { PincodeService } from '@modules/spine/services/pincode.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import { BANK_ACCOUNT_FIELD, BANK_DOCUMENT } from '../bank-change.domain';
import {
  checkValue,
  documentKeys,
  fieldIndex,
  filePaths,
  locationOf,
  mapProfile,
  withPlace,
  missingRequired,
  previewOf,
  progress,
  requiredDocuments,
  withUrls,
  type FieldDef,
  type RawData,
  type StepDef,
} from '../form.domain';
import {
  duplicatesOf,
  idFieldKeys,
  idInUseMessage,
  idKeysOf,
  PAN_DOCUMENT,
  type DuplicateIds,
  type IdKeys,
} from '../id-keys.domain';
import { OnboardingRepository } from '../repositories/onboarding.repository';
import type { OnboardingConfig } from '../schemas/onboarding-config.schema';
import type {
  AdminEdit,
  DocumentReview,
  OnboardingData,
  OnboardingDataDocument,
} from '../schemas/onboarding-data.schema';
import { CohortsService } from './cohorts.service';
import { ConfigsService } from './configs.service';

const MAX_KEYS_PER_SAVE = 100;
const MAX_RETRIES = 3;
/** Other partners shown to HO per duplicated Aadhaar / PAN. */
const MAX_ID_HOLDERS = 50;

/** Field keys as the form names them — `Aadhaar card, PAN card`. */
function labelsOf(steps: StepDef[], keys: string[]): string {
  const fields = fieldIndex(steps);
  return keys
    .map((key) => fields.get(key)?.label?.en?.trim() || key.replace(/_/g, ' '))
    .join(', ');
}

/** The KYC a payout rests on: PAN for the TDS rate, the bank account to pay into. */
export interface PayoutFacts {
  pan_number: string | null;
  pan_verified: boolean;
  bank_verified: boolean;
  /** A new account is waiting for HO: no new withdrawal until it is decided. */
  bank_change_pending: boolean;
  bank_account: {
    account_holder: string | null;
    account_number: string | null;
    ifsc: string | null;
  } | null;
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

export interface OnboardingView {
  onboarding_id: string;
  cohort: string;
  config_id: string;
  config_version: number;
  stage: string;
  /** null — every field may be written; a list — only these (changes requested). */
  editable_fields: string[] | null;
  raw_data: RawData;
  current_step: string | null;
  completed_steps: string[];
  completion_pct: number;
  missing_required: string[];
  documents_review: Record<string, Omit<DocumentReview, 'sig'>>;
  remarks: Record<string, string>;
  submitted_at: Date | null;
  submit_count: number;
  updated_at: Date;
}

export interface DeskOnboardingView extends OnboardingView {
  steps: StepDef[];
  updated_data: AdminEdit[];
  location: GeoPoint | null;
  /** Other partners whose form holds the same Aadhaar or PAN. */
  duplicate_ids: DuplicateIds[];
}

type Changes = { sets: RawData; unsets: string[] };

/**
 * `vistar_onboarding_data`: the partner fills it step by step (any number of
 * saves), submits it, HO reviews each KYC document and decides. The partner
 * record's stage moves through `AgentsService`; this service owns the data.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly onboarding: OnboardingRepository,
    private readonly configs: ConfigsService,
    private readonly cohorts: CohortsService,
    private readonly agents: AgentsService,
    private readonly storage: StorageService,
    private readonly piis: PiiService,
    private readonly pincodes: PincodeService,
  ) {}

  // ── Partner ───────────────────────────────────────────────────────────

  async mine(agentRef: string): Promise<OnboardingView | null> {
    const [agent, doc] = await Promise.all([
      this.agents.require(agentRef),
      this.onboarding.findByAgent(agentRef),
    ]);
    if (!doc) return null;
    return this.view(
      agent,
      doc,
      await this.configs.version(doc.cohort, doc.config_version),
    );
  }

  /**
   * One save of any number of fields. The first call needs `cohort` and
   * creates the record. Each key is written on its own (`raw_data.<key>`), so
   * two steps saved close together never overwrite each other.
   */
  async save(
    agentRef: string,
    input: { cohort?: string; step_id?: string; data: Record<string, unknown> },
  ): Promise<OnboardingView> {
    let agent = await this.agents.require(agentRef);
    this.assertPartnerCanEdit(agent);
    if (Object.keys(input.data).length > MAX_KEYS_PER_SAVE) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Too many answers were sent at once. Please save one step at a time.',
      );
    }

    let doc = await this.onboarding.findByAgent(agent._id);
    let config: OnboardingConfig;
    if (!doc) {
      if (!input.cohort)
        throw badRequest(
          'COHORT_REQUIRED',
          'Please choose how you want to work with Katyayani first.',
        );
      await this.cohorts.require(input.cohort);
      config = await this.configs.requirePublished(input.cohort);
      doc = await this.onboarding.create({
        agent_ref: agent._id,
        agent_id: agent.agent_id as string,
        pii_id: agent.pii_id as string,
        cohort: config.cohort,
        config_id: config._id,
        config_version: config.version,
      });
      await this.agents.linkOnboarding(agent._id, doc._id);
    } else {
      ({ doc, config } = await this.repinIfAllowed(agent, doc, input.cohort));
    }

    if (agent.stage === 'signed_up')
      agent = await this.agents.move(agent, 'start_onboarding', 'self');

    const editable = this.editableKeys(agent, doc);
    const changes = this.check(
      config.steps,
      input.data,
      agent.pii_id as string,
      editable,
    );
    await this.assertIdsFree(agent._id, config.steps, changes.sets);
    doc = await this.apply(doc, config, changes, {
      by: 'self',
      ...(input.step_id ? { current_step: input.step_id } : {}),
    });
    await this.refreshPreview(agent, doc, config);
    return this.view(agent, doc, config);
  }

  /** Complete and lock the form; every KYC document goes to HO for review. */
  async submit(agentRef: string): Promise<OnboardingView> {
    const agent = await this.agents.require(agentRef);
    if (agent.stage !== 'onboarding' && agent.stage !== 'changes_requested') {
      if (agent.stage === 'signed_up')
        throw badRequest(
          'COHORT_REQUIRED',
          'Please fill the form before submitting it.',
        );
      throw apiError(
        HttpStatus.CONFLICT,
        'ONBOARDING_LOCKED',
        'Your application is already submitted. Katyayani will review it soon.',
      );
    }
    const doc = await this.requireDoc(agent);
    const config = await this.configs.version(doc.cohort, doc.config_version);

    const missing = missingRequired(config.steps, doc.raw_data);
    if (missing.length) {
      throw badRequest(
        'REQUIRED_FIELDS_MISSING',
        `Please fill in: ${labelsOf(config.steps, missing)}.`,
        missing,
      );
    }

    await this.assertIdsFree(agent._id, config.steps, doc.raw_data);

    const updated = await this.withRetry(doc, (current) => ({
      $set: {
        documents_review: this.reviewForSubmit(config.steps, current),
        id_keys: idKeysOf(config.steps, current.raw_data),
        remarks: {},
        submitted_at: new Date(),
        updated_by: 'self',
      },
      $inc: { submit_count: 1 },
    }));

    const moved = await this.agents.move(agent, 'submit', 'self');
    await this.refreshPreview(moved, updated, config);
    return this.view(moved, updated, config);
  }

  // ── HO desk ───────────────────────────────────────────────────────────

  async forDesk(agent: AgentRecord): Promise<DeskOnboardingView | null> {
    const doc = await this.onboarding.findByAgent(agent._id);
    if (!doc) return null;
    const config = await this.configs.version(doc.cohort, doc.config_version);
    const mine = idKeysOf(config.steps, doc.raw_data);
    const [base, holders] = await Promise.all([
      this.view(agent, doc, config, null),
      this.onboarding.idHolders(mine, agent._id, MAX_ID_HOLDERS),
    ]);
    return {
      ...base,
      steps: config.steps,
      updated_data: doc.updated_data ?? [],
      location: doc.location ?? null,
      duplicate_ids: duplicatesOf(mine, agent._id, holders),
    };
  }

  /** HO corrects values on the partner's behalf; every change is audited. */
  async deskEdit(
    agent: AgentRecord,
    data: Record<string, unknown>,
    by: string,
  ): Promise<DeskOnboardingView> {
    if (
      !['onboarding', 'kyc_review', 'changes_requested'].includes(agent.stage)
    ) {
      throw apiError(
        HttpStatus.CONFLICT,
        'STAGE_NOT_ALLOWED',
        stageRefusal('edit', agent.stage),
      );
    }
    const doc = await this.requireDoc(agent);
    const config = await this.configs.version(doc.cohort, doc.config_version);
    const changes = this.check(
      config.steps,
      data,
      agent.pii_id as string,
      null,
    );
    await this.assertIdsFree(agent._id, config.steps, changes.sets);
    const at = new Date();
    const audit: AdminEdit[] = [
      ...Object.entries(changes.sets).map(([field, value]) => ({
        field,
        old_value: doc.raw_data[field] ?? null,
        new_value: value,
        by,
        at,
      })),
      ...changes.unsets.map((field) => ({
        field,
        old_value: doc.raw_data[field] ?? null,
        new_value: null,
        by,
        at,
      })),
    ];
    // A document HO changed is no longer the one that was reviewed.
    const reopen = [...Object.keys(changes.sets), ...changes.unsets].filter(
      (k) => doc.documents_review?.[k],
    );
    const updated = await this.apply(doc, config, changes, {
      by,
      audit,
      reopenReviews: reopen,
    });
    await this.refreshPreview(agent, updated, config);
    return (await this.forDesk(agent)) as DeskOnboardingView;
  }

  async reviewDocument(
    agent: AgentRecord,
    key: string,
    decision: 'verified' | 'rejected',
    reason: string | undefined,
    by: string,
  ): Promise<DeskOnboardingView> {
    if (agent.stage !== 'kyc_review') {
      throw apiError(
        HttpStatus.CONFLICT,
        'STAGE_NOT_ALLOWED',
        'Documents can be checked only while the application is in KYC review.',
      );
    }
    if (decision === 'rejected' && !reason?.trim()) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Please write why the document is rejected, so the partner knows what to fix.',
        [
          'Please write why the document is rejected, so the partner knows what to fix.',
        ],
      );
    }
    const doc = await this.requireDoc(agent);
    const config = await this.configs.version(doc.cohort, doc.config_version);
    const field = fieldIndex(config.steps).get(key);
    if (field?.type !== 'document')
      throw badRequest(
        'NOT_A_DOCUMENT',
        `${field?.label?.en ?? 'This field'} is not a KYC document on this form.`,
      );
    const value = doc.raw_data[key];
    if (value === undefined || value === null)
      throw badRequest(
        'DOCUMENT_MISSING',
        `The partner has not uploaded ${field.label?.en ?? 'this document'} yet.`,
      );

    const entry = this.reviewEntry(decision, reason, by, value, new Date());
    await this.withRetry(doc, () => ({
      $set: { [`documents_review.${key}`]: entry, updated_by: by },
    }));
    await this.mirrorReviewed(agent.pii_id as string, field, decision, value);
    return (await this.forDesk(agent)) as DeskOnboardingView;
  }

  /**
   * HO's verdict on one document as `documents_review` keeps it. The review
   * desk and the bank-change approval both write it from here.
   */
  reviewEntry(
    decision: 'verified' | 'rejected',
    reason: string | null | undefined,
    by: string,
    value: unknown,
    at: Date,
  ): DocumentReview {
    return {
      status: decision,
      reason: decision === 'rejected' ? (reason ?? '').trim() : null,
      by,
      at,
      sig: JSON.stringify(value),
    };
  }

  /**
   * After a verdict on a field with an `org_document`: the org copy on
   * `piis.documents`, in ko-sales' entry shape. Nothing for other fields.
   */
  mirrorReviewed(
    piiId: string,
    field: FieldDef,
    decision: 'verified' | 'rejected',
    value: unknown,
  ): Promise<void> {
    const type = field.org_document;
    if (!type) return Promise.resolve();
    if (decision === 'rejected') return this.piis.unverifyDocument(piiId, type);
    const { files = [], number } = value as {
      files?: string[];
      number?: string;
    };
    const [image, backImage] = files.map((path) => this.storage.urlOf(path));
    return this.piis.recordVerifiedDocument(piiId, type, {
      id: number ?? null,
      image: image ?? null,
      ...(backImage ? { back_image: backImage } : {}),
    });
  }

  /** Back to the partner with a note per field; rejected documents are included automatically. */
  async requestChanges(
    agent: AgentRecord,
    remarks: Record<string, string>,
    by: string,
  ): Promise<AgentRecord> {
    if (agent.stage !== 'kyc_review') {
      throw apiError(
        HttpStatus.CONFLICT,
        'STAGE_NOT_ALLOWED',
        'Changes can be asked for only while the application is in KYC review.',
      );
    }
    const doc = await this.requireDoc(agent);
    const config = await this.configs.version(doc.cohort, doc.config_version);
    const fields = fieldIndex(config.steps);
    const notes: Record<string, string> = {};
    for (const [key, note] of Object.entries(remarks)) {
      if (!fields.has(key))
        throw badRequest(
          'UNKNOWN_FIELD',
          'One of the fields is not on this form. Please reload the page and try again.',
        );
      if (typeof note !== 'string' || !note.trim())
        throw badRequest(
          'VALIDATION_FAILED',
          `Please write a note for ${fields.get(key)?.label?.en ?? 'each field'}.`,
        );
      notes[key] = note.trim().slice(0, 300);
    }
    for (const [key, review] of Object.entries(doc.documents_review ?? {})) {
      if (review.status === 'rejected' && !notes[key])
        notes[key] = review.reason ?? 'Please upload this document again.';
    }
    if (Object.keys(notes).length === 0) {
      throw badRequest(
        'VALIDATION_FAILED',
        'Please pick at least one field for the partner to change, or reject a document first.',
      );
    }
    await this.withRetry(doc, () => ({
      $set: { remarks: notes, updated_by: by },
    }));
    return this.agents.move(agent, 'request_changes', by, {
      reason: `${Object.keys(notes).length} field(s) to fix`,
    });
  }

  /** Every required KYC document verified → map the form onto the partner and approve. */
  async approve(agent: AgentRecord, by: string): Promise<AgentRecord> {
    if (agent.stage !== 'kyc_review') {
      throw apiError(
        HttpStatus.CONFLICT,
        'STAGE_NOT_ALLOWED',
        'Only an application in KYC review can be approved.',
      );
    }
    const doc = await this.requireDoc(agent);
    const config = await this.configs.version(doc.cohort, doc.config_version);
    const pending = requiredDocuments(config.steps, doc.raw_data).filter(
      (k) => doc.documents_review?.[k]?.status !== 'verified',
    );
    if (pending.length) {
      throw apiError(
        HttpStatus.CONFLICT,
        'DOCUMENTS_NOT_VERIFIED',
        `Please verify these documents first: ${labelsOf(config.steps, pending)}.`,
        pending,
      );
    }
    const mapped = mapProfile(config.steps, doc.raw_data);
    const profile = withPlace(
      mapped.profile,
      await this.placeOf(mapped.profile.pincode),
    );
    return this.agents.approve(agent, by, profile, mapped.location);
  }

  async progressFor(
    agentRefs: string[],
  ): Promise<
    Map<string, { completion_pct: number; submitted_at: Date | null }>
  > {
    const rows = await this.onboarding.progressFor(agentRefs);
    return new Map(
      rows.map((r) => [
        r.agent_ref,
        { completion_pct: r.completion_pct, submitted_at: r.submitted_at },
      ]),
    );
  }

  /**
   * Per partner (`agent_ref`): PAN, bank account, and whether HO verified the
   * PAN and the bank proof. The fields are found by what they are on the
   * partner's own form version (`org_document`, `maps_to`), not by key, so a
   * cohort whose form names them differently still pays.
   */
  async payoutFacts(
    agentRefs: readonly string[],
  ): Promise<Map<string, PayoutFacts>> {
    if (agentRefs.length === 0) return new Map();
    const docs = await this.onboarding.forPayout(agentRefs);
    const out = new Map<string, PayoutFacts>();
    for (const doc of docs) {
      const fields = [
        ...fieldIndex(
          (await this.configs.version(doc.cohort, doc.config_version)).steps,
        ).values(),
      ];
      const keyOf = (match: (f: FieldDef) => boolean) =>
        fields.find(match)?.key ?? null;
      const pan = keyOf((f) => f.org_document === PAN_DOCUMENT);
      const proof = keyOf((f) => f.org_document === BANK_DOCUMENT);
      const bank = keyOf((f) => f.maps_to === BANK_ACCOUNT_FIELD);
      const raw = doc.raw_data ?? {};
      const panValue = pan ? (raw[pan] as { number?: unknown } | null) : null;
      const account = bank
        ? (raw[bank] as Record<string, unknown> | null)
        : null;
      const verified = (key: string | null) =>
        !!key && doc.documents_review?.[key]?.status === 'verified';
      out.set(doc.agent_ref, {
        pan_number: text(panValue?.number)?.toUpperCase() ?? null,
        pan_verified: verified(pan),
        bank_verified: verified(proof),
        bank_change_pending: doc.bank_change?.status === 'pending',
        bank_account: account
          ? {
              account_holder: text(account.account_holder),
              account_number: text(account.account_number),
              ifsc: text(account.ifsc)?.toUpperCase() ?? null,
            }
          : null,
      });
    }
    return out;
  }

  nearby(
    point: GeoPoint,
    radiusKm: number,
    excludeAgentRef: string,
    limit: number,
  ): Promise<OnboardingData[]> {
    return this.onboarding.near(point, radiusKm, excludeAgentRef, limit);
  }

  /**
   * One-off (`scripts/backfill-id-keys`): fills `id_keys` on rows saved before
   * the duplicate check and reports every Aadhaar / PAN held by more than one
   * partner — agent ids only, never the value.
   */
  async backfillIdKeys(apply: boolean): Promise<{
    scanned: number;
    changed: number;
    skipped: number;
    duplicates: DuplicateIds[];
  }> {
    const PAGE = 200;
    const holders = new Map<string, Set<string>>();
    const hold = (key: string, agentId: string) =>
      holders.set(key, (holders.get(key) ?? new Set()).add(agentId));
    let scanned = 0;
    let changed = 0;
    let skipped = 0;
    for (let after: string | null = null; ;) {
      const rows = await this.onboarding.pageAfter(after, PAGE);
      for (const row of rows) {
        scanned += 1;
        const config = await this.configs.version(
          row.cohort,
          row.config_version,
        );
        const keys: IdKeys = idKeysOf(config.steps, row.raw_data ?? {});
        if (keys.aadhaar_hash)
          hold(`aadhaar:${keys.aadhaar_hash}`, row.agent_id);
        if (keys.pan) hold(`pan:${keys.pan}`, row.agent_id);
        if (
          row.id_keys?.aadhaar_hash === keys.aadhaar_hash &&
          row.id_keys?.pan === keys.pan
        )
          continue;
        changed += 1;
        // A save that lands meanwhile writes `id_keys` itself.
        if (
          apply &&
          !(await this.onboarding.updateIfVersion(row._id, row.version, {
            $set: { id_keys: keys },
          }))
        )
          skipped += 1;
      }
      if (rows.length < PAGE) break;
      after = rows[rows.length - 1]._id;
    }
    const duplicates = [...holders]
      .filter(([, ids]) => ids.size > 1)
      .map(([key, ids]) => ({
        kind: key.startsWith('aadhaar:')
          ? ('aadhaar' as const)
          : ('pan' as const),
        agent_ids: [...ids].sort(),
      }));
    return { scanned, changed, skipped, duplicates };
  }

  // ── internals ─────────────────────────────────────────────────────────

  private assertPartnerCanEdit(agent: AgentRecord): void {
    if (agent.stage === 'blocked' || !agent.is_active) {
      throw apiError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_BLOCKED',
        'Your account is blocked. Please contact Katyayani support.',
      );
    }
    if (!PARTNER_EDITABLE.has(agent.stage)) {
      throw apiError(
        HttpStatus.CONFLICT,
        'ONBOARDING_LOCKED',
        'Your application is with Katyayani for review. You cannot change it now.',
      );
    }
  }

  private async requireDoc(agent: AgentRecord): Promise<OnboardingData> {
    const doc = await this.onboarding.findByAgent(agent._id);
    if (!doc)
      throw badRequest(
        'COHORT_REQUIRED',
        'The application form has not been started yet.',
      );
    return doc;
  }

  /** While changes are requested, only the flagged fields and rejected documents may change. */
  private editableKeys(
    agent: AgentRecord,
    doc: OnboardingData,
  ): Set<string> | null {
    if (agent.stage !== 'changes_requested') return null;
    const keys = new Set(Object.keys(doc.remarks ?? {}));
    for (const [key, review] of Object.entries(doc.documents_review ?? {})) {
      if (review.status === 'rejected') keys.add(key);
    }
    return keys;
  }

  /**
   * Before the first submit the form follows the latest published version
   * (and the partner may still switch cohort); values for fields the new
   * version does not have are dropped. After a submit the version is fixed —
   * HO reviewed against it.
   */
  private async repinIfAllowed(
    agent: AgentRecord,
    doc: OnboardingData,
    cohort: string | undefined,
  ): Promise<{ doc: OnboardingData; config: OnboardingConfig }> {
    const pinned = await this.configs.version(doc.cohort, doc.config_version);
    const switching = !!cohort && cohort !== doc.cohort;
    if (doc.submit_count > 0 || agent.stage === 'changes_requested') {
      if (switching) {
        throw apiError(
          HttpStatus.CONFLICT,
          'ONBOARDING_LOCKED',
          'You cannot change how you work with Katyayani after submitting the form.',
        );
      }
      return { doc, config: pinned };
    }

    let target = pinned;
    if (switching) {
      await this.cohorts.require(cohort);
      target = await this.configs.requirePublished(cohort);
    } else {
      const latest = await this.configs.published(doc.cohort);
      if (latest && latest.version > doc.config_version) target = latest;
    }
    if (target._id === doc.config_id) return { doc, config: pinned };

    const fields = fieldIndex(target.steps);
    const kept = Object.fromEntries(
      Object.entries(doc.raw_data).filter(([k]) => fields.has(k)),
    );
    const updated = await this.withRetry(doc, () => ({
      $set: {
        cohort: target.cohort,
        config_id: target._id,
        config_version: target.version,
        raw_data: kept,
        id_keys: idKeysOf(target.steps, kept),
        ...progress(target.steps, kept),
        ...this.locationUpdate(target.steps, kept),
      },
    }));
    return { doc: updated, config: target };
  }

  private check(
    steps: StepDef[],
    data: Record<string, unknown>,
    piiId: string,
    editable: Set<string> | null,
  ): Changes {
    const fields = fieldIndex(steps);
    const unknown: string[] = [];
    const locked: string[] = [];
    const errors: string[] = [];
    const changes: Changes = { sets: {}, unsets: [] };

    for (const [key, value] of Object.entries(data)) {
      const field = fields.get(key);
      if (!field) {
        unknown.push(key);
        continue;
      }
      if (editable && !editable.has(key)) {
        locked.push(key);
        continue;
      }
      if (value === null || value === undefined) {
        changes.unsets.push(key);
        continue;
      }
      const checked = checkValue(field, value, { piiId });
      if (checked.ok) changes.sets[key] = checked.value;
      else errors.push(checked.error);
    }

    if (unknown.length)
      throw badRequest(
        'UNKNOWN_FIELD',
        'This form has changed. Please close it, open it again and try once more.',
        unknown,
      );
    if (locked.length) {
      throw apiError(
        HttpStatus.CONFLICT,
        'FIELD_NOT_EDITABLE',
        'You can change only the details Katyayani asked you to fix.',
        locked,
      );
    }
    if (errors.length)
      throw badRequest(
        'VALIDATION_FAILED',
        errors[0] ?? 'Some answers are not correct. Please check them.',
        errors,
      );
    return changes;
  }

  /** One atomic write of the changed keys plus the recomputed progress. */
  private apply(
    doc: OnboardingData,
    config: OnboardingConfig,
    changes: Changes,
    meta: {
      by: string;
      current_step?: string;
      audit?: AdminEdit[];
      reopenReviews?: string[];
    },
  ): Promise<OnboardingData> {
    return this.withRetry(doc, (current) => {
      const merged: RawData = { ...current.raw_data, ...changes.sets };
      for (const key of changes.unsets) delete merged[key];

      const $set: Record<string, unknown> = {
        ...progress(config.steps, merged),
        id_keys: idKeysOf(config.steps, merged),
        updated_by: meta.by,
        ...(meta.current_step ? { current_step: meta.current_step } : {}),
      };
      const $unset: Record<string, ''> = {};
      for (const [key, value] of Object.entries(changes.sets))
        $set[`raw_data.${key}`] = value;
      for (const key of changes.unsets) $unset[`raw_data.${key}`] = '';
      for (const key of meta.reopenReviews ?? []) {
        $set[`documents_review.${key}.status`] = 'pending';
        $set[`documents_review.${key}.reason`] = null;
      }
      const location = locationOf(config.steps, merged);
      if (location) $set.location = location;
      else $unset.location = '';

      const update: UpdateQuery<OnboardingDataDocument> = { $set };
      if (Object.keys($unset).length) update.$unset = $unset;
      if (meta.audit?.length)
        update.$push = { updated_data: { $each: meta.audit, $slice: -200 } };
      return update;
    });
  }

  /**
   * Refuses an Aadhaar or PAN another partner's form already holds. Only the
   * values in `raw` are checked — a save passes just the fields it sets, so an
   * old clash never blocks an unrelated answer (submit checks everything).
   */
  private async assertIdsFree(
    agentRef: string,
    steps: StepDef[],
    raw: RawData,
  ): Promise<void> {
    const keys = idKeysOf(steps, raw);
    const clashes = duplicatesOf(
      keys,
      agentRef,
      await this.onboarding.idHolders(keys, agentRef, MAX_ID_HOLDERS),
    );
    if (clashes.length === 0) return;
    const fieldKeys = idFieldKeys(steps);
    throw conflict(
      'ID_IN_USE',
      idInUseMessage(clashes.map((c) => c.kind)),
      clashes.flatMap((c) => fieldKeys[c.kind] ?? []),
    );
  }

  /** Optimistic write: retried against a fresh read if another write landed first. */
  private async withRetry(
    doc: OnboardingData,
    build: (current: OnboardingData) => UpdateQuery<OnboardingDataDocument>,
  ): Promise<OnboardingData> {
    let current = doc;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const updated = await this.onboarding.updateIfVersion(
        current._id,
        current.version,
        build(current),
      );
      if (updated) return updated;
      const fresh = await this.onboarding.findByAgent(current.agent_ref);
      if (!fresh) break;
      current = fresh;
    }
    throw conflict(
      'VERSION_CONFLICT',
      'Your form was being saved from another place at the same time. Please try again.',
    );
  }

  private locationUpdate(
    steps: StepDef[],
    raw: RawData,
  ): { location?: GeoPoint } {
    const location = locationOf(steps, raw);
    return location ? { location } : {};
  }

  /**
   * Review states on submit: a document unchanged since HO verified it stays
   * verified; anything new or changed is pending; removed documents drop out.
   */
  private reviewForSubmit(
    steps: StepDef[],
    doc: OnboardingData,
  ): Record<string, DocumentReview> {
    const review: Record<string, DocumentReview> = {};
    for (const key of documentKeys(steps)) {
      const value = doc.raw_data[key];
      if (value === undefined || value === null) continue;
      const sig = JSON.stringify(value);
      const previous = doc.documents_review?.[key];
      review[key] =
        previous && previous.sig === sig && previous.status === 'verified'
          ? previous
          : { status: 'pending', reason: null, by: null, at: null, sig };
    }
    return review;
  }

  private async refreshPreview(
    agent: AgentRecord,
    doc: OnboardingData,
    config: OnboardingConfig,
  ): Promise<void> {
    const typed = previewOf(config.steps, doc.raw_data);
    const preview = withPlace(typed, await this.placeOf(typed.pincode));
    if (
      agent.cohort === doc.cohort &&
      JSON.stringify(agent.preview ?? {}) === JSON.stringify(preview)
    )
      return;
    await this.agents.setPreview(agent._id, doc.cohort, preview);
  }

  /** The pincode's state and district, `null` when unknown or not given. */
  private placeOf(pincode: unknown) {
    const code = typeof pincode === 'number' ? String(pincode) : pincode;
    return typeof code === 'string'
      ? this.pincodes.lookup(code.trim())
      : Promise.resolve(null);
  }

  private async view(
    agent: AgentRecord,
    doc: OnboardingData,
    config: OnboardingConfig,
    editable: Set<string> | null = this.editableKeys(agent, doc),
  ): Promise<OnboardingView> {
    const urls = await this.storage.sign(filePaths(config.steps, doc.raw_data));
    const review = Object.fromEntries(
      Object.entries(doc.documents_review ?? {}).map(
        ([k, { sig: _sig, ...rest }]) => [k, rest],
      ),
    );
    return {
      onboarding_id: doc._id,
      cohort: doc.cohort,
      config_id: doc.config_id,
      config_version: doc.config_version,
      stage: agent.stage,
      editable_fields: editable
        ? [...editable]
        : PARTNER_EDITABLE.has(agent.stage)
          ? null
          : [],
      raw_data: withUrls(config.steps, doc.raw_data, urls),
      current_step: doc.current_step,
      completed_steps: doc.completed_steps,
      completion_pct: doc.completion_pct,
      missing_required: missingRequired(config.steps, doc.raw_data),
      documents_review: review,
      remarks: doc.remarks ?? {},
      submitted_at: doc.submitted_at,
      submit_count: doc.submit_count,
      updated_at: doc.updated_at,
    };
  }
}
