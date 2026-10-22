import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';

import { isDuplicateKey } from '@common/utils/mongo-error.util';

import { PROVIDER_DEFAULTS, type PaymentProvider } from '../payments.domain';
import {
  PaymentOptionAudit,
  type PaymentOptionAuditDocument,
} from '../schemas/payment-option-audit.schema';
import {
  PaymentOption,
  type PaymentOptionDocument,
} from '../schemas/payment-option.schema';

export type PaymentOptionPatch = Partial<
  Pick<PaymentOption, 'label' | 'hint' | 'is_active' | 'cohorts'>
>;

@Injectable()
export class PaymentOptionRepository {
  constructor(
    @InjectModel(PaymentOption.name)
    private readonly options: Model<PaymentOptionDocument>,
    @InjectModel(PaymentOptionAudit.name)
    private readonly audit: Model<PaymentOptionAuditDocument>,
  ) {}

  listAll(): Promise<PaymentOption[]> {
    return this.options.find().lean<PaymentOption[]>().exec();
  }

  find(id: PaymentProvider): Promise<PaymentOption | null> {
    return this.options.findById(id).lean<PaymentOption | null>().exec();
  }

  /**
   * Writes only if the row is still at `version` (0 = never saved), so two HO
   * screens cannot silently overwrite each other. `null` = it changed.
   */
  async save(
    id: PaymentProvider,
    version: number,
    set: PaymentOptionPatch,
    by: string,
  ): Promise<PaymentOption | null> {
    if (version === 0) {
      const defaults = PROVIDER_DEFAULTS[id];
      try {
        const doc = await this.options.create({
          _id: id,
          label: defaults.label,
          hint: defaults.hint,
          order: defaults.order,
          is_active: false,
          cohorts: [],
          ...set,
          version: 1,
          updated_by: by,
        });
        return doc.toObject<PaymentOption>();
      } catch (error) {
        if (isDuplicateKey(error)) return null;
        throw error;
      }
    }
    return this.options
      .findOneAndUpdate(
        { _id: id, version },
        { $set: { ...set, updated_by: by }, $inc: { version: 1 } },
        { returnDocument: 'after' },
      )
      .lean<PaymentOption | null>()
      .exec();
  }

  /** `order` = position in `ids`, in one round trip; a row not saved yet is created off. */
  async reorder(ids: readonly PaymentProvider[], by: string): Promise<void> {
    await this.options.bulkWrite(
      ids.map((id, order) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: { order, updated_by: by },
            $inc: { version: 1 },
            $setOnInsert: {
              label: PROVIDER_DEFAULTS[id].label,
              hint: PROVIDER_DEFAULTS[id].hint,
              is_active: false,
              cohorts: [],
            },
          },
          upsert: true,
        },
      })),
    );
  }

  async log(row: PaymentOptionAudit): Promise<void> {
    await this.audit.create(row);
  }

  async auditPage(
    optionId: string | undefined,
    skip: number,
    limit: number,
  ): Promise<{ rows: PaymentOptionAudit[]; total: number }> {
    const query: QueryFilter<PaymentOptionAudit> = optionId
      ? { option_id: optionId }
      : {};
    const [rows, total] = await Promise.all([
      this.audit
        .find(query)
        .sort({ at: -1 })
        .skip(skip)
        .limit(limit)
        .lean<PaymentOptionAudit[]>()
        .exec(),
      this.audit.countDocuments(query).exec(),
    ]);
    return { rows, total };
  }
}
