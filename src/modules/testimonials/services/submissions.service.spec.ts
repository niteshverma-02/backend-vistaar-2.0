import { HttpException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { PartnerRef } from '@common/auth/current-partner.decorator';
import { notFound } from '@common/errors/api-error';
import type { AgentsService } from '@modules/agents/services/agents.service';
import type { LeadsService } from '@modules/leads/services/leads.service';
import type { SettingsService } from '@modules/settings/services/settings.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { SubmitTestimonialDto } from '../dto/submission.dto';
import type { ConsentRepository } from '../repositories/consent.repository';
import type { ReviewRepository } from '../repositories/review.repository';
import type {
  SubmissionRepository,
  SubmissionRow,
} from '../repositories/submission.repository';
import type { TestimonialRepository } from '../repositories/testimonial.repository';
import { canAct, ownsMedia } from '../testimonials.domain';
import { SubmissionsService, toLibrary } from './submissions.service';

const AGENT = 'VST-000123';
const PARTNER: PartnerRef = { agent_id: AGENT, pii_id: 'PII-9' };
const ID = '0b6e7c1e-2f7a-4c55-9a43-6b0f0e3f8a11';
const VIDEO = `vistaar/testimonials/${AGENT}/video/3f1c2a9e-1b2c-4d5e-8f90-1234567890ab.mp4`;
const BY = 'ho@katyayaniorganics.com';
const PUBLIC_URL = 'https://firebasestorage.googleapis.com/v0/b/b/o/x?token=t';

function row(o: Partial<SubmissionRow> = {}): SubmissionRow {
  return {
    _id: ID,
    agent_id: AGENT,
    partner_name: 'Asha',
    pii_id: 'PII-1',
    farmer_name: 'Ramu',
    farmer_contact: '+919155061725',
    village: 'Rampur',
    district: 'Indore',
    state: 'Madhya Pradesh',
    type: 'product',
    bulk: 'BK-48',
    family: null,
    product_name: 'HUMIC+FULVIC',
    crop: 'Wheat',
    kind: 'video',
    text: 'Yield went up',
    rating: 5,
    media_path: VIDEO,
    media_url: null,
    duration_sec: 40,
    status: 'submitted',
    reason: null,
    decided_by: null,
    decided_at: null,
    approved_at: null,
    review_id: new Types.ObjectId(),
    testimonial_id: new Types.ObjectId(),
    gig_id: null,
    views: 0,
    shares: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...o,
  };
}

function setup() {
  const insert = jest.fn().mockResolvedValue(true);
  const submissions = {
    // Not there until inserted — the shape of a first submit.
    findMine: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(insert.mock.calls.length ? row() : null),
      ),
    find: jest.fn().mockResolvedValue(row()),
    insert,
    transition: jest
      .fn()
      .mockImplementation(
        (_id: string, _from: unknown, set: Partial<SubmissionRow>) =>
          Promise.resolve(row(set)),
      ),
    library: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    mediaTaken: jest.fn().mockResolvedValue(false),
  };
  const consents = {
    insert: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue({ status: 'given' }),
    findMany: jest.fn().mockResolvedValue(new Map()),
    withdraw: jest.fn().mockResolvedValue({ status: 'withdrawn' }),
  };
  const reviews = {
    show: jest.fn().mockResolvedValue(undefined),
    hide: jest.fn().mockResolvedValue(undefined),
    erase: jest.fn().mockResolvedValue(undefined),
  };
  const testimonials = {
    show: jest.fn().mockResolvedValue(undefined),
    hide: jest.fn().mockResolvedValue(undefined),
    erase: jest.fn().mockResolvedValue(undefined),
    tradeNames: jest
      .fn()
      .mockResolvedValue(new Map([['BK-48', 'HUMIC+FULVIC']])),
    productExists: jest.fn().mockResolvedValue(true),
    comboExists: jest.fn().mockResolvedValue(true),
    comboName: jest.fn().mockResolvedValue('Combo'),
  };
  const storage = {
    stat: jest
      .fn()
      .mockResolvedValue({ size: 20_000_000, contentType: 'video/mp4' }),
    sign: jest.fn().mockResolvedValue(new Map()),
    publish: jest.fn().mockResolvedValue(PUBLIC_URL),
    unpublish: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const leads = {
    getMine: jest.fn().mockResolvedValue({
      name: 'Ramu',
      phone: '9155061725',
      village: 'Rampur',
      district: 'Indore',
      state: 'Madhya Pradesh',
    }),
  };
  const agents = {
    requireByAgentId: jest.fn().mockResolvedValue({
      stage: 'approved',
      is_active: true,
      profile: { name: 'Asha' },
    }),
  };
  const settings = {
    get: jest.fn().mockResolvedValue({
      testimonial_consent: {
        version: 2,
        text: { en: 'May show it.', hi: 'दिखा सकते हैं।' },
      },
    }),
  };
  const service = new SubmissionsService(
    submissions as unknown as SubmissionRepository,
    consents as unknown as ConsentRepository,
    reviews as unknown as ReviewRepository,
    testimonials as unknown as TestimonialRepository,
    storage as unknown as StorageService,
    leads as unknown as LeadsService,
    agents as unknown as AgentsService,
    settings as unknown as SettingsService,
  );
  return {
    service,
    submissions,
    consents,
    reviews,
    testimonials,
    storage,
    leads,
    agents,
  };
}

const dto = (o: Partial<SubmitTestimonialDto> = {}): SubmitTestimonialDto => ({
  id: ID,
  pii_id: 'PII-1',
  bulk: 'BK-48',
  crop: ' Wheat ',
  kind: 'video',
  media_path: VIDEO,
  duration_sec: 40,
  text: ' Yield went up ',
  rating: 5,
  consent_version: 2,
  consent_lang: 'hi',
  ...o,
});

/** What the service handed a repository on its first call. */
const firstArg = <T>(fn: jest.Mock): T =>
  (fn.mock.calls as unknown as [T][])[0][0];

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as HttpException).getResponse() as { error?: string }).error;
  }
  return undefined;
}

describe('testimonial domain', () => {
  it('accepts only a file in the caller’s own folder, of that kind', () => {
    expect(ownsMedia(AGENT, 'video', VIDEO)).toBe(true);
    expect(ownsMedia('VST-000999', 'video', VIDEO)).toBe(false);
    expect(ownsMedia(AGENT, 'photo', VIDEO)).toBe(false);
    expect(ownsMedia(AGENT, 'video', `${VIDEO}/../../x.mp4`)).toBe(false);
  });

  it('lets HO approve again after a rejection or removal, but reject only once', () => {
    expect(canAct('approve', 'removed')).toBe(true);
    expect(canAct('approve', 'approved')).toBe(false);
    expect(canAct('reject', 'approved')).toBe(false);
    expect(canAct('remove', 'submitted')).toBe(false);
  });
});

describe('SubmissionsService · submit', () => {
  it('writes the consent (words in the farmer’s language) before the submission', async () => {
    const s = setup();
    const view = await s.service.submit(PARTNER, dto());
    const consent = firstArg<{
      version: number;
      text: string;
      pii_id: string;
    }>(s.consents.insert);
    expect(consent).toMatchObject({
      version: 2,
      text: 'दिखा सकते हैं।',
      pii_id: 'PII-1',
    });
    expect(s.consents.insert.mock.invocationCallOrder[0]).toBeLessThan(
      s.submissions.insert.mock.invocationCallOrder[0],
    );
    const saved = firstArg<SubmissionRow>(s.submissions.insert);
    expect(saved).toMatchObject({
      agent_id: AGENT,
      farmer_contact: '+919155061725',
      crop: 'Wheat',
      text: 'Yield went up',
      product_name: 'HUMIC+FULVIC',
      media_path: VIDEO,
    });
    expect(saved.testimonial_id).toBeInstanceOf(Types.ObjectId);
    expect(view.status).toBe('submitted');
    // Nothing shared is written before HO approves.
    expect(s.reviews.show).not.toHaveBeenCalled();
    expect(s.testimonials.show).not.toHaveBeenCalled();
  });

  it('answers a retry with the first one and writes nothing', async () => {
    const s = setup();
    s.submissions.findMine.mockReset().mockResolvedValue(row());
    await s.service.submit(PARTNER, dto());
    expect(s.consents.insert).not.toHaveBeenCalled();
    expect(s.submissions.insert).not.toHaveBeenCalled();
  });

  it('refuses an outdated consent wording', async () => {
    const s = setup();
    expect(
      await code(s.service.submit(PARTNER, dto({ consent_version: 1 }))),
    ).toBe('CONSENT_OUTDATED');
    expect(s.consents.insert).not.toHaveBeenCalled();
  });

  it('refuses a partner who is not approved', async () => {
    const s = setup();
    s.agents.requireByAgentId.mockResolvedValue({
      stage: 'kyc_pending',
      is_active: true,
    });
    expect(await code(s.service.submit(PARTNER, dto()))).toBe(
      'PARTNER_NOT_APPROVED',
    );
  });

  it('refuses a farmer who is not the partner’s own', async () => {
    const s = setup();
    s.leads.getMine.mockRejectedValue(notFound('Farmer not found.'));
    expect(await code(s.service.submit(PARTNER, dto()))).toBe('NOT_FOUND');
    expect(s.submissions.insert).not.toHaveBeenCalled();
  });

  it('refuses another partner’s file, and one that never finished uploading', async () => {
    const s = setup();
    const theirs = VIDEO.replace(AGENT, 'VST-000999');
    expect(
      await code(s.service.submit(PARTNER, dto({ media_path: theirs }))),
    ).toBe('MEDIA_NOT_FOUND');
    s.storage.stat.mockResolvedValue(null);
    expect(await code(s.service.submit(PARTNER, dto()))).toBe(
      'MEDIA_NOT_FOUND',
    );
    expect(s.submissions.insert).not.toHaveBeenCalled();
  });

  it('refuses a file already on another of the partner’s testimonials', async () => {
    const s = setup();
    s.submissions.mediaTaken.mockResolvedValue(true);
    expect(await code(s.service.submit(PARTNER, dto()))).toBe(
      'VALIDATION_FAILED',
    );
    expect(s.submissions.insert).not.toHaveBeenCalled();
  });

  it('needs words for a quote, and no file; a quote gets no testimonial row', async () => {
    const s = setup();
    expect(
      await code(
        s.service.submit(
          PARTNER,
          dto({ kind: 'text', media_path: undefined, text: ' ' }),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(await code(s.service.submit(PARTNER, dto({ kind: 'text' })))).toBe(
      'VALIDATION_FAILED',
    );
    await s.service.submit(
      PARTNER,
      dto({ kind: 'text', media_path: undefined, duration_sec: undefined }),
    );
    const saved = firstArg<SubmissionRow>(s.submissions.insert);
    expect(saved.testimonial_id).toBeNull();
    expect(saved.media_path).toBeNull();
  });

  it('needs exactly one of product or combo', async () => {
    const s = setup();
    expect(
      await code(s.service.submit(PARTNER, dto({ family: 'K-06|K-19' }))),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('SubmissionsService · HO', () => {
  it('approves: shows both shared rows with the public link, then moves the status', async () => {
    const s = setup();
    const view = await s.service.approve(ID, BY);
    expect(s.storage.publish).toHaveBeenCalledWith(VIDEO);
    expect(s.reviews.show).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      expect.objectContaining({ rating: 5, pii_id: 'PII-1' }),
      BY,
    );
    expect(s.testimonials.show).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      expect.objectContaining({
        media: { media_type: 'video', media_url: PUBLIC_URL },
      }),
      BY,
    );
    expect(view.status).toBe('approved');
    expect(view.media?.url).toBe(PUBLIC_URL);
  });

  it('never approves once the farmer withdrew consent', async () => {
    const s = setup();
    s.consents.find.mockResolvedValue({ status: 'withdrawn' });
    expect(await code(s.service.approve(ID, BY))).toBe('CONSENT_WITHDRAWN');
    expect(s.reviews.show).not.toHaveBeenCalled();
  });

  it('erases what it just showed when consent was withdrawn meanwhile', async () => {
    const s = setup();
    s.consents.find
      .mockResolvedValueOnce({ status: 'given' })
      .mockResolvedValue({ status: 'withdrawn' });
    expect(await code(s.service.approve(ID, BY))).toBe('CONSENT_WITHDRAWN');
    expect(s.reviews.show).toHaveBeenCalled();
    expect(s.reviews.erase).toHaveBeenCalled();
    expect(s.testimonials.erase).toHaveBeenCalled();
    expect(s.submissions.transition).not.toHaveBeenCalled();
  });

  it('hides the shared rows again when a removal won the race', async () => {
    const s = setup();
    s.submissions.transition.mockResolvedValue(null);
    s.submissions.find
      .mockResolvedValueOnce(row())
      .mockResolvedValue(row({ status: 'removed' }));
    expect(await code(s.service.approve(ID, BY))).toBe(
      'TESTIMONIAL_NOT_ALLOWED',
    );
    expect(s.reviews.hide).toHaveBeenCalled();
    expect(s.testimonials.hide).toHaveBeenCalled();
  });

  it('rejects only a submitted one, with the reason for the partner', async () => {
    const s = setup();
    const view = await s.service.reject(ID, ' Too dark ', BY);
    expect(view.reason).toBe('Too dark');
    s.submissions.find.mockResolvedValue(row({ status: 'approved' }));
    expect(await code(s.service.reject(ID, 'x', BY))).toBe(
      'TESTIMONIAL_NOT_ALLOWED',
    );
  });

  it('removes an approved one: hidden everywhere and the link taken away', async () => {
    const s = setup();
    s.submissions.find.mockResolvedValue(
      row({ status: 'approved', media_url: PUBLIC_URL }),
    );
    const view = await s.service.remove(ID, undefined, BY);
    expect(s.reviews.hide).toHaveBeenCalled();
    expect(s.testimonials.hide).toHaveBeenCalled();
    expect(s.storage.unpublish).toHaveBeenCalledWith(VIDEO);
    expect(view.status).toBe('removed');
  });

  it('a withdrawal erases the shared rows and the file, once', async () => {
    const s = setup();
    s.submissions.find.mockResolvedValue(row({ status: 'approved' }));
    const view = await s.service.withdrawConsent(ID, 'Farmer called', BY);
    expect(s.reviews.erase).toHaveBeenCalled();
    expect(s.testimonials.erase).toHaveBeenCalled();
    expect(s.storage.remove).toHaveBeenCalledWith(VIDEO);
    expect(view.status).toBe('removed');
    s.consents.withdraw.mockResolvedValue(null);
    s.consents.find.mockResolvedValue({ status: 'withdrawn' });
    s.submissions.find.mockResolvedValue(
      row({ status: 'removed', media_path: null }),
    );
    expect(await code(s.service.withdrawConsent(ID, 'again', BY))).toBe(
      'CONSENT_WITHDRAWN',
    );
  });

  it('a retry finishes a withdrawal that failed part-way', async () => {
    const s = setup();
    s.submissions.find.mockResolvedValue(row({ status: 'approved' }));
    s.reviews.erase.mockRejectedValueOnce(new Error('network'));
    await expect(
      s.service.withdrawConsent(ID, 'Farmer called', BY),
    ).rejects.toThrow('network');

    s.consents.withdraw.mockResolvedValue(null);
    s.consents.find.mockResolvedValue({ status: 'withdrawn' });
    const view = await s.service.withdrawConsent(ID, 'Farmer called', BY);
    expect(view.status).toBe('removed');
    expect(s.storage.remove).toHaveBeenCalledWith(VIDEO);
  });
});

describe('library card', () => {
  it('never carries the farmer’s phone or pii_id', () => {
    const card = toLibrary(row({ status: 'approved', media_url: PUBLIC_URL }));
    expect(JSON.stringify(card)).not.toContain('9155061725');
    expect(JSON.stringify(card)).not.toContain('PII-1');
    expect(card.media?.url).toBe(PUBLIC_URL);
  });
});
