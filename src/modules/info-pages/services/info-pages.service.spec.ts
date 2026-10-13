import type { CohortsService } from '@modules/onboarding/services/cohorts.service';

import type {
  AboutProgramContent,
  ContactUsContent,
} from '../info-pages.domain';
import type { InfoPageRepository } from '../repositories/info-page.repository';
import { InfoPagesService } from './info-pages.service';

const hours = {
  days: [1, 2, 3, 4, 5, 6],
  opens: '10:00',
  closes: '19:00',
  label: '',
};
const contact = { hours, ticket_reply_note: 'old' } as ContactUsContent;

const row = (content: unknown) => ({
  _id: 'contact_us',
  content,
  version: 2,
  updated_at: new Date(),
});

function setup() {
  const repo = {
    find: jest.fn().mockResolvedValue(row(contact)),
    create: jest.fn().mockResolvedValue(row(contact)),
    update: jest.fn().mockResolvedValue(row(contact)),
    remove: jest.fn().mockResolvedValue(true),
  };
  const cohorts = {
    require: jest.fn((key: string) =>
      key === 'ex_employee'
        ? Promise.resolve({})
        : Promise.reject(new Error('none')),
    ),
  };
  const service = new InfoPagesService(
    repo as unknown as InfoPageRepository,
    cohorts as unknown as CohortsService,
  );
  return { repo, cohorts, service };
}

const program = (cohort: string | null) =>
  ({
    lifecycle: { steps: [] },
    more: { items: [] },
    rules: { items: [{ text: 'A rule', cohort }] },
  }) as unknown as AboutProgramContent;

describe('InfoPagesService.create', () => {
  it('is INFO_PAGE_EXISTS when the page is already there', async () => {
    const { service, repo } = setup();
    repo.create.mockResolvedValue(null);
    await expect(
      service.create('contact_us', contact, 'ho'),
    ).rejects.toMatchObject({
      response: { error: 'INFO_PAGE_EXISTS' },
    });
  });

  it('refuses a rule for a cohort that does not exist', async () => {
    const { service, repo } = setup();
    await expect(
      service.create('about_program', program('alien'), 'ho'),
    ).rejects.toMatchObject({
      response: { error: 'VALIDATION_FAILED' },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts a rule for an existing cohort, switched off or not', async () => {
    const { service, cohorts } = setup();
    await service.create('about_program', program('ex_employee'), 'ho');
    expect(cohorts.require).toHaveBeenCalledWith('ex_employee', false);
  });
});

describe('InfoPagesService.update', () => {
  it('replaces only the parts sent', async () => {
    const { service, repo } = setup();
    await service.update(
      'contact_us',
      { ticket_reply_note: 'new', hours: undefined },
      2,
      'ho',
    );
    expect(repo.update).toHaveBeenCalledWith(
      'contact_us',
      { hours, ticket_reply_note: 'new' },
      2,
      'ho',
    );
  });

  it('checks the merged page, not just the patch', async () => {
    const { service, repo } = setup();
    await expect(
      service.update(
        'contact_us',
        { hours: { ...hours, closes: '09:00' } },
        2,
        'ho',
      ),
    ).rejects.toMatchObject({ response: { error: 'VALIDATION_FAILED' } });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('is a VERSION_CONFLICT when another save came first', async () => {
    const { service, repo } = setup();
    repo.update.mockResolvedValue(null);
    await expect(
      service.update('contact_us', {}, 1, 'ho'),
    ).rejects.toMatchObject({
      response: { error: 'VERSION_CONFLICT' },
    });
  });

  it('is a 404 for a page not created yet', async () => {
    const { service, repo } = setup();
    repo.find.mockResolvedValue(null);
    await expect(
      service.update('contact_us', {}, 1, 'ho'),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('makes the next app read fresh', async () => {
    const { service, repo } = setup();
    await service.live('contact_us');
    await service.live('contact_us');
    expect(repo.find).toHaveBeenCalledTimes(1);
    await service.update('contact_us', {}, 2, 'ho');
    await service.live('contact_us');
    // once for the update's read, once for the fresh app read
    expect(repo.find).toHaveBeenCalledTimes(3);
  });
});

describe('InfoPagesService.remove', () => {
  it('makes the app see the page gone', async () => {
    const { service, repo } = setup();
    await service.live('contact_us');
    await service.remove('contact_us');
    repo.find.mockResolvedValue(null);
    await expect(service.live('contact_us')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('is a 404 when there is nothing to delete', async () => {
    const { service, repo } = setup();
    repo.remove.mockResolvedValue(false);
    await expect(service.remove('contact_us')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('InfoPagesService.contactUs', () => {
  it('works out open_now per request, not from the cache', async () => {
    const { service } = setup();
    const open = await service.contactUs(new Date('2026-10-13T12:00:00+05:30'));
    const closed = await service.contactUs(
      new Date('2026-10-13T20:00:00+05:30'),
    );
    expect([open.open_now, closed.open_now]).toEqual([true, false]);
  });
});
