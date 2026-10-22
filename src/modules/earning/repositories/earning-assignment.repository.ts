import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import type { AssignmentReason } from '../earning.domain';
import {
  EarningAssignment,
  type EarningAssignmentDocument,
} from '../schemas/earning-assignment.schema';

export type EarningAssignmentRecord = EarningAssignment;

/** One partner's move to another cohort, as a bulk recompute plans it. */
export interface CohortMove {
  agent_id: string;
  /** The open row read before planning; `null` = never assigned. */
  open_id: string | null;
  cohort_id: string;
}

const DUPLICATE_KEY = 11000;
/** Far above one partner's history; only a bound on a runaway read. */
const HISTORY_CAP = 500;

@Injectable()
export class EarningAssignmentRepository {
  constructor(
    @InjectModel(EarningAssignment.name)
    private readonly model: Model<EarningAssignmentDocument>,
  ) {}

  open(agentId: string): Promise<EarningAssignmentRecord | null> {
    return this.model
      .findOne({ agent_id: agentId, open: true })
      .lean<EarningAssignmentRecord | null>()
      .exec();
  }

  /** Every partner's current row — ids only, ~60 bytes a partner. */
  openAll(): Promise<
    Pick<EarningAssignmentRecord, '_id' | 'agent_id' | 'cohort_id' | 'from'>[]
  > {
    return this.model
      .find({ open: true })
      .select({ _id: 1, agent_id: 1, cohort_id: 1, from: 1 })
      .lean<
        Pick<
          EarningAssignmentRecord,
          '_id' | 'agent_id' | 'cohort_id' | 'from'
        >[]
      >()
      .exec();
  }

  /** A partner's stretches, newest first. */
  history(agentId: string, limit: number): Promise<EarningAssignmentRecord[]> {
    return this.model
      .find({ agent_id: agentId })
      .sort({ from: -1 })
      .limit(Math.min(limit, HISTORY_CAP))
      .lean<EarningAssignmentRecord[]>()
      .exec();
  }

  /** Every stretch of these partners, oldest first per partner. */
  forAgents(
    agentIds: readonly string[],
  ): Promise<
    Pick<EarningAssignmentRecord, 'agent_id' | 'cohort_id' | 'from' | 'to'>[]
  > {
    if (agentIds.length === 0) return Promise.resolve([]);
    return this.model
      .find({ agent_id: { $in: [...agentIds] } })
      .select({ _id: 0, agent_id: 1, cohort_id: 1, from: 1, to: 1 })
      .sort({ agent_id: 1, from: 1 })
      .lean<
        Pick<
          EarningAssignmentRecord,
          'agent_id' | 'cohort_id' | 'from' | 'to'
        >[]
      >()
      .exec();
  }

  /**
   * Closes `openId` and opens `cohortId` at `since`. `false` = another
   * process moved this partner first (its row stands).
   */
  async switchTo(
    agentId: string,
    openId: string | null,
    cohortId: string,
    since: Date,
    reason: AssignmentReason,
  ): Promise<boolean> {
    if (openId) {
      const closed = await this.model
        .updateOne(
          { _id: openId, open: true },
          { $set: { open: false, to: since } },
        )
        .exec();
      if (closed.modifiedCount !== 1) return false;
    }
    try {
      await this.model.create(this.row(agentId, cohortId, since, reason));
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }

  /**
   * The bulk form of `switchTo`: closes in one write, opens in another.
   * Answers the partners whose new row went in; the rest lost a race to
   * another process and are for the caller to look at again.
   */
  async switchMany(
    moves: readonly CohortMove[],
    since: Date,
    reason: AssignmentReason,
  ): Promise<Set<string>> {
    if (moves.length === 0) return new Set();
    const closes = moves.filter((m) => m.open_id);
    if (closes.length) {
      await this.model.bulkWrite(
        closes.map((m) => ({
          updateOne: {
            filter: { _id: m.open_id as string, open: true },
            update: { $set: { open: false, to: since } },
          },
        })),
        { ordered: false },
      );
    }
    // A close another process beat us to leaves its open row, so the insert
    // below fails on the unique partial index — never two current rows.
    const failed = new Set<number>();
    try {
      await this.model.bulkWrite(
        moves.map((m) => ({
          insertOne: {
            document: this.row(m.agent_id, m.cohort_id, since, reason),
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      if (!(error instanceof mongo.MongoBulkWriteError)) throw error;
      // One error or a list, by driver version.
      const raw: unknown = error.writeErrors;
      const errors = (Array.isArray(raw) ? raw : [raw]) as {
        code?: number;
        index: number;
      }[];
      if (errors.some((e) => e.code !== DUPLICATE_KEY)) throw error;
      for (const e of errors) failed.add(e.index);
    }
    return new Set(
      moves.filter((_, i) => !failed.has(i)).map((m) => m.agent_id),
    );
  }

  private row(
    agentId: string,
    cohortId: string,
    since: Date,
    reason: AssignmentReason,
  ): Omit<EarningAssignment, 'created_at'> {
    return {
      _id: randomUUID(),
      agent_id: agentId,
      cohort_id: cohortId,
      from: since,
      to: null,
      open: true,
      reason,
    };
  }
}
