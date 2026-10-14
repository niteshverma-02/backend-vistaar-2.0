import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { Types } from 'mongoose';

import {
  UpdateTestimonialDto,
  type CreateTestimonialDto,
} from '../dto/testimonial.dto';
import type { SubmissionRepository } from '../repositories/submission.repository';
import type {
  TestimonialRepository,
  TestimonialRow,
} from '../repositories/testimonial.repository';
import { statusFilter, statusOf } from '../testimonials.domain';
import { TestimonialsService } from './testimonials.service';

const ID = '665a2c3d4e5f6789abcdef12';
const BY = 'ho@katyayaniorganics.com';

function row(overrides: Partial<TestimonialRow> = {}): TestimonialRow {
  return {
    _id: new Types.ObjectId(ID),
    source: 'vistaar',
    type: 'product',
    bulk: 'NEEM-BULK-001',
    family: null,
    verified: false,
    deleted: false,
    media: { media_type: 'video', media_url: 'https://cdn.example.com/v.mp4' },
    feedbacks: [
      { contact: '+919000000001', status: true, timestamp: new Date() },
      { contact: '+919000000002', status: false, timestamp: new Date() },
      { contact: '+919000000003', status: true, timestamp: new Date() },
    ],
    review: 'Great',
    pii_id: null,
    user: { contact: '+919155061725', name: 'Ramu', profile_image: null },
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup() {
  const repo = {
    page: jest.fn().mockResolvedValue({ rows: [row()], total: 1 }),
    counts: jest.fn(),
    find: jest.fn().mockResolvedValue(row()),
    create: jest
      .fn()
      .mockImplementation((r: Omit<TestimonialRow, '_id'>) =>
        Promise.resolve({ ...r, _id: new Types.ObjectId(ID) }),
      ),
    update: jest.fn().mockResolvedValue(row({ verified: true })),
    remove: jest.fn().mockResolvedValue(true),
    productExists: jest.fn().mockResolvedValue(true),
    comboExists: jest.fn().mockResolvedValue(true),
  };
  const submissions = {
    linkedTestimonials: jest.fn().mockResolvedValue(new Set<string>()),
  };
  return {
    repo,
    submissions,
    service: new TestimonialsService(
      repo as unknown as TestimonialRepository,
      submissions as unknown as SubmissionRepository,
    ),
  };
}

const create = (
  o: Partial<CreateTestimonialDto> = {},
): CreateTestimonialDto => ({
  bulk: 'NEEM-BULK-001',
  media: { media_type: 'video', media_url: 'https://cdn.example.com/v.mp4' },
  user: { contact: '+91 91550 61725', name: ' Ramu ' },
  ...o,
});

/** The row the service handed the repository. */
const saved0 = (repo: ReturnType<typeof setup>['repo']): TestimonialRow =>
  (repo.create.mock.calls as unknown as [TestimonialRow][])[0][0];

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException)
      return (e.getResponse() as { error?: string }).error;
    throw e;
  }
  return undefined;
}

describe('testimonials domain', () => {
  it('puts each row in one tray', () => {
    expect(statusOf({ verified: false, deleted: false })).toBe('pending');
    expect(statusOf({ verified: true, deleted: false })).toBe('approved');
    expect(statusOf({ verified: true, deleted: true })).toBe('removed');
  });

  it('matches legacy rows with no flag as pending', () => {
    expect(statusFilter('pending')).toEqual({
      deleted: { $ne: true },
      verified: { $ne: true },
    });
  });
});

describe('TestimonialsService', () => {
  it('files a new one under source vistaar, contact as +91, unapproved by default', async () => {
    const { repo, service } = setup();
    const view = await service.create(create(), BY);
    const saved = saved0(repo);
    expect(saved.source).toBe('vistaar');
    expect(saved.user).toEqual({
      contact: '+919155061725',
      name: 'Ramu',
      profile_image: null,
    });
    expect(saved.verified).toBe(false);
    expect(saved.verified_by).toBeNull();
    expect(saved.deleted_by).toBeNull();
    expect(view.status).toBe('pending');
    expect(view._id).toBe(ID);
  });

  it('files a combo under family', async () => {
    const { repo, service } = setup();
    await service.create(create({ bulk: undefined, family: 'FAM-1' }), BY);
    expect(repo.comboExists).toHaveBeenCalledWith('FAM-1');
    expect(saved0(repo).type).toBe('combo');
  });

  it('needs exactly one of bulk or family', async () => {
    const { service } = setup();
    expect(await code(service.create(create({ family: 'FAM-1' }), BY))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await code(service.create(create({ bulk: undefined }), BY))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('refuses a product that is not in the catalogue', async () => {
    const { repo, service } = setup();
    repo.productExists.mockResolvedValue(false);
    expect(await code(service.create(create(), BY))).toBe('PRODUCT_NOT_FOUND');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a phone that is not a mobile', async () => {
    const { service } = setup();
    expect(
      await code(service.create(create({ user: { contact: '12345' } }), BY)),
    ).toBe('VALIDATION_FAILED');
  });

  it('approves with who did it, and counts likes', async () => {
    const { repo, service } = setup();
    const view = await service.update(ID, { verified: true }, BY);
    expect(repo.update).toHaveBeenCalledWith(ID, {
      verified: true,
      verified_by: BY,
    });
    expect(view.status).toBe('approved');
    expect([view.likes, view.dislikes]).toEqual([2, 1]);
  });

  it('corrects the name inside user, not over it', async () => {
    const { repo, service } = setup();
    await service.update(ID, { name: ' Ramu Kaka ' }, BY);
    expect(repo.update).toHaveBeenCalledWith(ID, {
      'user.name': 'Ramu Kaka',
    });
  });

  it('writes only the fields sent, as the ValidationPipe hands them over', async () => {
    const { repo, service } = setup();
    const dto = plainToInstance(UpdateTestimonialDto, { verified: true });
    await service.update(ID, dto, BY);
    expect(repo.update).toHaveBeenCalledWith(ID, {
      verified: true,
      verified_by: BY,
    });
  });

  it('refuses an empty change and a bad id', async () => {
    const { service } = setup();
    expect(await code(service.update(ID, {}, BY))).toBe('VALIDATION_FAILED');
    const empty = plainToInstance(UpdateTestimonialDto, {});
    expect(await code(service.update(ID, empty, BY))).toBe('VALIDATION_FAILED');
    expect(await code(service.get('not-an-id'))).toBe('VALIDATION_FAILED');
  });

  it("answers 404 for another app's row (the repository scopes to vistaar)", async () => {
    const { repo, service } = setup();
    repo.find.mockResolvedValue(null);
    repo.update.mockResolvedValue(null);
    repo.remove.mockResolvedValue(false);
    expect(await code(service.get(ID))).toBe('NOT_FOUND');
    expect(await code(service.update(ID, { deleted: true }, BY))).toBe(
      'NOT_FOUND',
    );
    expect(await code(service.remove(ID))).toBe('NOT_FOUND');
  });

  it("refuses to change or delete a partner's testimonial from this desk", async () => {
    const { repo, submissions, service } = setup();
    submissions.linkedTestimonials.mockResolvedValue(new Set([ID]));
    expect(await code(service.update(ID, { verified: false }, BY))).toBe(
      'TESTIMONIAL_FROM_PARTNER',
    );
    expect(await code(service.remove(ID))).toBe('TESTIMONIAL_FROM_PARTNER');
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.remove).not.toHaveBeenCalled();
  });
});
