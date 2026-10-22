/**
 * The content My Story's templates used from the app's seed data, into the
 * database so HO can edit it from the portal:
 *
 *   - 4 festival greetings  → `vistaar_v2_story_content`, kind `festival`  (story_content.dart)
 *   - 8 farmer stories       → `vistaar_v2_story_content`, kind `sample`    (sahayak_seed.dart `testimonialLibrary`)
 *   - 3 events               → `vistaar_v2_events`           (content_seed.dart `events`; the Meeting template)
 *   - 5 designs              → `vistaar_v2_story_content`, kind `design`    (story_themes.dart, + one art design for testing)
 *   - 6 template cards       → `vistaar_v2_story_content`, kind `template`  (story_content.dart `storyTemplates`, `storyStrings`, `customEmojis`)
 *
 *   node dist/scripts/seed-story-content.js            # dry run — writes nothing
 *   node dist/scripts/seed-story-content.js --apply    # adds what is missing, by key
 *   node dist/scripts/seed-story-content.js --remove   # dry run of deleting what this seed added
 *   node dist/scripts/seed-story-content.js --remove --apply
 *
 * Runs through the services, so every row passes the portal's checks. A key
 * that already exists is left alone — HO's version wins (events have no key,
 * so their title stands in). The farmer stories
 * are the prototype's sample quotes, not real customers: HO should replace
 * them with real ones before launch (see PROD-CHECKLIST).
 */
import { crc32, deflateSync } from 'node:zlib';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import {
  EventListQueryDto,
  type CreateEventDto,
} from '../modules/events/dto/event.dto';
import { AdminEventsService } from '../modules/events/services/admin-events.service';
import {
  StoryFestivalListQueryDto,
  type CreateStoryFestivalDto,
} from '../modules/stories/dto/story-festival.dto';
import {
  StorySampleListQueryDto,
  type CreateStorySampleDto,
} from '../modules/stories/dto/story-sample.dto';
import {
  StoryDesignListQueryDto,
  type CreateStoryDesignDto,
} from '../modules/stories/dto/story-design.dto';
import type { StoryTemplateRow } from '../modules/stories/schemas/story-template.schema';
import { StoryDesignsService } from '../modules/stories/services/story-designs.service';
import { StoryTemplatesService } from '../modules/stories/services/story-templates.service';
import { StoryFestivalsService } from '../modules/stories/services/story-festivals.service';
import { StorySamplesService } from '../modules/stories/services/story-samples.service';

const BY = 'seed:story-content';

/** Keys match the app's old `FestivalId` wire values, so saved selections still resolve. */
const FESTIVALS: CreateStoryFestivalDto[] = [
  {
    key: 'diwali',
    label: { en: 'Diwali', hi: 'दीपावली' },
    emoji: '🪔',
    text: {
      hi: {
        headline: 'दीपावली की हार्दिक शुभकामनाएँ',
        body: 'आपके घर और खेत में सुख, समृद्धि और भरपूर फसल हो।',
      },
      en: {
        headline: 'Happy Diwali',
        body: 'May your home and fields be full of joy, prosperity and a bumper harvest.',
      },
    },
    order: 1,
  },
  {
    key: 'chhath',
    label: { en: 'Chhath', hi: 'छठ' },
    emoji: '🌅',
    text: {
      hi: {
        headline: 'छठ पूजा की हार्दिक शुभकामनाएँ',
        body: 'छठी मैया आपके परिवार और फसल पर सदा कृपा बनाए रखें।',
      },
      en: {
        headline: 'Happy Chhath Puja',
        body: 'May Chhathi Maiya bless your family and your crops.',
      },
    },
    order: 2,
  },
  {
    key: 'sankranti',
    label: { en: 'Makar Sankranti', hi: 'मकर संक्रांति' },
    emoji: '🪁',
    text: {
      hi: {
        headline: 'मकर संक्रांति की शुभकामनाएँ',
        body: 'नई फसल, नई उमंग — आपका हर दिन तिल-गुड़ सा मीठा हो।',
      },
      en: {
        headline: 'Happy Makar Sankranti',
        body: 'New harvest, new hope — may every day be as sweet as til-gud.',
      },
    },
    order: 3,
  },
  {
    // No window: the picker always has at least this one.
    key: 'generic',
    label: { en: 'Any day', hi: 'कोई भी दिन' },
    emoji: '🌾',
    text: {
      hi: {
        headline: 'शुभकामनाएँ',
        body: 'आपकी मेहनत रंग लाए, हर फसल भरपूर हो।',
      },
      en: {
        headline: 'Best wishes',
        body: 'May your hard work pay off with a bumper crop every season.',
      },
    },
    order: 99,
  },
];

/** The prototype's testimonial library, in its order. */
const SAMPLES: CreateStorySampleDto[] = [
  {
    key: 'ramesh_yadav_wheat',
    name: 'Ramesh Yadav',
    village: 'Rampur',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    product: 'Humic + Fulvic Acid 98%',
    crop: 'Wheat',
    quote:
      'Roots were much stronger this season, got 2 quintal extra per acre.',
    stars: 5,
    order: 1,
  },
  {
    key: 'baldev_singh_paddy',
    name: 'Baldev Singh',
    village: 'Khanna',
    district: 'Ludhiana',
    state: 'Punjab',
    product: 'Zinc EDTA 12%',
    crop: 'Paddy',
    quote: 'Khaira gone in 10 days, crop stayed green till harvest.',
    stars: 5,
    order: 2,
  },
  {
    key: 'sushila_patidar_soybean',
    name: 'Sushila Patidar',
    village: 'Sanwer',
    district: 'Indore',
    state: 'Madhya Pradesh',
    product: 'Seaweed Extract Liquid',
    crop: 'Soybean',
    quote: 'More flowers and pods after two sprays, very happy.',
    stars: 5,
    order: 3,
  },
  {
    key: 'prakash_jadhav_grapes',
    name: 'Prakash Jadhav',
    village: 'Niphad',
    district: 'Nashik',
    state: 'Maharashtra',
    product: 'Copper Oxychloride 50% WP',
    crop: 'Grapes',
    quote: 'Downy mildew controlled before it spread.',
    stars: 4,
    order: 4,
  },
  {
    key: 'suresh_patel_tomato',
    name: 'Suresh Patel',
    village: 'Barabanki',
    district: 'Barabanki',
    state: 'Uttar Pradesh',
    product: 'Seaweed Extract Liquid',
    crop: 'Tomato',
    quote: 'Flower drop reduced after two sprays.',
    stars: 4,
    order: 5,
  },
  {
    key: 'hari_om_verma_cotton',
    name: 'Hari Om Verma',
    village: 'Bijnor',
    district: 'Lucknow',
    state: 'Uttar Pradesh',
    product: 'Neem Oil 10000 PPM',
    crop: 'Cotton',
    quote: 'Whitefly came down without harsh chemicals.',
    stars: 5,
    order: 6,
  },
  {
    key: 'laxmi_devi_potato',
    name: 'Laxmi Devi',
    village: 'Hajipur',
    district: 'Vaishali',
    state: 'Bihar',
    product: 'Trichoderma Viride',
    crop: 'Potato',
    quote: 'No wilt this year after soil treatment with Trichoderma.',
    stars: 5,
    order: 7,
  },
  {
    key: 'mahendra_meena_mustard',
    name: 'Mahendra Meena',
    village: 'Kotputli',
    district: 'Jaipur',
    state: 'Rajasthan',
    product: 'NPK 19:19:19',
    crop: 'Mustard',
    quote: 'Even growth across the field, better pod filling.',
    stars: 4,
    order: 8,
  },
];

/** The prototype's events, same dates; keyed by title for the seed only. */
const EVENTS: (CreateEventDto & { key: string })[] = [
  {
    key: 'Kisan Mela · Barabanki',
    title: 'Kisan Mela · Barabanki',
    type: 'kisan_mela',
    starts_at: '2026-10-12T10:00:00+05:30',
    location: 'Mandi Samiti ground, Barabanki',
    seats: 40,
  },
  {
    key: 'Rabi Protection Webinar',
    title: 'Rabi Protection Webinar',
    type: 'webinar',
    starts_at: '2026-10-05T16:00:00+05:30',
    location: 'Online (Google Meet)',
    seats: 500,
  },
  {
    key: 'Humic Acid Field Day',
    title: 'Humic Acid Field Day',
    type: 'field_day',
    starts_at: '2026-10-18T09:00:00+05:30',
    location: 'Ramesh Yadav farm, Rampur',
    seats: 25,
  },
];

/** One content kind: what is there, how to add one, how to delete one. */
/**
 * The app's four bundled colour themes, exactly (story_themes.dart; alpha as
 * the last byte), so HO can recolour them — plus one design with art, for
 * trying the art path on beta. Skip `diwali_lights` on production.
 */
type SeedDesign = CreateStoryDesignDto & { art?: [Rgb, Rgb] };
type Rgb = [number, number, number];

const DESIGNS: SeedDesign[] = [
  {
    key: 'green',
    label: { en: 'Katyayani green', hi: 'कात्यायनी हरा' },
    colors: {
      bg_from: '#1D5A26',
      bg_to: '#3F8F3A',
      text: '#FFFFFF',
      subtext: '#FFFFFFD1',
      accent: '#F6C945',
      accent_text: '#1D3A12',
      soft: '#FFFFFF29',
      deco: '#FFFFFF12',
      avatar: '#1D5A26',
    },
    order: 1,
  },
  {
    key: 'harvest',
    label: { en: 'Harvest yellow', hi: 'फ़सल पीला' },
    colors: {
      bg_from: '#F9D449',
      bg_to: '#F29A1F',
      text: '#2E2106',
      subtext: '#2E2106C7',
      accent: '#1D5A26',
      accent_text: '#FFFFFF',
      soft: '#FFFFFF61',
      deco: '#FFFFFF2E',
      avatar: '#1D5A26',
    },
    order: 2,
  },
  {
    key: 'earth',
    label: { en: 'Earth brown', hi: 'मिट्टी भूरा' },
    colors: {
      bg_from: '#4A2E16',
      bg_to: '#8A5A2C',
      text: '#FFF8EE',
      subtext: '#FFF8EECC',
      accent: '#F6C945',
      accent_text: '#3A2410',
      soft: '#FFFFFF24',
      deco: '#FFFFFF0F',
      avatar: '#4A2E16',
    },
    order: 3,
  },
  {
    key: 'sky',
    label: { en: 'Sky', hi: 'आसमानी' },
    colors: {
      bg_from: '#155A9C',
      bg_to: '#4FB0E6',
      text: '#FFFFFF',
      subtext: '#FFFFFFD9',
      accent: '#FFE066',
      accent_text: '#0F3657',
      soft: '#FFFFFF2E',
      deco: '#FFFFFF14',
      avatar: '#155A9C',
    },
    order: 4,
  },
  {
    key: 'diwali_lights',
    label: { en: 'Diwali lights', hi: 'दीवाली रोशनी' },
    colors: {
      bg_from: '#3B0A45',
      bg_to: '#B8401A',
      text: '#FFF4DC',
      accent: '#FFC93C',
      accent_text: '#3B0A45',
    },
    overlay: 0.2,
    templates: ['festival', 'custom'],
    order: 5,
    art: [
      [59, 10, 69],
      [184, 64, 26],
    ],
  },
];

/**
 * 1080 × 1920 PNG: a top-to-bottom fade with warm glows, so the art is
 * visibly not a plain gradient. Each row is filtered `Sub`, which keeps a
 * smooth image small.
 */
function designArt(from: Rgb, to: Rgb, width = 1080, height = 1920): Buffer {
  const glows = [
    { x: 220, y: 380, r: 260 },
    { x: 900, y: 760, r: 200 },
    { x: 300, y: 1300, r: 180 },
    { x: 860, y: 1650, r: 240 },
  ];
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const row = y * (1 + width * 3);
    raw[row] = 1; // Sub filter
    let prev: Rgb = [0, 0, 0];
    for (let x = 0; x < width; x++) {
      let glow = 0;
      for (const g of glows) {
        const d = Math.hypot(x - g.x, y - g.y) / g.r;
        if (d < 1) glow = Math.max(glow, (1 - d) ** 2 * 0.55);
      }
      const px: Rgb = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const base = from[c] + (to[c] - from[c]) * t;
        const lit = base + ([255, 214, 120][c] - base) * glow;
        px[c] = Math.round(lit);
        raw[row + 1 + x * 3 + c] = (px[c] - prev[c] + 256) & 0xff;
      }
      prev = px;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * The app's six cards with the words it prints on the story, exactly
 * (story_content.dart), then five suggested custom cards on their layouts —
 * examples of what HO can make; edit or delete them freely.
 */
const TEMPLATES: Omit<
  StoryTemplateRow,
  'created_at' | 'updated_at' | 'created_by' | 'updated_by'
>[] = [
  {
    _id: 'product',
    base: 'product',
    builtin: true,
    label: { en: 'Product offer', hi: 'प्रोडक्ट ऑफ़र' },
    hint: { en: 'Price vs MRP, % off', hi: 'कीमत, MRP और छूट' },
    texts: {
      en: { kicker: 'Special offer', cta: 'Order today' },
      hi: { kicker: 'ख़ास ऑफ़र', cta: 'आज ही ऑर्डर करें' },
    },
    emojis: [],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 1,
    is_active: true,
  },
  {
    _id: 'testimonial',
    base: 'testimonial',
    builtin: true,
    label: { en: 'Farmer story', hi: 'किसान की कहानी' },
    hint: { en: 'Real result from a farmer', hi: 'किसान का असली नतीजा' },
    texts: {
      en: { kicker: "Farmer's word", cta: 'Try it on your farm' },
      hi: { kicker: 'किसान की ज़ुबानी', cta: 'अपने खेत में भी आज़माएँ' },
    },
    emojis: [],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 2,
    is_active: true,
  },
  {
    _id: 'tip',
    base: 'tip',
    builtin: true,
    label: { en: 'Crop tip', hi: 'फसल सलाह' },
    hint: { en: 'Advice for this month', hi: 'इस महीने की सलाह' },
    texts: {
      en: { kicker: 'Crop tip of the day', cta: 'Call for free advice' },
      hi: { kicker: 'आज की फसल सलाह', cta: 'मुफ़्त सलाह के लिए संपर्क करें' },
    },
    emojis: [],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 3,
    is_active: true,
  },
  {
    _id: 'meeting',
    base: 'meeting',
    builtin: true,
    label: { en: 'Meeting invite', hi: 'बैठक का न्योता' },
    hint: { en: 'Date, time, place', hi: 'तारीख़, समय, जगह' },
    texts: {
      en: { kicker: 'Farmer meeting', cta: 'Do come' },
      hi: { kicker: 'किसान बैठक', cta: 'ज़रूर आएँ' },
    },
    emojis: [],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 4,
    is_active: true,
  },
  {
    _id: 'festival',
    base: 'festival',
    builtin: true,
    label: { en: 'Festival', hi: 'त्योहार' },
    hint: { en: 'Greeting for farmers', hi: 'किसानों को शुभकामना' },
    texts: {
      en: { kicker: 'Greetings', cta: '' },
      hi: { kicker: 'शुभकामनाएँ', cta: '' },
    },
    emojis: [],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 5,
    is_active: true,
  },
  {
    _id: 'custom',
    base: 'custom',
    builtin: true,
    label: { en: 'Custom text', hi: 'अपना संदेश' },
    hint: { en: 'Your own words', hi: 'आपके अपने शब्द' },
    texts: {
      en: { kicker: 'Update', cta: 'Contact me' },
      hi: { kicker: 'सूचना', cta: 'संपर्क करें' },
    },
    emojis: ['📢', '🌾', '🌱', '🚜', '💧', '🎉', '⭐', '🙏'],
    default_design: null,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 6,
    is_active: true,
  },
];

/** Example custom cards; a design missing on this database is left out. */
const SUGGESTED_CARDS: Omit<
  StoryTemplateRow,
  'created_at' | 'updated_at' | 'created_by' | 'updated_by'
>[] = [
  {
    _id: 'diwali_offer',
    base: 'product',
    builtin: false,
    label: { en: 'Diwali offer', hi: 'दिवाली ऑफ़र' },
    hint: { en: 'Festive price, Diwali look', hi: 'त्योहार की कीमत' },
    texts: {
      en: { kicker: 'Diwali dhamaka', cta: 'Order before Diwali' },
      hi: { kicker: 'दिवाली धमाका', cta: 'दिवाली से पहले ऑर्डर करें' },
    },
    fields: {},
    emojis: [],
    default_design: 'diwali_lights',
    suggested: true,
    starts_at: null,
    ends_at: null,
    order: 1,
    is_active: true,
  },
  {
    _id: 'rabi_sowing_tip',
    base: 'tip',
    builtin: false,
    label: { en: 'Rabi sowing tip', hi: 'रबी बुवाई सलाह' },
    hint: { en: 'Advice for the sowing season', hi: 'बुवाई के मौसम की सलाह' },
    texts: {
      en: {
        kicker: 'Rabi sowing advice',
        cta: 'Call me for a free soil check',
      },
      hi: {
        kicker: 'रबी बुवाई सलाह',
        cta: 'मुफ़्त मिट्टी जाँच के लिए कॉल करें',
      },
    },
    fields: {},
    emojis: [],
    default_design: 'earth',
    suggested: true,
    starts_at: null,
    ends_at: null,
    order: 2,
    is_active: true,
  },
  {
    _id: 'kisan_mela_invite',
    base: 'meeting',
    builtin: false,
    label: { en: 'Kisan Mela invite', hi: 'किसान मेला न्योता' },
    hint: { en: 'Bring the whole village', hi: 'पूरे गाँव को बुलाएँ' },
    texts: {
      en: { kicker: 'Kisan Mela', cta: 'Bring your neighbours too' },
      hi: { kicker: 'किसान मेला', cta: 'पड़ोसियों को भी साथ लाएँ' },
    },
    fields: {},
    emojis: [],
    default_design: 'harvest',
    suggested: true,
    starts_at: null,
    ends_at: null,
    order: 3,
    is_active: true,
  },
  {
    _id: 'new_stock',
    base: 'custom',
    builtin: false,
    label: { en: 'New stock arrived', hi: 'नया स्टॉक आया' },
    hint: { en: 'Tell farmers what is in', hi: 'किसानों को बताएँ क्या आया' },
    texts: {
      en: { kicker: 'In stock now', cta: 'Call to book yours' },
      hi: { kicker: 'स्टॉक में उपलब्ध', cta: 'बुकिंग के लिए कॉल करें' },
    },
    fields: {
      en: {
        emoji: '📦',
        headline: 'New stock arrived!',
        body: 'Fresh stock of Katyayani products is here. Limited quantity — book yours today.',
      },
      hi: {
        emoji: '📦',
        headline: 'नया स्टॉक आ गया!',
        body: 'कात्यायनी के उत्पादों का नया स्टॉक आ गया है। सीमित मात्रा — आज ही बुक करें।',
      },
    },
    emojis: ['📦', '🚚', '🌾', '🌱', '💧', '⭐'],
    default_design: 'sky',
    suggested: true,
    starts_at: null,
    ends_at: null,
    order: 4,
    is_active: true,
  },
  {
    _id: 'thank_you_farmers',
    base: 'custom',
    builtin: false,
    label: { en: 'Thank you farmers', hi: 'किसानों का धन्यवाद' },
    hint: { en: 'Thank your customers', hi: 'अपने ग्राहकों को धन्यवाद' },
    texts: {
      en: { kicker: 'Thank you', cta: 'Always here to help' },
      hi: { kicker: 'धन्यवाद', cta: 'आपकी सेवा में हमेशा' },
    },
    fields: {
      en: {
        emoji: '🙏',
        headline: 'Thank you, farmer friends!',
        body: 'Your trust keeps us going. Here for every season, every crop.',
      },
      hi: {
        emoji: '🙏',
        headline: 'धन्यवाद, किसान साथियों!',
        body: 'आपका भरोसा ही हमारी ताक़त है। हर मौसम, हर फसल में आपके साथ।',
      },
    },
    emojis: ['🙏', '🌾', '❤️', '⭐'],
    default_design: 'green',
    suggested: false,
    starts_at: null,
    ends_at: null,
    order: 5,
    is_active: true,
  },
];

interface Kind<T extends { key: string }> {
  name: string;
  rows: T[];
  existing: () => Promise<{ key: string; id: string; created_by: string }[]>;
  create: (row: T) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[seed-story-content] ${line}`);
  const festivals = app.get(StoryFestivalsService);
  const samples = app.get(StorySamplesService);
  const events = app.get(AdminEventsService);
  const designs = app.get(StoryDesignsService);
  const templates = app.get(StoryTemplatesService);
  const all = <Q extends object>(query: Q): Q =>
    Object.assign(query, { limit: 200 });

  const kinds: Kind<{ key: string }>[] = [
    {
      name: 'design',
      rows: DESIGNS,
      existing: async () =>
        (await designs.list(all(new StoryDesignListQueryDto()))).items.map(
          (d) => ({ key: d.key, id: d._id, created_by: d.created_by }),
        ),
      create: async (row) => {
        const { art, ...dto } = row as SeedDesign;
        const image = art
          ? (await designs.uploadImage(designArt(art[0], art[1]))).path
          : undefined;
        return designs.create({ ...dto, image }, BY);
      },
      remove: (id) => designs.remove(id),
    },
    {
      name: 'festival',
      rows: FESTIVALS,
      existing: async () =>
        (await festivals.list(all(new StoryFestivalListQueryDto()))).items.map(
          (f) => ({ key: f.key, id: f._id, created_by: f.created_by }),
        ),
      create: (row) => festivals.create(row as CreateStoryFestivalDto, BY),
      remove: (id) => festivals.remove(id),
    },
    {
      name: 'farmer story',
      rows: SAMPLES,
      existing: async () =>
        (await samples.list(all(new StorySampleListQueryDto()))).items.map(
          (s) => ({ key: s.key, id: s._id, created_by: s.created_by }),
        ),
      create: (row) => samples.create(row as CreateStorySampleDto, BY),
      remove: (id) => samples.remove(id),
    },
    {
      name: 'event',
      rows: EVENTS,
      existing: async () =>
        (await events.list(all(new EventListQueryDto()))).items.map((e) => ({
          key: e.title,
          id: e._id,
          created_by: e.created_by,
        })),
      create: (row) => {
        const { key: _key, ...dto } = row as CreateEventDto & { key: string };
        return events.create(dto, BY);
      },
      remove: (id) => events.remove(id),
    },
  ];

  try {
    // Cards are added when missing (HO's edits win). --remove deletes the
    // example custom cards; the six built-in ones are never deleted.
    if (remove) {
      for (const card of SUGGESTED_CARDS) {
        const row = (await templates.list()).find(
          (t) => t.key === card._id && t.created_by === BY,
        );
        if (!row) continue;
        log(`${apply ? 'delete' : 'would delete'} card ${card._id}`);
        if (apply) await templates.remove(card._id);
      }
    } else {
      const have = new Set<string>((await templates.list()).map((t) => t.key));
      const cards = [];
      for (const card of SUGGESTED_CARDS) {
        const design = card.default_design;
        cards.push(
          design && !(await templates.designExists(design))
            ? { ...card, default_design: null }
            : card,
        );
      }
      for (const row of [...TEMPLATES, ...cards]) {
        if (have.has(row._id)) {
          log(`skip template ${row._id} — already there`);
          continue;
        }
        log(`${apply ? 'add' : 'would add'} template ${row._id}`);
      }
      if (apply) {
        await templates.seed(
          [...TEMPLATES, ...cards].map((t) => ({
            ...t,
            created_by: BY,
            updated_by: BY,
          })),
        );
      }
    }
    for (const kind of kinds) {
      const existing = await kind.existing();
      if (remove) {
        const ours = existing.filter((e) => e.created_by === BY);
        for (const e of ours) {
          log(`${apply ? 'delete' : 'would delete'} ${kind.name} ${e.key}`);
          if (apply) await kind.remove(e.id);
        }
        continue;
      }
      const keys = new Set(existing.map((e) => e.key));
      for (const row of kind.rows) {
        if (keys.has(row.key)) {
          log(`skip ${kind.name} ${row.key} — already there`);
          continue;
        }
        log(`${apply ? 'add' : 'would add'} ${kind.name} ${row.key}`);
        if (apply) await kind.create(row);
      }
    }
    log(apply ? 'Applied.' : 'Dry run — nothing written. Re-run with --apply.');
  } finally {
    await app.close();
  }
}

// The Mongo pool and Firebase app keep the event loop alive after close.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
