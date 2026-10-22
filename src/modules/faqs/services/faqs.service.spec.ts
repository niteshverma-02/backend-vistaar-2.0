import type { FaqSectionRepository } from '../repositories/faq-section.repository';
import type { FaqRepository } from '../repositories/faq.repository';
import { FaqSectionsService } from './faq-sections.service';
import { FaqsService } from './faqs.service';

const section = {
  _id: 'payments',
  label: 'Payments',
  emoji: '💰',
  order: 1,
  is_active: true,
  created_by: 'ho',
  updated_by: 'ho',
};

const faq = {
  _id: '6c1f6d0e-5b7a-4a51-9a9a-2f1c3e8d7b10',
  category: 'payments',
  q: 'Is TDS deducted?',
  a: 'Yes.',
  q_key: 'is tds deducted?',
  order: 1,
  is_active: true,
  created_by: 'ho',
  updated_by: 'ho',
};

function setup() {
  const faqRepo = {
    listActive: jest.fn().mockResolvedValue({ sections: [], faqs: [] }),
    inSection: jest.fn().mockResolvedValue(false),
    create: jest.fn((row: object) => Promise.resolve(row)),
  };
  const sectionRepo = {
    list: jest.fn().mockResolvedValue([section]),
    find: jest.fn().mockResolvedValue(section),
    remove: jest.fn().mockResolvedValue(true),
  };
  const faqs = new FaqsService(
    faqRepo as unknown as FaqRepository,
    sectionRepo as unknown as FaqSectionRepository,
  );
  const sections = new FaqSectionsService(
    sectionRepo as unknown as FaqSectionRepository,
    faqs,
  );
  return { faqRepo, sectionRepo, faqs, sections };
}

const dto = { category: 'payments', q: ' Is TDS deducted? ', a: 'Yes.' };

describe('FaqsService.live (GET /faqs)', () => {
  it('answers in the app’s shape, whatever else the rows carry', async () => {
    const { faqs, faqRepo } = setup();
    faqRepo.listActive.mockResolvedValue({
      sections: [section, { ...section, _id: 'kyc', label: 'KYC' }],
      faqs: [faq],
    });
    expect(await faqs.live()).toEqual({
      sections: [{ key: 'payments', label: 'Payments', emoji: '💰' }],
      faqs: [
        {
          id: faq._id,
          category: 'payments',
          q: 'Is TDS deducted?',
          a: 'Yes.',
        },
      ],
    });
  });

  it('is one read of the merged collection, held for a minute', async () => {
    const { faqs, faqRepo, sectionRepo } = setup();
    await faqs.live();
    await faqs.live();
    expect(faqRepo.listActive).toHaveBeenCalledTimes(1);
    expect(sectionRepo.list).not.toHaveBeenCalled();
  });
});

describe('FaqsService.create', () => {
  it('refuses a section that does not exist', async () => {
    const { faqs, faqRepo, sectionRepo } = setup();
    sectionRepo.find.mockResolvedValue(null);
    await expect(faqs.create(dto, 'ho')).rejects.toMatchObject({
      response: { error: 'VALIDATION_FAILED' },
    });
    expect(faqRepo.create).not.toHaveBeenCalled();
  });

  it('stores the trimmed question and its key', async () => {
    const { faqs, faqRepo } = setup();
    await faqs.create(dto, 'ho');
    expect(faqRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'Is TDS deducted?',
        q_key: 'is tds deducted?',
      }),
    );
  });

  it('gives a FAQ an id no section key can be', async () => {
    const { faqs, faqRepo } = setup();
    await faqs.create(dto, 'ho');
    const [[row]] = faqRepo.create.mock.calls as [[{ _id: string }]];
    expect(row._id).toMatch(/-/);
  });
});

describe('FaqSectionsService.remove', () => {
  it('refuses a section that still has FAQs', async () => {
    const { sections, faqRepo, sectionRepo } = setup();
    faqRepo.inSection.mockResolvedValue(true);
    await expect(sections.remove('payments')).rejects.toMatchObject({
      response: { error: 'FAQ_SECTION_IN_USE' },
    });
    expect(faqRepo.inSection).toHaveBeenCalledWith('payments');
    expect(sectionRepo.remove).not.toHaveBeenCalled();
  });

  it('deletes an empty one', async () => {
    const { sections, sectionRepo } = setup();
    await expect(sections.remove('payments')).resolves.toEqual({
      deleted: true,
    });
    expect(sectionRepo.remove).toHaveBeenCalledWith('payments');
  });

  it('makes the app re-read after a section change', async () => {
    const { faqs, sections, faqRepo } = setup();
    await faqs.live();
    await faqs.live();
    expect(faqRepo.listActive).toHaveBeenCalledTimes(1);
    await sections.remove('payments');
    await faqs.live();
    expect(faqRepo.listActive).toHaveBeenCalledTimes(2);
  });
});
