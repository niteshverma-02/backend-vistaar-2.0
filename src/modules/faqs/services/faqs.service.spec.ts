import type { FaqSectionRepository } from '../repositories/faq-section.repository';
import type { FaqRepository } from '../repositories/faq.repository';
import { FaqSectionsService } from './faq-sections.service';
import { FaqsService } from './faqs.service';

const section = {
  _id: 'payments',
  label: 'Payments',
  emoji: null,
  order: 1,
  is_active: true,
};

function setup() {
  const faqRepo = {
    listActive: jest.fn().mockResolvedValue([]),
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
});

describe('FaqSectionsService.remove', () => {
  it('refuses a section that still has FAQs', async () => {
    const { sections, faqRepo, sectionRepo } = setup();
    faqRepo.inSection.mockResolvedValue(true);
    await expect(sections.remove('payments')).rejects.toMatchObject({
      response: { error: 'FAQ_SECTION_IN_USE' },
    });
    expect(sectionRepo.remove).not.toHaveBeenCalled();
  });

  it('makes the app re-read after a section change', async () => {
    const { faqs, sections, sectionRepo } = setup();
    await faqs.live();
    await faqs.live();
    expect(sectionRepo.list).toHaveBeenCalledTimes(1);
    await sections.remove('payments');
    await faqs.live();
    expect(sectionRepo.list).toHaveBeenCalledTimes(2);
  });
});
