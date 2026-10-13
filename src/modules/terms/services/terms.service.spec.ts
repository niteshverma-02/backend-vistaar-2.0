import { Types } from 'mongoose';

import type { StorageService } from '@modules/uploads/services/storage.service';

import type { TermsRepository } from '../repositories/terms.repository';
import { buildTermsDocx, readTermsText } from '../terms-docx';
import type { TermsAndConditions } from '../schemas/terms.schema';
import { TermsService } from './terms.service';

const row = (over: Partial<TermsAndConditions> = {}): TermsAndConditions => ({
  _id: new Types.ObjectId(),
  toc_id: 'TOC-4',
  title: 'Vistaar Partner T&C',
  link: 'https://storage.googleapis.com/x/Vistaar.docx',
  profiles: ['vistaar'],
  is_active: true,
  __v: 0,
  ...over,
});

function setup() {
  const repo = {
    live: jest.fn().mockResolvedValue(row()),
    find: jest.fn().mockResolvedValue(row()),
    lastTocNumber: jest.fn().mockResolvedValue(3),
    replaceDocument: jest.fn((id: string, _v: number, set: object) =>
      Promise.resolve(row({ toc_id: id, __v: 1, ...set })),
    ),
    insert: jest.fn((r: Partial<TermsAndConditions>) =>
      Promise.resolve(row(r)),
    ),
    update: jest.fn().mockResolvedValue(row()),
    deactivateOthers: jest.fn().mockResolvedValue(undefined),
    removeInactive: jest.fn().mockResolvedValue(true),
  };
  const storage = {
    pathOf: jest.fn().mockReturnValue('toc/a.docx'),
    read: jest.fn().mockResolvedValue(null),
    remove: jest.fn().mockResolvedValue(undefined),
    savePublic: jest
      .fn()
      .mockResolvedValue({ path: 'toc/b.docx', url: 'https://x/toc/b.docx' }),
  };
  const service = new TermsService(
    repo as unknown as TermsRepository,
    storage as unknown as StorageService,
  );
  return { repo, storage, service };
}

const dto = { title: ' Vistaar Partner T&C ', link: 'https://x/y.docx' };

describe('TermsService.create', () => {
  it('takes the next TOC number after every app’s rows', async () => {
    const { service, repo } = setup();
    await service.create(dto);
    expect(repo.insert).toHaveBeenCalledWith({
      toc_id: 'TOC-4',
      title: 'Vistaar Partner T&C',
      link: dto.link,
      is_active: true,
    });
  });

  it('tries the next number when another app took this one', async () => {
    const { service, repo } = setup();
    repo.insert.mockResolvedValueOnce(null as never);
    repo.lastTocNumber.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    const saved = await service.create(dto);
    expect(saved.toc_id).toBe('TOC-5');
  });

  it('gives up with TERMS_ID_UNAVAILABLE rather than looping', async () => {
    const { service, repo } = setup();
    repo.insert.mockResolvedValue(null as never);
    await expect(service.create(dto)).rejects.toMatchObject({
      response: { error: 'TERMS_ID_UNAVAILABLE' },
    });
  });

  it('switches the others off when the new one is active', async () => {
    const { service, repo } = setup();
    await service.create(dto);
    expect(repo.deactivateOthers).toHaveBeenCalledWith('TOC-4');
  });

  it('leaves the others alone for an inactive draft', async () => {
    const { service, repo } = setup();
    await service.create({ ...dto, is_active: false });
    expect(repo.deactivateOthers).not.toHaveBeenCalled();
  });
});

describe('TermsService.update', () => {
  it('switching one on switches the others off and refreshes the app', async () => {
    const { service, repo } = setup();
    await service.live();
    await service.update('TOC-2', { is_active: true });
    expect(repo.deactivateOthers).toHaveBeenCalledWith('TOC-2');
    await service.live();
    expect(repo.live).toHaveBeenCalledTimes(2);
  });
});

describe('TermsService.remove', () => {
  it('refuses the active version with TERMS_IN_USE', async () => {
    const { service, repo } = setup();
    repo.removeInactive.mockResolvedValue(false);
    await expect(service.remove('TOC-4')).rejects.toMatchObject({
      response: { error: 'TERMS_IN_USE' },
    });
  });

  it('is a 404 for a version that is not Vistaar’s or not there', async () => {
    const { service, repo } = setup();
    repo.removeInactive.mockResolvedValue(false);
    repo.find.mockResolvedValue(null);
    await expect(service.remove('TOC-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('TermsService.live', () => {
  it('is a 404 until HO adds one', async () => {
    const { service, repo } = setup();
    repo.live.mockResolvedValue(null);
    await expect(service.live()).rejects.toMatchObject({ status: 404 });
  });
});

const text = {
  title: 'Vistaar Privacy & Terms',
  intro: null,
  sections: [
    {
      heading: 'Rights',
      body: 'You can see your data.',
      points: ['One'],
      items: [],
    },
  ],
};

describe('TermsService.text', () => {
  it('reads the text back out of an editor-made document', async () => {
    const { service, storage } = setup();
    storage.read.mockResolvedValue(buildTermsDocx(text));
    await expect(service.text('TOC-4')).resolves.toEqual({
      toc_id: 'TOC-4',
      version: 0,
      text,
    });
  });

  it('is TERMS_NOT_EDITABLE for a document from elsewhere', async () => {
    const { service, storage } = setup();
    storage.pathOf.mockReturnValue(null);
    await expect(service.text('TOC-4')).rejects.toMatchObject({
      response: { error: 'TERMS_NOT_EDITABLE' },
    });
    expect(storage.read).not.toHaveBeenCalled();
  });
});

describe('TermsService.compose', () => {
  it('uploads a document carrying the trimmed text and adds it as the next version', async () => {
    const { service, storage, repo } = setup();
    await service.compose({
      ...text,
      title: ' Vistaar Privacy & Terms ',
      sections: [
        { heading: 'Rights ', body: '  ', points: [' One ', ' '], items: [] },
      ],
    });
    const [, file] = storage.savePublic.mock.calls[0] as [string, Buffer];
    expect(readTermsText(file)).toEqual({
      title: 'Vistaar Privacy & Terms',
      intro: null,
      sections: [{ heading: 'Rights', body: null, points: ['One'], items: [] }],
    });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        link: 'https://x/toc/b.docx',
        title: 'Vistaar Privacy & Terms',
      }),
    );
  });
});

describe('TermsService.rewrite', () => {
  it('keeps the same TOC-n: new document on that row, version up by one', async () => {
    const { service, repo } = setup();
    const saved = await service.rewrite('TOC-4', { ...text, version: 0 });
    expect(repo.insert).not.toHaveBeenCalled();
    expect(repo.replaceDocument).toHaveBeenCalledWith('TOC-4', 0, {
      title: 'Vistaar Privacy & Terms',
      link: 'https://x/toc/b.docx',
    });
    expect(saved.toc_id).toBe('TOC-4');
  });

  it('refuses an edit made on an older version, before uploading anything', async () => {
    const { service, repo, storage } = setup();
    repo.find.mockResolvedValue(row({ __v: 3 }));
    await expect(
      service.rewrite('TOC-4', { ...text, version: 2 }),
    ).rejects.toMatchObject({
      response: { error: 'VERSION_CONFLICT' },
    });
    expect(storage.savePublic).not.toHaveBeenCalled();
  });

  it('removes its upload when another save wins the race', async () => {
    const { service, repo, storage } = setup();
    storage.pathOf.mockReturnValue('toc/b.docx');
    repo.replaceDocument.mockResolvedValue(null as never);
    await expect(
      service.rewrite('TOC-4', { ...text, version: 0 }),
    ).rejects.toMatchObject({
      response: { error: 'VERSION_CONFLICT' },
    });
    expect(storage.remove).toHaveBeenCalledWith('toc/b.docx');
  });
});

describe('TermsService.live', () => {
  it('tells the app which version of the T&C it shows', async () => {
    const { service, repo } = setup();
    repo.live.mockResolvedValue(row({ __v: 2 }));
    await expect(service.live()).resolves.toMatchObject({
      toc_id: 'TOC-4',
      version: 3,
    });
  });
});
