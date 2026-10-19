import { HttpException } from '@nestjs/common';

import { forbidden } from '@common/errors/api-error';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { PiiService } from '@modules/spine/services/pii.service';

import type { OrderIdRepository } from '../repositories/order-id.repository';
import type { OrderRepository } from '../repositories/order.repository';
import type { OrderIdRecord } from '../schemas/order-id.schema';
import { MAX_TAKEN_SKIPS, OrderIdService } from './order-id.service';

const AGENT = 'VST-1';
const REQUEST = '3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b';
const AT = new Date('2026-10-16T08:00:00Z');

const row = (id: string): OrderIdRecord => ({
  _id: `${AGENT}:${REQUEST}`,
  order_id: id,
  agent_id: AGENT,
  request_id: REQUEST,
  created_at: AT,
});

describe('OrderIdService', () => {
  let findByRequest: jest.Mock;
  let insert: jest.Mock;
  let takenNumbers: jest.Mock;
  let tryNextOrgNumber: jest.Mock;
  let requireWorkingPartner: jest.Mock;
  let service: OrderIdService;
  let count: number;

  beforeEach(() => {
    count = 0;
    findByRequest = jest.fn().mockResolvedValue(null);
    insert = jest.fn((id: string) => Promise.resolve(row(id)));
    takenNumbers = jest.fn().mockResolvedValue([]);
    tryNextOrgNumber = jest.fn(() => Promise.resolve(++count));
    requireWorkingPartner = jest.fn().mockResolvedValue({});
    service = new OrderIdService(
      { findByRequest, insert } as unknown as OrderIdRepository,
      { takenNumbers } as unknown as OrderRepository,
      { tryNextOrgNumber } as unknown as PiiService,
      { requireWorkingPartner } as unknown as AgentsService,
    );
  });

  const code = async (p: Promise<unknown>): Promise<unknown> => {
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HttpException);
    const body = (err as HttpException).getResponse() as { error: string };
    return [(err as HttpException).getStatus(), body.error];
  };

  it('issues KSV-1 from the vistaar_orders counter', async () => {
    await expect(service.issue(AGENT, REQUEST)).resolves.toEqual({
      order_id: 'KSV-1',
      request_id: REQUEST,
      issued_at: AT,
    });
    expect(tryNextOrgNumber).toHaveBeenCalledWith('vistaar_orders');
    expect(insert).toHaveBeenCalledWith('KSV-1', AGENT, REQUEST);
  });

  it('returns the held number on a retry, spending none', async () => {
    findByRequest.mockResolvedValue(row('KSV-7'));
    await expect(service.issue(AGENT, REQUEST)).resolves.toMatchObject({
      order_id: 'KSV-7',
    });
    expect(tryNextOrgNumber).not.toHaveBeenCalled();
  });

  it('steps over numbers another order already carries', async () => {
    takenNumbers.mockResolvedValue([1, 2, 5]);
    await expect(service.issue(AGENT, REQUEST)).resolves.toMatchObject({
      order_id: 'KSV-3',
    });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('gives a racing copy of the request the winner’s number', async () => {
    insert.mockResolvedValue(null);
    findByRequest
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(row('KSV-4'));
    await expect(service.issue(AGENT, REQUEST)).resolves.toMatchObject({
      order_id: 'KSV-4',
    });
  });

  it('answers 503 when the counter row is missing', async () => {
    tryNextOrgNumber.mockResolvedValue(null);
    await expect(code(service.issue(AGENT, REQUEST))).resolves.toEqual([
      503,
      'ORDER_ID_UNAVAILABLE',
    ]);
    expect(insert).not.toHaveBeenCalled();
  });

  it('answers 503 after too many taken numbers in a row', async () => {
    takenNumbers.mockResolvedValue(
      Array.from({ length: MAX_TAKEN_SKIPS + 1 }, (_, i) => i + 1),
    );
    await expect(code(service.issue(AGENT, REQUEST))).resolves.toEqual([
      503,
      'ORDER_ID_UNAVAILABLE',
    ]);
    expect(tryNextOrgNumber).toHaveBeenCalledTimes(MAX_TAKEN_SKIPS + 1);
  });

  it('reads the old KSV- numbers once per process', async () => {
    await service.issue(AGENT, REQUEST);
    await service.issue(AGENT, 'another');
    expect(takenNumbers).toHaveBeenCalledTimes(1);
    expect(takenNumbers).toHaveBeenCalledWith('KSV-');
  });

  it('answers 503 and reads again next time when that read fails', async () => {
    takenNumbers.mockRejectedValueOnce(new Error('down'));
    await expect(code(service.issue(AGENT, REQUEST))).resolves.toEqual([
      503,
      'ORDER_ID_UNAVAILABLE',
    ]);
    expect(tryNextOrgNumber).not.toHaveBeenCalled();
    await expect(service.issue(AGENT, REQUEST)).resolves.toMatchObject({
      order_id: 'KSV-1',
    });
    expect(takenNumbers).toHaveBeenCalledTimes(2);
  });

  describe('issueForPartner (the app route)', () => {
    it('issues for an approved partner', async () => {
      await expect(
        service.issueForPartner(AGENT, REQUEST),
      ).resolves.toMatchObject({ order_id: 'KSV-1' });
      expect(requireWorkingPartner).toHaveBeenCalledWith(AGENT, 'place orders');
    });

    it('spends no number for a partner not approved or blocked', async () => {
      requireWorkingPartner.mockRejectedValue(
        forbidden('PARTNER_NOT_APPROVED', 'Not yet.'),
      );
      await expect(
        code(service.issueForPartner(AGENT, REQUEST)),
      ).resolves.toEqual([403, 'PARTNER_NOT_APPROVED']);
      expect(tryNextOrgNumber).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });
  });

  it('issue itself (payment webhook) does not check the account', async () => {
    await service.issue(AGENT, REQUEST);
    expect(requireWorkingPartner).not.toHaveBeenCalled();
  });
});
