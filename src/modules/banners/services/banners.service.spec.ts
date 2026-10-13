import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CohortsService } from '@modules/onboarding/services/cohorts.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import { UpdateBannerDto, type CreateBannerDto } from '../dto/banner.dto';
import type { BannerRepository } from '../repositories/banner.repository';
import type { Banner } from '../schemas/banner.schema';
import { BannersService } from './banners.service';

const en = (text: string) => ({ en: text });
const ID = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const IMG_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const IMAGE = `vistaar/banners/${IMG_ID}.png`;
const MISSING = 'vistaar/banners/00000000-0000-4000-8000-000000000000.png';

/** A PNG header that says width × height — all `imageInfo` reads. */
function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    _id: ID,
    title: en('Rabi Booking Open'),
    subtitle: en('Extra 3%'),
    cta: en('Book now'),
    image_path: null,
    image_url: null,
    image_width: null,
    image_height: null,
    link: '/products',
    tone: 'primary',
    emoji: '🌾',
    cohorts: [],
    starts_at: null,
    ends_at: null,
    order: 0,
    is_active: true,
    created_by: 'ho@katyayaniorganics.com',
    updated_by: 'ho@katyayaniorganics.com',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(
  rows: Banner[] = [],
  cohort: string | undefined = 'vistaar_agent',
) {
  const repo = {
    listActive: jest.fn().mockResolvedValue(rows),
    find: jest.fn().mockResolvedValue(rows[0] ?? null),
    create: jest.fn((row: Banner) => Promise.resolve({ ...row })),
    update: jest.fn((_: string, set: Partial<Banner>) =>
      Promise.resolve({ ...(rows[0] ?? banner()), ...set }),
    ),
    remove: jest.fn().mockResolvedValue(true),
    countByImage: jest.fn().mockResolvedValue(0),
    ids: jest.fn().mockResolvedValue(rows.map((r) => r._id)),
    reorder: jest.fn().mockResolvedValue(undefined),
  };
  const agents = {
    require: jest.fn().mockResolvedValue({ _id: 'ref-1', cohort }),
    cohortById: jest.fn().mockResolvedValue(cohort),
  };
  const cohorts = {
    require: jest.fn((key: string) =>
      key === 'nope'
        ? Promise.reject(new HttpException({ error: 'COHORT_NOT_FOUND' }, 400))
        : Promise.resolve({ _id: key }),
    ),
  };
  const storage = {
    savePublic: jest.fn((folder: string) =>
      Promise.resolve({
        path: `${folder}/${IMG_ID}.png`,
        url: 'https://cdn/x',
      }),
    ),
    publicFile: jest.fn((path: string) =>
      Promise.resolve(
        path === MISSING
          ? null
          : {
              url: `https://cdn/${path}`,
              extra: { width: '1200', height: '400' },
            },
      ),
    ),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BannersService(
    repo as unknown as BannerRepository,
    agents as unknown as AgentsService,
    cohorts as unknown as CohortsService,
    storage as unknown as StorageService,
  );
  return { service, repo, agents, cohorts, storage };
}

const createDto = (
  overrides: Partial<CreateBannerDto> = {},
): CreateBannerDto => ({
  title: en('Kisan Mela'),
  subtitle: en('12 Oct'),
  cta: en('Register'),
  link: '/events',
  ...overrides,
});

describe('BannersService.forPartner', () => {
  it("returns only the caller's cohort and every-partner banners, in the app's shape", async () => {
    const { service } = setup([
      banner({ _id: 'a', cohorts: [] }),
      banner({ _id: 'b', cohorts: ['consultant'] }),
      banner({ _id: 'c', cohorts: ['vistaar_agent'] }),
    ]);

    const views = await service.forPartner('ref-1');

    expect(views.map((v) => v.id)).toEqual(['a', 'c']);
    expect(Object.keys(views[0]).sort()).toEqual(
      [
        'cta',
        'emoji',
        'id',
        'image',
        'link',
        'subtitle',
        'title',
        'tone',
      ].sort(),
    );
    expect(views[0].image).toBeNull();
  });

  it('sends the art and its size for an image banner', async () => {
    const { service } = setup([
      banner({
        image_path: IMAGE,
        image_url: 'https://cdn/x',
        image_width: 1200,
        image_height: 400,
        subtitle: null,
        cta: null,
      }),
    ]);
    const [view] = await service.forPartner('ref-1');
    expect(view.image).toEqual({
      url: 'https://cdn/x',
      width: 1200,
      height: 400,
    });
  });

  it('hides scheduled banners that the cached read still holds', async () => {
    const { service } = setup([
      banner({ _id: 'later', starts_at: new Date(Date.now() + 3_600_000) }),
    ]);
    expect(await service.forPartner('ref-1')).toEqual([]);
  });

  it('caps the carousel at 10', async () => {
    const rows = Array.from({ length: 14 }, (_, i) => banner({ _id: `b${i}` }));
    const { service } = setup(rows);
    expect(await service.forPartner('ref-1')).toHaveLength(10);
  });

  it('reads the database once a minute, not once per partner', async () => {
    const { service, repo } = setup([banner()]);
    await service.forPartner('ref-1');
    await service.forPartner('ref-2');
    expect(repo.listActive).toHaveBeenCalledTimes(1);
  });

  it('re-reads after an HO change', async () => {
    const { service, repo } = setup([banner()]);
    await service.forPartner('ref-1');
    await service.update(ID, { order: 2 }, 'ho@x');
    await service.forPartner('ref-1');
    expect(repo.listActive).toHaveBeenCalledTimes(2);
  });
});

describe('BannersService.create', () => {
  it('fills defaults and de-duplicates cohorts', async () => {
    const { service, repo } = setup();
    const saved = await service.create(
      createDto({ cohorts: ['consultant', 'consultant'] }),
      'ho@x',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'primary',
        emoji: null,
        cohorts: ['consultant'],
        order: 0,
        is_active: true,
        created_by: 'ho@x',
      }),
    );
    expect(saved.status).toBe('live');
  });

  it('refuses a missing English text', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(createDto({ title: { hi: 'किसान मेला' } }), 'ho@x'),
    ).rejects.toThrow('Please enter the English title.');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses an end before the start', async () => {
    const { service } = setup();
    await expect(
      service.create(
        createDto({
          starts_at: '2026-10-20T00:00:00Z',
          ends_at: '2026-10-10T00:00:00Z',
        }),
        'ho@x',
      ),
    ).rejects.toThrow(/end date must be after the start date/);
  });

  it('refuses an unknown cohort', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(createDto({ cohorts: ['nope'] }), 'ho@x'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(repo.create).not.toHaveBeenCalled();
  });
});

describe('BannersService.update', () => {
  it('checks a new end against the stored start', async () => {
    const { service, repo } = setup([
      banner({ starts_at: new Date('2026-10-20T00:00:00Z') }),
    ]);
    await expect(
      service.update(ID, { ends_at: '2026-10-10T00:00:00Z' }, 'ho@x'),
    ).rejects.toThrow(/end date must be after the start date/);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('clears an end with null', async () => {
    const { service, repo } = setup([banner({ ends_at: new Date() })]);
    await service.update(ID, { ends_at: null }, 'ho@x');
    expect(repo.update).toHaveBeenCalledWith(
      ID,
      expect.objectContaining({ ends_at: null, updated_by: 'ho@x' }),
    );
  });

  it('switches a text banner off when the body holds only is_active', async () => {
    const { service, repo } = setup([banner()]);
    // What the ValidationPipe hands over: every DTO field, unsent ones undefined.
    const dto = plainToInstance(UpdateBannerDto, { is_active: false });
    await service.update(ID, dto, 'ho@x');
    const set = repo.update.mock.calls[0][1] as Record<string, unknown>;
    expect(set).toEqual({ is_active: false, updated_by: 'ho@x' });
  });

  it('answers 404 for an unknown banner', async () => {
    const { service } = setup([]);
    await expect(service.update(ID, { order: 1 }, 'ho@x')).rejects.toThrow(
      'This banner could not be found. It may have been deleted.',
    );
  });
});

describe('BannersService.uploadImage', () => {
  it('stores well-shaped art with its size from the bytes', async () => {
    const { service, storage } = setup();
    const uploaded = await service.uploadImage(png(1200, 500));
    expect(storage.savePublic).toHaveBeenCalledWith(
      'vistaar/banners',
      expect.any(Buffer),
      'image/png',
      { width: '1200', height: '500' },
    );
    expect(uploaded).toMatchObject({
      content_type: 'image/png',
      width: 1200,
      height: 500,
    });
  });

  it('refuses bytes that are not an image, whatever the name says', async () => {
    const { service, storage } = setup();
    await expect(
      service.uploadImage(Buffer.from('%PDF-1.7 not a picture')),
    ).rejects.toThrow(/JPG, PNG and WEBP/);
    expect(storage.savePublic).not.toHaveBeenCalled();
  });

  it.each([
    [400, 200, /at least 600 pixels wide/],
    [1080, 1080, /2\.4 times as wide/],
    [1200, 400, /2\.4 times as wide/],
  ])('refuses %i × %i art', async (w, h, message) => {
    const { service, storage } = setup();
    await expect(service.uploadImage(png(w, h))).rejects.toThrow(message);
    expect(storage.savePublic).not.toHaveBeenCalled();
  });
});

describe('BannersService image banners', () => {
  it('creates an image banner with only a title, link and image', async () => {
    const { service, repo } = setup();
    await service.create(
      {
        title: en('Diwali offer'),
        link: '/products',
        image: IMAGE,
      },
      'ho@x',
    );
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitle: null,
        cta: null,
        image_path: IMAGE,
        image_url: `https://cdn/${IMAGE}`,
        image_width: 1200,
        image_height: 400,
      }),
    );
  });

  it('needs a subtitle and button on a banner without an image', async () => {
    const { service, repo } = setup();
    await expect(
      service.create({ title: en('Kisan Mela'), link: '/events' }, 'ho@x'),
    ).rejects.toThrow('A banner without an image needs an English subtitle.');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses an image path that was never uploaded', async () => {
    const { service, repo } = setup();
    await expect(
      service.create(createDto({ image: MISSING }), 'ho@x'),
    ).rejects.toThrow(/image was not found/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses removing the image of a banner that has no text to fall back on', async () => {
    const { service, repo } = setup([
      banner({ image_path: IMAGE, subtitle: null, cta: null }),
    ]);
    await expect(service.update(ID, { image: null }, 'ho@x')).rejects.toThrow(
      /without an image/,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('deletes replaced art once no banner uses it', async () => {
    const { service, storage } = setup([banner({ image_path: MISSING })]);
    await service.update(ID, { image: IMAGE }, 'ho@x');
    expect(storage.remove).toHaveBeenCalledWith(MISSING);
  });

  it('keeps art another banner still uses', async () => {
    const { service, repo, storage } = setup([banner({ image_path: IMAGE })]);
    repo.countByImage.mockResolvedValue(1);
    await service.remove(ID);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('deletes the art with the banner', async () => {
    const { service, storage } = setup([banner({ image_path: IMAGE })]);
    await service.remove(ID);
    expect(storage.remove).toHaveBeenCalledWith(IMAGE);
  });
});

describe('BannersService.reorder', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';

  it('saves the whole carousel in the order sent', async () => {
    const { service, repo } = setup([banner({ _id: A }), banner({ _id: B })]);
    await expect(service.reorder([B, A], 'ho@x')).resolves.toEqual({
      ids: [B, A],
    });
    expect(repo.reorder).toHaveBeenCalledWith([B, A], 'ho@x');
  });

  it('refuses a list that misses a banner', async () => {
    const { service, repo } = setup([banner({ _id: A }), banner({ _id: B })]);
    await expect(service.reorder([A], 'ho@x')).rejects.toThrow(
      /changed on another screen/,
    );
    expect(repo.reorder).not.toHaveBeenCalled();
  });

  it('refuses a banner the book does not hold', async () => {
    const { service, repo } = setup([banner({ _id: A })]);
    await expect(service.reorder([B], 'ho@x')).rejects.toThrow(
      /changed on another screen/,
    );
    expect(repo.reorder).not.toHaveBeenCalled();
  });
});
