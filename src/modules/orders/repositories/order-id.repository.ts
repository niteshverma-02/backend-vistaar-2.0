import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

import {
  OrderId,
  type OrderIdDocument,
  type OrderIdRecord,
} from '../schemas/order-id.schema';

const DUPLICATE_KEY = 11000;

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === DUPLICATE_KEY;

const attemptId = (agentId: string, requestId: string): string =>
  `${agentId}:${requestId}`;

@Injectable()
export class OrderIdRepository {
  constructor(
    @InjectModel(OrderId.name) private readonly model: Model<OrderIdDocument>,
  ) {}

  /** From the primary: it is read right after a racing insert lost. */
  findByRequest(
    agentId: string,
    requestId: string,
  ): Promise<OrderIdRecord | null> {
    return this.model
      .findById(attemptId(agentId, requestId))
      .read('primary')
      .lean<OrderIdRecord>()
      .exec();
  }

  /** `null` when this attempt already holds a number (a concurrent copy won). */
  async insert(
    orderId: string,
    agentId: string,
    requestId: string,
  ): Promise<OrderIdRecord | null> {
    try {
      const doc = await this.model.create({
        _id: attemptId(agentId, requestId),
        order_id: orderId,
        agent_id: agentId,
        request_id: requestId,
      });
      return doc.toObject<OrderIdRecord>();
    } catch (err) {
      if (isDuplicateKey(err)) return null;
      throw err;
    }
  }
}
