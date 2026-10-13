/**
 * The app's built-in FAQ sections (`faqCategoryLabels`) and FAQs
 * (`learn_seed.dart` + `faq_extras_seed.dart`), into `vistaar_v2_faq_sections`
 * and `vistaar_v2_faqs`, so the /faqs screen shows the same list once it reads
 * `GET /faqs`. Safe on any environment: a section key or question already
 * there is skipped.
 *
 *   node dist/scripts/seed-faqs.js            # dry run — writes nothing
 *   node dist/scripts/seed-faqs.js --apply    # adds the missing ones
 *
 * Runs through `FaqSectionsService` and `FaqsService`, so every row passes the same checks as one HO
 * adds in the portal.
 */
import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import type { CreateFaqDto } from '../modules/faqs/dto/faq.dto';
import type { CreateFaqSectionDto } from '../modules/faqs/dto/faq-section.dto';
import { FaqListQueryDto } from '../modules/faqs/dto/faq.dto';
import { questionKey } from '../modules/faqs/faqs.domain';
import { FaqSectionsService } from '../modules/faqs/services/faq-sections.service';
import { FaqsService } from '../modules/faqs/services/faqs.service';

const BY = 'seed:faqs';

const SECTIONS: CreateFaqSectionDto[] = [
  { key: 'program', label: 'Programme', emoji: '🤝', order: 1 },
  { key: 'orders', label: 'Orders', emoji: '📦', order: 2 },
  { key: 'payments', label: 'Payments', emoji: '💰', order: 3 },
  { key: 'kyc', label: 'KYC', emoji: '🪪', order: 4 },
  { key: 'app', label: 'App', emoji: '📱', order: 5 },
];

const FAQS: CreateFaqDto[] = [
  {
    category: 'program',
    q: 'Who can become a Vistaar partner?',
    a: 'Shop owners, ex-Katyayani employees, working professionals, agri consultants, progressive farmers, students, FPO staff and others. Everyone places orders and earns commission on delivered orders.',
  },
  {
    category: 'program',
    q: 'Do I earn for adding a new dealer or farmer?',
    a: 'No. Earnings come only from commission on orders that are delivered and not returned.',
  },
  {
    category: 'payments',
    q: 'When can I withdraw my commission?',
    a: 'Once it is Confirmed (7 days after delivery). Minimum withdrawal is ₹500. HO approves within 2 working days.',
  },
  {
    category: 'payments',
    q: 'Is TDS deducted?',
    a: 'Yes, TDS applies as per law on commission. Keep your PAN updated to avoid higher deduction.',
  },
  {
    category: 'kyc',
    q: 'Which documents do I need?',
    a: 'Aadhaar, PAN, bank proof and a selfie. Ex-employees, working professionals and consultants have one extra step.',
  },
  {
    category: 'orders',
    q: 'Can I order for my own shop?',
    a: 'Yes. Choose "Self / shop stock" at checkout.',
  },
  {
    category: 'orders',
    q: 'How do farmers become my customers?',
    a: 'Add them as a lead. A lead becomes your customer automatically when you place their first order. A farmer is linked to the first partner who orders for them.',
  },
  {
    category: 'app',
    q: 'Does the app work offline?',
    a: 'You can browse and add farmers offline; orders sync when you are back online.',
  },
  {
    category: 'payments',
    q: 'Can I earn from farmer meetings?',
    a: 'Yes. Pick a meeting gig posted by HO or your Prasar Officer under Gigs, check in with GPS at the venue, mark farmer attendance and upload photos. You are paid per completed meeting after HO verifies it (rates are draft). Adding dealers, farmers or leads on its own still earns nothing.',
  },
  {
    category: 'program',
    q: 'Where do I raise a complaint, and how fast is it answered?',
    a: 'Open Grievances and raise it against the order, payment or product. It goes to your Prasar agent, who must respond within 48 hours; unresolved cases are escalated to HO.',
  },
  {
    category: 'app',
    q: 'What is "KKD & App activity"?',
    a: "It shows your farmers' walk-ins and orders at Katyayani Krishi Kendra stores and their activity on the Katyayani farmer app (opens, carts, orders), so you know whom to follow up. Approved farmer testimonials also earn you coins.",
  },
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const log = (line: string) => console.log(`[seed-faqs] ${line}`);
  const faqs = app.get(FaqsService);
  const sections = app.get(FaqSectionsService);

  try {
    const haveSections = new Set((await sections.list()).map((s) => s._id));
    for (const section of SECTIONS) {
      if (haveSections.has(section.key)) {
        log(`skip section (exists): ${section.key}`);
        continue;
      }
      log(`section ${section.key}: ${section.label}`);
      if (apply) await sections.create(section, BY);
    }

    const page = await faqs.list(
      Object.assign(new FaqListQueryDto(), { limit: 200 }),
    );
    const have = new Set(page.items.map((f) => f.q_key));

    for (const [i, faq] of FAQS.entries()) {
      if (have.has(questionKey(faq.q))) {
        log(`skip (exists): ${faq.q}`);
        continue;
      }
      log(`${faq.category}: ${faq.q}`);
      // A dry run has not created the sections, so the FAQs cannot be checked against them.
      if (apply) await faqs.create({ ...faq, order: i + 1 }, BY);
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
