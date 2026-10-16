import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';

import {
  CommissionPlan,
  type CommissionPlanDocument,
  type PlanChange,
} from '../schemas/commission-plan.schema';

export type PlanRecord = CommissionPlan;

@Injectable()
export class CommissionPlanRepository {
  constructor(
    @InjectModel(CommissionPlan.name)
    private readonly model: Model<CommissionPlanDocument>,
  ) {}

  /** Every plan — a few rows per cohort, held in memory by the service. */
  all(): Promise<PlanRecord[]> {
    return this.model
      .find()
      .sort({ cohort: 1, effective_from: 1 })
      .lean<PlanRecord[]>()
      .exec();
  }

  findById(id: string): Promise<PlanRecord | null> {
    return this.model.findById(id).lean<PlanRecord | null>().exec();
  }

  /** `false` when the cohort already has a plan from that month. */
  async insert(
    row: Omit<PlanRecord, 'created_at' | 'updated_at' | 'history'>,
  ): Promise<boolean> {
    try {
      await this.model.create({ ...row, history: [] });
      return true;
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000)
        return false;
      throw error;
    }
  }

  /**
   * Changes the plan only if it is still as it was read (`updated_at`), and
   * keeps that earlier state in `history`. `null` when it changed or is gone.
   */
  update(
    id: string,
    seen: Date,
    set: Partial<
      Pick<PlanRecord, 'kind' | 'slabs' | 'min_order_value' | 'notes' | 'draft'>
    > & {
      updated_by: string;
    },
    before: PlanChange,
  ): Promise<PlanRecord | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, updated_at: seen },
        { $set: set, $push: { history: before } },
        { returnDocument: 'after' },
      )
      .lean<PlanRecord | null>()
      .exec();
  }

  async remove(id: string, seen: Date): Promise<boolean> {
    const res = await this.model
      .deleteOne({ _id: id, updated_at: seen })
      .exec();
    return res.deletedCount === 1;
  }
}
