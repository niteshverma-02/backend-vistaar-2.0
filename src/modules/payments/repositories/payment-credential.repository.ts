import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo, type QueryFilter } from 'mongoose';

import type { CredentialStatus } from '../payment-credentials.domain';
import type { PaymentProvider } from '../payments.domain';
import {
  PaymentCredential,
  type CredentialTest,
  type PaymentCredentialDocument,
} from '../schemas/payment-credential.schema';

/** Every read that is not about to decrypt leaves the sealed secrets in Mongo. */
const NO_SECRETS = { secrets: 0 } as const;

/** What a set keeps once it stops being usable: no secrets. */
const retire = (
  status: CredentialStatus,
  by: string,
  reason: string | null,
) => ({
  status,
  secrets: null,
  retired_at: new Date(),
  retired_by: by,
  reason,
});

const isDuplicateKey = (error: unknown): boolean =>
  error instanceof mongo.MongoServerError && error.code === 11000;

@Injectable()
export class PaymentCredentialRepository {
  constructor(
    @InjectModel(PaymentCredential.name)
    private readonly model: Model<PaymentCredentialDocument>,
  ) {}

  /** `null` when the provider already has a pending set (unique index). */
  async insertPending(
    row: Omit<PaymentCredential, 'created_at' | 'updated_at'>,
  ): Promise<PaymentCredential | null> {
    try {
      const doc = await this.model.create(row);
      const { secrets: _sealed, ...rest } = doc.toObject<PaymentCredential>();
      return { ...rest, secrets: null };
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  find(id: string): Promise<PaymentCredential | null> {
    return this.model
      .findById(id, NO_SECRETS)
      .lean<PaymentCredential | null>()
      .exec();
  }

  /** With the sealed secrets — only for the gateway check and payment. */
  findSealed(id: string): Promise<PaymentCredential | null> {
    return this.model.findById(id).lean<PaymentCredential | null>().exec();
  }

  activeSealed(provider: PaymentProvider): Promise<PaymentCredential | null> {
    return this.model
      .findOne({ provider, status: 'active' })
      .lean<PaymentCredential | null>()
      .exec();
  }

  /** The current and the waiting set of every provider, no secrets. */
  current(): Promise<PaymentCredential[]> {
    return this.model
      .find({ status: { $in: ['active', 'pending', 'approved'] } }, NO_SECRETS)
      .lean<PaymentCredential[]>()
      .exec();
  }

  async history(
    provider: PaymentProvider,
    skip: number,
    limit: number,
  ): Promise<{ rows: PaymentCredential[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.model
        .find({ provider }, NO_SECRETS)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .lean<PaymentCredential[]>()
        .exec(),
      this.model.countDocuments({ provider }).exec(),
    ]);
    return { rows, total };
  }

  setTest(id: string, test: CredentialTest): Promise<PaymentCredential | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { test } },
        { returnDocument: 'after', projection: NO_SECRETS },
      )
      .lean<PaymentCredential | null>()
      .exec();
  }

  /**
   * Step 1 of going live, every rule in one conditional write: still pending,
   * not expired, tested OK, and not approved by the person who submitted it.
   */
  claimApproval(
    id: string,
    by: string,
    now: Date,
  ): Promise<PaymentCredential | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          status: 'pending',
          expires_at: { $gt: now },
          submitted_by: { $ne: by },
          'test.ok': true,
        },
        { $set: { status: 'approved', decided_by: by, decided_at: now } },
        { returnDocument: 'after', projection: NO_SECRETS },
      )
      .lean<PaymentCredential | null>()
      .exec();
  }

  /** Step 2: the old live set is retired and its secrets wiped. */
  async retireActive(
    provider: PaymentProvider,
    exceptId: string | null,
    status: 'superseded' | 'revoked',
    by: string,
    reason: string | null,
  ): Promise<boolean> {
    const filter: QueryFilter<PaymentCredential> = exceptId
      ? { provider, status: 'active', _id: { $ne: exceptId } }
      : { provider, status: 'active' };
    const res = await this.model
      .updateOne(filter, { $set: retire(status, by, reason) })
      .exec();
    return res.modifiedCount === 1;
  }

  /** Step 3: the approved set goes live. */
  promote(id: string, now: Date): Promise<PaymentCredential | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'approved' },
        { $set: { status: 'active', activated_at: now } },
        { returnDocument: 'after', projection: NO_SECRETS },
      )
      .lean<PaymentCredential | null>()
      .exec();
  }

  reject(
    id: string,
    by: string,
    reason: string,
  ): Promise<PaymentCredential | null> {
    return this.model
      .findOneAndUpdate(
        { _id: id, status: 'pending' },
        {
          $set: {
            ...retire('rejected', by, reason),
            decided_by: by,
            decided_at: new Date(),
          },
        },
        { returnDocument: 'after', projection: NO_SECRETS },
      )
      .lean<PaymentCredential | null>()
      .exec();
  }

  async expire(id: string, now: Date): Promise<void> {
    await this.model
      .updateOne(
        { _id: id, status: 'pending', expires_at: { $lte: now } },
        { $set: retire('expired', 'system', 'Not approved within 24 hours') },
      )
      .exec();
  }
}
