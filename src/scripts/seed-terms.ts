/**
 * Vistaar's Privacy & Terms into the shared `terms_and_conditions`
 * collection, as the next `TOC-n` row (`profiles: ['vistaar']`, active).
 *
 *   node dist/scripts/seed-terms.js                  # dry run — writes nothing
 *   node dist/scripts/seed-terms.js --apply          # adds it
 *   … --replace                                      # add it even if one is active
 *   … --file <path.docx|pdf> --title "<title>"       # upload a ready document instead
 *
 * By default it writes the text in `terms-content.ts` (everything the app
 * shipped as built-in terms) through the editor's own path, so the portal
 * can open and edit it. `--file` uploads a finished document as is; that one
 * cannot be opened in the editor. Without `--replace` it is skipped when
 * Vistaar already has an active one — HO's version wins; with it, the new row
 * becomes active and the old one stays, switched off, as history.
 */
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { TermsService } from '../modules/terms/services/terms.service';
import { DOCX_MIME } from '../modules/terms/terms-docx';
import { StorageService } from '../modules/uploads/services/storage.service';
import { VISTAAR_TERMS } from './terms-content';

const MIME: Record<string, string> = {
  '.docx': DOCX_MIME,
  '.pdf': 'application/pdf',
};

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const replace = process.argv.includes('--replace');
  const file = arg('--file');
  const log = (line: string) => console.log(`[seed-terms] ${line}`);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const terms = app.get(TermsService);
  const storage = app.get(StorageService);

  try {
    const live = await terms.live().catch(() => null);
    if (live && !replace) {
      log(`skip — Vistaar already has ${live.toc_id} "${live.title}" active`);
      return;
    }
    if (live) log(`${live.toc_id} "${live.title}" will be switched off`);
    if (!storage.configured) throw new Error('FIREBASE_* is not set');

    const what = file
      ? `${file} as is`
      : `"${VISTAAR_TERMS.title}" (${VISTAAR_TERMS.sections.length} sections) as an editable document`;
    log(`${apply ? 'add' : 'would add'} ${what}`);
    if (!apply) {
      log('Dry run — nothing written. Re-run with --apply.');
      return;
    }

    let row;
    if (file) {
      const mime = MIME[extname(file).toLowerCase()];
      if (!mime) throw new Error(`${file}: only .docx or .pdf`);
      const { url } = await storage.savePublic('toc', readFileSync(file), mime);
      row = await terms.create({
        title: arg('--title') ?? VISTAAR_TERMS.title,
        link: url,
      });
    } else {
      row = await terms.compose(VISTAAR_TERMS);
    }
    log(`added ${row.toc_id} "${row.title}" → ${row.link}`);
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
