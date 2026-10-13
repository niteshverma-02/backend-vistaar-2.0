/**
 * Five test banners for the Home carousel, into `vistaar_v2_banners` (and two
 * generated images into `vistaar/banners/` in the org bucket). For beta and
 * local testing, never production.
 *
 *   node dist/scripts/seed-banners.js            # dry run — writes nothing
 *   node dist/scripts/seed-banners.js --apply    # adds them, once
 *   node dist/scripts/seed-banners.js --remove   # deletes them and their images
 *
 * Runs through `BannersService`, so every banner passes the same checks as one
 * HO adds in the portal. Its rows are the ones with `created_by` = this seed.
 */
import { deflateSync, crc32 } from 'node:zlib';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import {
  BannerListQueryDto,
  type CreateBannerDto,
} from '../modules/banners/dto/banner.dto';
import { BannersService } from '../modules/banners/services/banners.service';

const BY = 'seed:test-banners';
const DAY_MS = 24 * 60 * 60 * 1000;

type Rgb = [number, number, number];

interface SeedBanner {
  note: string;
  /** Set: an image banner drawn as a left-to-right gradient of these colours. */
  art?: { from: Rgb; to: Rgb };
  dto: Omit<CreateBannerDto, 'image'>;
}

function seedBanners(now: number): SeedBanner[] {
  return [
    {
      note: 'text · everyone · live',
      dto: {
        title: { en: 'Rabi Booking Open', hi: 'रबी बुकिंग शुरू' },
        subtitle: {
          en: 'Book humic acid & zinc before 15 Oct — extra 3% on orders above ₹10,000',
          hi: '15 अक्टूबर से पहले ह्यूमिक एसिड और ज़िंक बुक करें — ₹10,000 से ऊपर के ऑर्डर पर 3% अतिरिक्त',
        },
        cta: { en: 'Book now', hi: 'अभी बुक करें' },
        link: '/products',
        tone: 'primary',
        emoji: '🌾',
        order: 1,
      },
    },
    {
      note: 'text · vistaar_agent only · live until +7 days',
      dto: {
        title: { en: 'Kisan Mela · Barabanki', hi: 'किसान मेला · बाराबंकी' },
        subtitle: {
          en: '12 Oct · bring 10 farmers, get a stall',
          hi: '12 अक्टूबर · 10 किसान लाएँ, स्टॉल पाएँ',
        },
        cta: { en: 'Register', hi: 'रजिस्टर करें' },
        link: '/events',
        tone: 'warning',
        emoji: '🎪',
        cohorts: ['vistaar_agent'],
        ends_at: new Date(now + 7 * DAY_MS).toISOString(),
        order: 2,
      },
    },
    {
      note: 'text · everyone · scheduled (+3 days)',
      dto: {
        title: { en: 'New: Seaweed Extract', hi: 'नया: सीवीड एक्सट्रैक्ट' },
        subtitle: {
          en: 'Launch price ₹480 for 500 ml',
          hi: 'लॉन्च कीमत ₹480, 500 ml',
        },
        cta: { en: 'View', hi: 'देखें' },
        link: '/products',
        tone: 'success',
        emoji: '🌊',
        starts_at: new Date(now + 3 * DAY_MS).toISOString(),
        order: 3,
      },
    },
    {
      note: 'image · everyone · live',
      art: { from: [27, 94, 32], to: [104, 159, 56] },
      dto: {
        title: { en: 'Diwali offer', hi: 'दिवाली ऑफ़र' },
        link: '/products',
        order: 0,
      },
    },
    {
      note: 'image · consultant + ex_employee · live until +14 days',
      art: { from: [2, 119, 189], to: [0, 172, 193] },
      dto: {
        title: { en: 'Rabi Protection Webinar', hi: 'रबी सुरक्षा वेबिनार' },
        link: '/events',
        cohorts: ['consultant', 'ex_employee'],
        ends_at: new Date(now + 14 * DAY_MS).toISOString(),
        order: 4,
      },
    },
  ];
}

/** A 1200 × 500 (2.4:1) PNG fading `from` → `to` — real bytes the upload checks accept. */
function gradientPng(from: Rgb, to: Rgb, width = 1200, height = 500): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    const t = x / (width - 1);
    for (let c = 0; c < 3; c++) {
      row[1 + x * 3 + c] = Math.round(from[c] + (to[c] - from[c]) * t);
    }
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

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
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const remove = process.argv.includes('--remove');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[seed-banners] ${line}`);
  const banners = app.get(BannersService);

  try {
    const page = await banners.list(
      Object.assign(new BannerListQueryDto(), { limit: 200 }),
    );
    const ours = page.items.filter((b) => b.created_by === BY);

    if (remove) {
      for (const b of ours) {
        await banners.remove(b._id);
        log(`removed ${b._id} (${b.title.en})`);
      }
      log(ours.length ? 'Removed.' : 'No seed banners to remove.');
      return;
    }

    if (ours.length) {
      log(`${ours.length} seed banners already exist — nothing to do.`);
      log('Run with --remove first to start over.');
      return;
    }

    for (const seed of seedBanners(Date.now())) {
      log(`${seed.dto.title.en}: ${seed.note}`);
      if (!apply) continue;
      const image = seed.art
        ? (await banners.uploadImage(gradientPng(seed.art.from, seed.art.to)))
            .path
        : undefined;
      const saved = await banners.create({ ...seed.dto, image }, BY);
      log(`  → ${saved._id} [${saved.status}]`);
    }
    log(apply ? 'Applied.' : 'Dry run — nothing written. Re-run with --apply.');
  } finally {
    await app.close();
  }
}

// On a beta host whose index builds hang, the pool never drains and the
// process would sit there after the work is done.
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
