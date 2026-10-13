/**
 * The About Vistaar, About Katyayani and Contact Us text the app shipped as
 * seed data (about_program_page.dart, content_seed.dart `companyInfo`,
 * help_seed.dart `programmeRules` / `supportContacts` / `ticketCategories`),
 * into `vistaar_v2_info_pages` as version 1 of each page:
 *
 *   node dist/scripts/seed-info-pages.js            # dry run — writes nothing
 *   node dist/scripts/seed-info-pages.js --apply    # creates a page that does not exist yet
 *
 * Each page is checked by the portal's DTO and goes through the service. A page
 * that already exists is left alone — HO's text wins. The numbers and links
 * marked "to confirm" in the app are placeholders HO must replace before launch
 * (see PROD-CHECKLIST).
 */
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

import { AppModule } from '../app.module';
import { AboutCompanyContentDto } from '../modules/info-pages/dto/about-company.dto';
import { AboutProgramContentDto } from '../modules/info-pages/dto/about-program.dto';
import { ContactUsContentDto } from '../modules/info-pages/dto/contact-us.dto';
import type {
  InfoPageContent,
  InfoPageKey,
} from '../modules/info-pages/info-pages.domain';
import { InfoPagesService } from '../modules/info-pages/services/info-pages.service';
import { ABOUT_COMPANY, ABOUT_PROGRAM, CONTACT_US } from './info-pages-content';

const BY = 'seed:info-pages';

const PAGES: {
  [K in InfoPageKey]: {
    dto: ClassConstructor<object>;
    content: InfoPageContent[K];
  };
} = {
  about_program: { dto: AboutProgramContentDto, content: ABOUT_PROGRAM },
  about_company: { dto: AboutCompanyContentDto, content: ABOUT_COMPANY },
  contact_us: { dto: ContactUsContentDto, content: CONTACT_US },
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const log = (line: string) => console.log(`[seed-info-pages] ${line}`);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const pages = app.get(InfoPagesService);

  try {
    for (const page of Object.keys(PAGES) as InfoPageKey[]) {
      const { dto, content } = PAGES[page];
      const errors = await validate(plainToInstance(dto, content), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      if (errors.length) throw new Error(`${page}: ${String(errors[0])}`);
      const exists = await pages.get(page).then(
        () => true,
        (error: unknown) => {
          if (error instanceof HttpException && error.getStatus() === 404) {
            return false;
          }
          throw error;
        },
      );
      if (exists) {
        log(`skip ${page} — already saved`);
        continue;
      }
      log(`${apply ? 'create' : 'would create'} ${page} v1`);
      if (apply) await pages.create(page, content, BY);
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
