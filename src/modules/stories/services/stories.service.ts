import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { badRequest, notFound } from '@common/errors/api-error';
import { imageInfo } from '@common/utils/image-size.util';
import { istDate } from '@common/utils/ist-day.util';
import { TtlCache } from '@common/utils/ttl-cache';
import type { Env } from '@config/env.schema';
import { EventsService } from '@modules/events/services/events.service';
import {
  GigReadsService,
  type GigBrief,
} from '@modules/gigs/services/gig-reads.service';
import {
  MeetingsService,
  type MeetingView,
} from '@modules/meetings/services/meetings.service';
import { RewardsService } from '@modules/rewards/services/rewards.service';
import { TestimonialsService } from '@modules/testimonials/services/testimonials.service';
import { StorageService } from '@modules/uploads/services/storage.service';

import type { SaveStoryDto, UploadedStoryImageDto } from '../dto/story.dto';
import { StoryStatRepository } from '../repositories/story-stat.repository';
import { StoryRepository } from '../repositories/story.repository';
import type { Story } from '../schemas/story.schema';
import {
  MAX_SAVED_STORIES,
  RECEIPT_FRESH_MS,
  ownsImage,
  readReceipt,
  receiptStem,
  signatureOf,
  storyImageError,
  storyImageFolder,
  type ShareChannel,
  type StoryImageKind,
} from '../stories.domain';
import {
  StoryDesignsService,
  type PartnerDesignView,
} from './story-designs.service';
import {
  StoryTemplatesService,
  type PartnerTemplateView,
} from './story-templates.service';
import {
  StoryFestivalsService,
  type PartnerFestivalView,
} from './story-festivals.service';
import { StorySamplesService } from './story-samples.service';

const STORY_NOT_FOUND =
  'This story could not be found. It may have been deleted.';

/** What the app's "My stories" list and editor read. */
export interface StoryView {
  id: string;
  config: Pick<
    Story,
    | 'template'
    | 'lang'
    | 'theme'
    | 'fields'
    | 'show_whatsapp'
    | 'photo_mode'
    | 'card'
  >;
  selection: Story['selection'];
  /** Signed, valid one hour; `null` if signing failed — the app redraws from `config`. */
  image: {
    path: string;
    url: string | null;
    width: number | null;
    height: number | null;
  };
  photo: { path: string; url: string | null } | null;
  share_count: number;
  last_shared_at: Date | null;
  last_used_at: Date;
  created_at: Date;
}

/**
 * One farmer quote for the "Farmer story" template: a real approved
 * testimonial (`source: testimonial`) or one of HO's ready-made ones
 * (`source: sample`). Fields a source does not have are `null`.
 */
export interface FarmerStoryView {
  id: string;
  source: 'testimonial' | 'sample';
  name: string | null;
  quote: string;
  product: string | null;
  crop: string | null;
  village: string | null;
  district: string | null;
  stars: number | null;
  media: { media_type: string; media_url: string } | null;
}

/**
 * One choice in the Meeting template's picker: HO events, the partner's own
 * meetings and the HO-posted gigs they hold.
 */
export interface MeetingOptionView {
  /** `e:<event id>`, `m:<meeting id>` or `g:<gig id>` — the saved story's `selection.meeting_key`. */
  key: string;
  kind: 'event' | 'meeting' | 'gig';
  title: string;
  starts_at: Date;
  place: string;
  note: string | null;
  /** The partner holds a seat. */
  registered: boolean;
}

export interface StoryContentView {
  /** The "Choose a design" cards, strip order; empty = the app's bundled six. */
  templates: PartnerTemplateView[];
  /** The looks to pick from, picker order; the first is the default. */
  designs: PartnerDesignView[];
  festivals: PartnerFestivalView[];
  /** Real testimonials first, then HO's ready-made ones. */
  farmer_stories: FarmerStoryView[];
  /** Upcoming cohort events, the caller's own meetings and gigs, soonest first. */
  meetings: MeetingOptionView[];
}

/** A picker, not a feed: the newest approved quotes are plenty. */
const FARMER_STORIES_LIMIT = 50;
const CONTENT_TTL_MS = 60_000;
/** Short: the lists under it already cache for a minute each. */
const SHARED_TTL_MS = 15_000;

/**
 * The partner's own stories. Every call is keyed by the `VST-` id from the
 * token; images live in the partner's private folder and are only ever read
 * back through short-lived signed URLs.
 */
@Injectable()
export class StoriesService {
  /**
   * Every partner opens My Story; HO changes festivals and approves quotes a
   * few times a week. Each instance re-reads at most once a minute.
   */
  private readonly content = new TtlCache<FarmerStoryView[]>(CONTENT_TTL_MS, 1);
  private readonly shared = new TtlCache<Omit<StoryContentView, 'meetings'>>(
    SHARED_TTL_MS,
    1,
  );

  constructor(
    private readonly stories: StoryRepository,
    private readonly stats: StoryStatRepository,
    private readonly festivals: StoryFestivalsService,
    private readonly designs: StoryDesignsService,
    private readonly templates: StoryTemplatesService,
    private readonly samples: StorySamplesService,
    private readonly events: EventsService,
    private readonly meetings: MeetingsService,
    private readonly gigs: GigReadsService,
    private readonly testimonials: TestimonialsService,
    private readonly storage: StorageService,
    private readonly rewards: RewardsService,
    config: ConfigService<Env, true>,
  ) {
    this.receiptSecret = config.get('VISTAAR_JWT_SECRET', { infer: true });
  }

  /** Signs upload receipts (`receiptStem`); the payload is prefixed, so it never doubles as a token. */
  private readonly receiptSecret: string;

  /** The type and size come from the bytes, not from what the phone claims. */
  async uploadImage(
    agentId: string,
    kind: StoryImageKind,
    buffer: Buffer,
  ): Promise<UploadedStoryImageDto> {
    const info = imageInfo(buffer);
    if (!info) {
      throw badRequest(
        'FILE_TYPE_NOT_ALLOWED',
        'This file is not a supported image. Please choose a JPG, PNG or WEBP image.',
      );
    }
    const sizeError = storyImageError(kind, info.width, info.height);
    if (sizeError) {
      throw badRequest('IMAGE_SIZE_NOT_ALLOWED', sizeError, [sizeError]);
    }
    const folder = storyImageFolder(agentId);
    const stem = receiptStem(
      folder,
      randomUUID(),
      { kind, width: info.width, height: info.height, issuedAt: Date.now() },
      this.receiptSecret,
    );
    const path = await this.storage.savePrivate(
      folder,
      buffer,
      info.mime,
      { kind, width: String(info.width), height: String(info.height) },
      stem,
    );
    const url = (await this.storage.sign([path])).get(path) ?? null;
    return {
      path,
      url,
      content_type: info.mime,
      size: buffer.length,
      width: info.width,
      height: info.height,
    };
  }

  async list(agentId: string): Promise<StoryView[]> {
    return this.views(await this.stories.listMine(agentId, MAX_SAVED_STORIES));
  }

  async get(agentId: string, id: string): Promise<StoryView> {
    const [view] = await this.views([await this.requireMine(agentId, id)]);
    return view;
  }

  /**
   * Saves the story the partner just made — or, when it is one they already
   * have, brings that one to the top with the new image. With `channel` it is
   * also a share, counted in the same call. The list stays at 20: the oldest
   * drop off, files and all.
   */
  async save(agentId: string, dto: SaveStoryDto): Promise<StoryView> {
    const photo = dto.photo ?? null;
    const [render] = await Promise.all([
      this.requireUpload(agentId, dto.image, 'render'),
      photo ? this.requireUpload(agentId, photo, 'photo') : null,
    ]);

    const now = new Date();
    const signature = signatureOf(dto.config, photo);
    const previous = await this.stories.findBySignature(agentId, signature);
    const { story, created } = await this.stories.upsert(
      randomUUID(),
      agentId,
      signature,
      {
        template: dto.config.template,
        lang: dto.config.lang,
        theme: dto.config.theme,
        fields: { ...dto.config.fields },
        show_whatsapp: dto.config.show_whatsapp,
        photo_mode: dto.config.photo_mode,
        card: dto.config.card ?? null,
        selection: dto.selection ? { ...dto.selection } : null,
        image_path: dto.image,
        image_width: render.width,
        image_height: render.height,
        photo_path: photo,
      },
      now,
    );

    const date = istDate(now);
    const saved = dto.channel
      ? ((await this.stories.recordShare(agentId, story._id, now)) ?? story)
      : story;
    if (created || dto.channel) {
      await this.stats.bump(agentId, date, {
        saved: created,
        share: dto.channel
          ? { template: story.template, channel: dto.channel }
          : undefined,
      });
    }

    // A re-save keeps the newest render; the one it replaces is not used any more.
    if (previous && previous.image_path !== dto.image) {
      await this.dropFile(agentId, previous.image_path);
    }
    if (created) {
      await this.trim(agentId);
      // A brand-new story can earn (an edit or re-share of one never does).
      await this.rewards.storyCreated(
        agentId,
        story._id,
        signature,
        story.template,
      );
    }

    const [view] = await this.views([saved]);
    return view;
  }

  /** "Share again" on a saved story. */
  async share(
    agentId: string,
    id: string,
    channel: ShareChannel,
  ): Promise<StoryView> {
    const now = new Date();
    const story = await this.stories.recordShare(agentId, id, now);
    if (!story) throw notFound(STORY_NOT_FOUND);
    await this.stats.bump(agentId, istDate(now), {
      share: { template: story.template, channel },
    });
    const [view] = await this.views([story]);
    return view;
  }

  async remove(agentId: string, id: string): Promise<{ deleted: true }> {
    const story = await this.requireMine(agentId, id);
    if (!(await this.stories.remove(agentId, id))) {
      throw notFound(STORY_NOT_FOUND);
    }
    await this.dropFiles(agentId, [story]);
    return { deleted: true };
  }

  /**
   * What the templates pre-fill from — every list HO-managed or approved.
   * Everything but `meetings` is the same for every partner, so it is built
   * once and shared; only the partner's events and meetings are read per call.
   */
  async contentFor(agentId: string): Promise<StoryContentView> {
    const now = new Date();
    const [shared, events, meetings, gigs] = await Promise.all([
      this.sharedContent(),
      this.events.upcoming(agentId),
      // The picker still works on events alone if meetings or gigs cannot be read.
      this.meetings.upcoming(agentId, now).catch((): MeetingView[] => []),
      this.gigs.upcoming(agentId, now).catch((): GigBrief[] => []),
    ]);
    const options: MeetingOptionView[] = [
      ...events.map((e) => ({
        key: `e:${e.id}`,
        kind: 'event' as const,
        title: e.title,
        starts_at: e.starts_at,
        place: e.location,
        note: e.note,
        registered: e.registered,
      })),
      ...meetings.map((m) => ({
        key: `m:${m.id}`,
        kind: 'meeting' as const,
        title: m.title,
        starts_at: m.starts_at,
        place: m.venue ?? m.village,
        note: m.agenda,
        registered: true,
      })),
      ...gigs.map((g) => ({
        key: `g:${g.id}`,
        kind: 'gig' as const,
        title: g.title,
        starts_at: g.starts_at,
        place: g.venue ?? g.village,
        note: null,
        registered: true,
      })),
    ];
    options.sort((a, b) => a.starts_at.getTime() - b.starts_at.getTime());
    return { ...shared, meetings: options };
  }

  /** Rebuilt at most every 15 s from the lists' own caches. */
  private sharedContent(): Promise<Omit<StoryContentView, 'meetings'>> {
    return this.shared.get('shared', () => this.buildShared());
  }

  private async buildShared(): Promise<Omit<StoryContentView, 'meetings'>> {
    const [templates, designs, festivals, real, samples] = await Promise.all([
      this.templates.live(),
      this.designs.live(),
      this.festivals.live(),
      this.farmerStories(),
      this.samples.live(),
    ]);
    return {
      templates,
      designs,
      festivals,
      farmer_stories: [
        ...real,
        ...samples.map((s): FarmerStoryView => ({
          id: s.key,
          source: 'sample',
          name: s.name,
          quote: s.quote,
          product: s.product,
          crop: s.crop,
          village: s.village,
          district: s.district,
          stars: s.stars,
          media: null,
        })),
      ],
    };
  }

  /** Signs every image of the page in one go. */
  async views(rows: Story[]): Promise<StoryView[]> {
    const urls = await this.storage.sign(
      rows.flatMap((s) =>
        s.photo_path ? [s.image_path, s.photo_path] : [s.image_path],
      ),
    );
    return rows.map((s) => toView(s, urls));
  }

  private farmerStories(): Promise<FarmerStoryView[]> {
    return this.content.get('farmer', () => this.loadFarmerStories());
  }

  private async loadFarmerStories(): Promise<FarmerStoryView[]> {
    return (await this.testimonials.forStories(FARMER_STORIES_LIMIT)).map(
      (t): FarmerStoryView => ({
        id: t.id,
        source: 'testimonial',
        name: t.name,
        quote: t.quote,
        product: t.product,
        crop: t.crop,
        village: t.village,
        district: t.district,
        stars: t.stars,
        media: t.media,
      }),
    );
  }

  private async requireMine(agentId: string, id: string): Promise<Story> {
    const story = await this.stories.findMine(agentId, id);
    if (!story) throw notFound(STORY_NOT_FOUND);
    return story;
  }

  /**
   * The path must be in the caller's own folder, uploaded as this kind — a
   * photo cannot stand in for the finished image.
   */
  private async requireUpload(
    agentId: string,
    path: string,
    kind: StoryImageKind,
  ): Promise<{ width: number | null; height: number | null }> {
    if (!ownsImage(agentId, path)) throw imageNotFound(kind);
    // A fresh upload's own receipt is proof enough — no bucket round trip.
    const receipt = readReceipt(path, this.receiptSecret);
    if (
      receipt &&
      receipt.kind === kind &&
      Date.now() - receipt.issuedAt < RECEIPT_FRESH_MS
    ) {
      return { width: receipt.width, height: receipt.height };
    }
    const extra = await this.storage.privateFile(path);
    if (!extra || extra.kind !== kind) throw imageNotFound(kind);
    return {
      width: Number(extra.width) || null,
      height: Number(extra.height) || null,
    };
  }

  /** Keeps the newest `MAX_SAVED_STORIES`; the rest go with their files. */
  private async trim(agentId: string): Promise<void> {
    const extra = await this.stories.beyond(agentId, MAX_SAVED_STORIES);
    if (extra.length === 0) return;
    await this.stories.removeMany(
      agentId,
      extra.map((s) => s._id),
    );
    await this.dropFiles(agentId, extra);
  }

  async dropFiles(agentId: string, removed: Story[]): Promise<void> {
    const paths = new Set(
      removed.flatMap((s) =>
        s.photo_path ? [s.image_path, s.photo_path] : [s.image_path],
      ),
    );
    await Promise.all([...paths].map((path) => this.dropFile(agentId, path)));
  }

  /** One photo can back several stories, so its file goes only with the last one. */
  private async dropFile(agentId: string, path: string): Promise<void> {
    if ((await this.stories.countUsing(agentId, path)) > 0) return;
    await this.storage.remove(path);
  }
}

function toView(s: Story, urls: Map<string, string>): StoryView {
  return {
    id: s._id,
    config: {
      template: s.template,
      lang: s.lang,
      theme: s.theme,
      fields: s.fields,
      show_whatsapp: s.show_whatsapp,
      photo_mode: s.photo_mode,
      card: s.card ?? null,
    },
    selection: s.selection,
    image: {
      path: s.image_path,
      url: urls.get(s.image_path) ?? null,
      width: s.image_width,
      height: s.image_height,
    },
    photo: s.photo_path
      ? { path: s.photo_path, url: urls.get(s.photo_path) ?? null }
      : null,
    share_count: s.share_count,
    last_shared_at: s.last_shared_at,
    last_used_at: s.last_used_at,
    created_at: s.created_at,
  };
}

function imageNotFound(kind: StoryImageKind) {
  return badRequest(
    'IMAGE_NOT_FOUND',
    `The ${kind === 'render' ? 'story image' : 'photo'} was not found. Please upload it again.`,
  );
}
