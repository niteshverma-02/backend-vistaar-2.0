import type { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import type { EventsService } from '@modules/events/services/events.service';
import type { GigReadsService } from '@modules/gigs/services/gig-reads.service';
import type { MeetingsService } from '@modules/meetings/services/meetings.service';
import type { TestimonialsService } from '@modules/testimonials/services/testimonials.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { SaveStoryDto } from '../dto/story.dto';
import type { StoryStatRepository } from '../repositories/story-stat.repository';
import type { StoryRepository } from '../repositories/story.repository';
import type { Story } from '../schemas/story.schema';
import { receiptStem } from '../stories.domain';
import { StoriesService } from './stories.service';
import type { StoryDesignsService } from './story-designs.service';
import type { StoryFestivalsService } from './story-festivals.service';
import type { StoryTemplatesService } from './story-templates.service';
import type { StorySamplesService } from './story-samples.service';

const AGENT = 'VST-000001';
const SECRET = 'test-secret';
const RENDER = `vistaar/stories/${AGENT}/2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d.png`;
const PHOTO = `vistaar/stories/${AGENT}/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.jpg`;
const OLD_RENDER = `vistaar/stories/${AGENT}/00000000-0000-4000-8000-000000000000.png`;

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function dto(overrides: Partial<SaveStoryDto> = {}): SaveStoryDto {
  return {
    config: {
      template: 'product',
      lang: 'en',
      theme: 'green',
      fields: {
        emoji: '🌾',
        headline: 'Humic Acid',
        body: 'Stronger roots',
        detail1: '',
        detail2: 'Wheat',
        detail3: '1 kg',
        price: '499',
        mrp: '650',
        stars: 5,
      },
      show_whatsapp: true,
      photo_mode: 'inset',
    },
    selection: null,
    image: RENDER,
    photo: null,
    ...overrides,
  };
}

function story(overrides: Partial<Story> = {}): Story {
  const d = dto();
  return {
    _id: 'story-1',
    agent_id: AGENT,
    signature: 'sig',
    ...d.config,
    card: null,
    selection: null,
    image_path: RENDER,
    image_width: 1080,
    image_height: 1920,
    photo_path: null,
    share_count: 0,
    last_shared_at: null,
    last_used_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(
  opts: {
    files?: Record<string, Record<string, string>>;
    previous?: Story | null;
    created?: boolean;
    beyond?: Story[];
    using?: number;
    samples?: unknown[];
    testimonials?: unknown[];
    events?: unknown[];
    designs?: unknown[];
  } = {},
) {
  const files = opts.files ?? {
    [RENDER]: { kind: 'render', width: '1080', height: '1920' },
    [PHOTO]: { kind: 'photo', width: '1600', height: '1200' },
  };
  const repo = {
    findBySignature: jest.fn().mockResolvedValue(opts.previous ?? null),
    upsert: jest.fn((id: string) =>
      Promise.resolve({
        story: story({ _id: opts.created === false ? 'story-1' : id }),
        created: opts.created ?? true,
      }),
    ),
    recordShare: jest.fn((_: string, id: string) =>
      Promise.resolve(story({ _id: id, share_count: 1 })),
    ),
    beyond: jest.fn().mockResolvedValue(opts.beyond ?? []),
    removeMany: jest.fn().mockResolvedValue(undefined),
    findMine: jest.fn().mockResolvedValue(story()),
    remove: jest.fn().mockResolvedValue(true),
    countUsing: jest.fn().mockResolvedValue(opts.using ?? 0),
  };
  const stats = { bump: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    savePrivate: jest.fn().mockResolvedValue(RENDER),
    privateFile: jest.fn((path: string) =>
      Promise.resolve(files[path] ?? null),
    ),
    sign: jest.fn((paths: string[]) =>
      Promise.resolve(new Map(paths.map((p) => [p, `https://signed/${p}`]))),
    ),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StoriesService(
    repo as unknown as StoryRepository,
    stats as unknown as StoryStatRepository,
    {
      live: jest.fn().mockResolvedValue([]),
    } as unknown as StoryFestivalsService,
    {
      live: jest.fn().mockResolvedValue(opts.designs ?? []),
    } as unknown as StoryDesignsService,
    {
      live: jest.fn().mockResolvedValue([]),
    } as unknown as StoryTemplatesService,
    {
      live: jest.fn().mockResolvedValue(opts.samples ?? []),
    } as unknown as StorySamplesService,
    {
      upcoming: jest.fn().mockResolvedValue(opts.events ?? []),
    } as unknown as EventsService,
    {
      upcoming: jest.fn().mockResolvedValue([]),
    } as unknown as MeetingsService,
    {
      upcoming: jest.fn().mockResolvedValue([]),
    } as unknown as GigReadsService,
    {
      forStories: jest.fn().mockResolvedValue(opts.testimonials ?? []),
    } as unknown as TestimonialsService,
    storage as unknown as StorageService,
    { get: () => SECRET } as unknown as ConfigService<Env, true>,
  );
  return { service, repo, stats, storage };
}

/** The `error.code` a rejected call carries. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    return ((e as HttpException).getResponse() as { error: string }).error;
  }
  throw new Error('expected the call to fail');
}

describe('StoriesService.uploadImage', () => {
  it('stores a 9:16 render in the partner folder with its size', async () => {
    const { service, storage } = setup();
    const out = await service.uploadImage(AGENT, 'render', png(1080, 1920));
    expect(storage.savePrivate).toHaveBeenCalledWith(
      `vistaar/stories/${AGENT}`,
      expect.any(Buffer),
      'image/png',
      { kind: 'render', width: '1080', height: '1920' },
      expect.stringMatching(
        /^[0-9a-f-]{36}~r~1080x1920~[0-9a-z]+~[0-9a-f]{20}$/,
      ),
    );
    expect(out).toMatchObject({ path: RENDER, width: 1080, height: 1920 });
  });

  it('refuses a non-image and a square render', async () => {
    const { service } = setup();
    expect(
      await codeOf(service.uploadImage(AGENT, 'render', Buffer.from('hello'))),
    ).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(
      await codeOf(service.uploadImage(AGENT, 'render', png(1080, 1080))),
    ).toBe('IMAGE_SIZE_NOT_ALLOWED');
  });
});

describe('StoriesService.save', () => {
  it('saves a new story and counts it', async () => {
    const { service, stats, repo } = setup();
    const view = await service.save(AGENT, dto());
    expect(repo.upsert).toHaveBeenCalled();
    expect(stats.bump).toHaveBeenCalledWith(AGENT, expect.any(String), {
      kind: 'saved',
    });
    expect(view.image.url).toBe(`https://signed/${RENDER}`);
  });

  it('counts a share in the same call when a channel is sent', async () => {
    const { service, stats, repo } = setup();
    const view = await service.save(AGENT, dto({ channel: 'status' }));
    expect(repo.recordShare).toHaveBeenCalled();
    expect(stats.bump).toHaveBeenCalledWith(AGENT, expect.any(String), {
      kind: 'share',
      template: 'product',
      channel: 'status',
    });
    expect(view.share_count).toBe(1);
  });

  it("refuses an image outside the caller's folder", async () => {
    const { service, repo } = setup();
    const other = RENDER.replace(AGENT, 'VST-000002');
    expect(await codeOf(service.save(AGENT, dto({ image: other })))).toBe(
      'IMAGE_NOT_FOUND',
    );
    expect(repo.upsert).not.toHaveBeenCalled();
  });

  it('refuses a photo sent as the finished image', async () => {
    const { service } = setup();
    expect(await codeOf(service.save(AGENT, dto({ image: PHOTO })))).toBe(
      'IMAGE_NOT_FOUND',
    );
  });

  it('re-saving the same story keeps one row and drops the old render', async () => {
    const { service, stats, storage } = setup({
      previous: story({ image_path: OLD_RENDER }),
      created: false,
    });
    await service.save(AGENT, dto());
    expect(stats.bump).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalledWith(OLD_RENDER);
  });

  it('trims the list to 20 and drops files nothing else uses', async () => {
    const old = story({
      _id: 'old',
      image_path: OLD_RENDER,
      photo_path: PHOTO,
    });
    const { service, repo, storage } = setup({ beyond: [old] });
    await service.save(AGENT, dto());
    expect(repo.removeMany).toHaveBeenCalledWith(AGENT, ['old']);
    expect(storage.remove).toHaveBeenCalledWith(OLD_RENDER);
    expect(storage.remove).toHaveBeenCalledWith(PHOTO);
  });

  it('keeps a photo another story still uses', async () => {
    const old = story({
      _id: 'old',
      image_path: OLD_RENDER,
      photo_path: PHOTO,
    });
    const { service, storage } = setup({ beyond: [old], using: 1 });
    await service.save(AGENT, dto());
    expect(storage.remove).not.toHaveBeenCalled();
  });
});

describe('StoriesService.save upload receipts', () => {
  const folder = `vistaar/stories/${AGENT}`;
  const id = '2b1f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  const pathWith = (issuedAt: number, secret = SECRET) =>
    `${folder}/${receiptStem(folder, id, { kind: 'render', width: 1080, height: 1920, issuedAt }, secret)}.png`;

  it('trusts a fresh receipt without asking the bucket', async () => {
    const { service, storage } = setup();
    await service.save(AGENT, dto({ image: pathWith(Date.now()) }));
    expect(storage.privateFile).not.toHaveBeenCalled();
  });

  it('asks the bucket for a forged or stale receipt', async () => {
    const forged = setup({ files: {} });
    expect(
      await codeOf(
        forged.service.save(
          AGENT,
          dto({ image: pathWith(Date.now(), 'other') }),
        ),
      ),
    ).toBe('IMAGE_NOT_FOUND');
    expect(forged.storage.privateFile).toHaveBeenCalled();

    const stale = pathWith(Date.now() - 2 * 60 * 60 * 1000);
    const old = setup({
      files: { [stale]: { kind: 'render', width: '1080', height: '1920' } },
    });
    await old.service.save(AGENT, dto({ image: stale }));
    expect(old.storage.privateFile).toHaveBeenCalledWith(stale);
  });
});

describe('StoriesService.share / remove', () => {
  it('404s a story that is not the caller’s', async () => {
    const { service, repo } = setup();
    repo.recordShare.mockResolvedValueOnce(null as unknown as Story);
    expect(await codeOf(service.share(AGENT, 'x', 'status'))).toBe('NOT_FOUND');
    repo.findMine.mockResolvedValueOnce(null);
    expect(await codeOf(service.remove(AGENT, 'x'))).toBe('NOT_FOUND');
  });

  it('deletes the row and its image', async () => {
    const { service, storage } = setup();
    await expect(service.remove(AGENT, 'story-1')).resolves.toEqual({
      deleted: true,
    });
    expect(storage.remove).toHaveBeenCalledWith(RENDER);
  });
});

describe('StoriesService.contentFor', () => {
  it('lists real testimonials first, then HO samples, in one shape', async () => {
    const { service } = setup({
      testimonials: [
        {
          id: '665a2c3d4e5f6789abcdef12',
          name: 'Ramu',
          quote: 'Great',
          product: 'Neem Oil',
          media: { media_type: 'video', media_url: 'https://x' },
          created_at: new Date(),
        },
      ],
      samples: [
        {
          key: 'tl1',
          name: 'Ramesh Yadav',
          quote: 'Roots were stronger',
          product: 'Humic',
          crop: 'Wheat',
          village: 'Rampur',
          district: 'Lucknow',
          stars: 5,
        },
      ],
    });
    const { farmer_stories } = await service.contentFor(AGENT);
    expect(farmer_stories.map((f) => [f.source, f.id])).toEqual([
      ['testimonial', '665a2c3d4e5f6789abcdef12'],
      ['sample', 'tl1'],
    ]);
    expect(farmer_stories[1]).toMatchObject({ village: 'Rampur', media: null });
  });
});

describe('StoriesService.contentFor meetings', () => {
  it('offers upcoming events as meeting options keyed e:<id>', async () => {
    const at = new Date('2026-10-25T04:30:00Z');
    const { service } = setup({
      events: [
        {
          id: 'ev-1',
          title: 'Kisan Mela',
          starts_at: at,
          location: 'Mandi ground',
          note: null,
          registered: true,
        },
      ],
    });
    const { meetings } = await service.contentFor(AGENT);
    expect(meetings).toEqual([
      {
        key: 'e:ev-1',
        kind: 'event',
        title: 'Kisan Mela',
        starts_at: at,
        place: 'Mandi ground',
        note: null,
        registered: true,
      },
    ]);
  });
});

describe('StoriesService.contentFor designs', () => {
  it("passes HO's live designs through in picker order", async () => {
    const designs = [{ key: 'green' }, { key: 'diwali_lights' }];
    const { service } = setup({ designs });
    expect((await service.contentFor(AGENT)).designs).toEqual(designs);
  });
});
