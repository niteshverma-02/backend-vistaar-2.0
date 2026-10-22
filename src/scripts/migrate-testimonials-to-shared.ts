/**
 * One-off: partner testimonials leave `vistaar_v2_testimonials` (user's
 * decision, 2026-10-22). Each one becomes its `product_reviews` row — the
 * `_id` derived from its UUID, Stockship's fields as an approval would leave
 * them, everything else under `vistaar` — and an approved one's old review row
 * (a random `_id`) is deleted. Its `product_testimonials` row gets the
 * `vistaar` marker. Only `source: 'vistaar'` rows are written; running it
 * again changes nothing. Run it after the code that reads `product_reviews`
 * is deployed — the old code still reads `vistaar_v2_testimonials`.
 *
 *   node dist/scripts/migrate-testimonials-to-shared.js            # dry run — writes nothing
 *   node dist/scripts/migrate-testimonials-to-shared.js --apply    # moves them
 *
 * It does not drop `vistaar_v2_testimonials`; drop it once the counts agree.
 */
import mongoose, { Types } from 'mongoose';

import {
  VISTAAR_SOURCE,
  reviewIdOf,
  sharedFlagsOf,
  type SubmissionKind,
  type SubmissionStatus,
} from '../modules/testimonials/testimonials.domain';

interface OldRow {
  _id: string;
  agent_id: string;
  partner_name: string | null;
  pii_id: string;
  farmer_name: string;
  farmer_contact: string;
  village: string | null;
  district: string | null;
  state: string | null;
  type: 'product' | 'combo';
  bulk: string | null;
  family: string | null;
  product_name: string | null;
  crop: string;
  kind: SubmissionKind;
  text: string;
  rating: number;
  media_path: string | null;
  media_url: string | null;
  duration_sec: number | null;
  status: SubmissionStatus;
  reason: string | null;
  decided_by: string | null;
  decided_at: Date | null;
  approved_at: Date | null;
  review_id: Types.ObjectId;
  testimonial_id: Types.ObjectId | null;
  gig_id: string | null;
  views: number;
  shares: number;
  created_at: Date;
  updated_at: Date;
}

interface ReviewDoc {
  _id: Types.ObjectId;
  source: string;
  verified_by?: string | null;
  deleted_by?: string | null;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  const apply = process.argv.includes('--apply');
  const log = (line: string) =>
    console.log(`[migrate-testimonials-to-shared] ${line}`);

  // autoIndex / autoCreate off: this script never builds an index on the shared host.
  const conn = await mongoose
    .createConnection(process.env.MONGODB_URI ?? '', {
      dbName: process.env.MONGODB_DB_NAME,
      autoIndex: false,
      autoCreate: false,
    })
    .asPromise();
  try {
    const db = conn.db!;
    const reviews = db.collection<ReviewDoc>('product_reviews');
    const testimonials = db.collection('product_testimonials');
    const old = await db
      .collection<OldRow>('vistaar_v2_testimonials')
      .find()
      .toArray();
    log(`${old.length} to move${apply ? '' : ' (dry run)'}`);

    for (const r of old) {
      const newId = new Types.ObjectId(reviewIdOf(r._id));
      const before = await reviews.findOne({
        _id: r.review_id,
        source: VISTAAR_SOURCE,
      });
      const approved = r.status === 'approved';
      const doc = {
        source: VISTAAR_SOURCE,
        ...sharedFlagsOf(r.status),
        verified_by: approved
          ? (before?.verified_by ?? r.decided_by)
          : (before?.verified_by ?? null),
        deleted_by:
          r.status === 'rejected' || r.status === 'removed'
            ? (before?.deleted_by ?? r.decided_by)
            : null,
        rating: approved ? r.rating : null,
        review: r.text,
        images: [],
        pii_id: r.pii_id,
        user: {
          contact: r.farmer_contact,
          email: null,
          name: r.farmer_name,
          profile_image: null,
        },
        type: r.type,
        bulk: r.bulk,
        family: r.family,
        created_at: r.created_at,
        updated_at: r.updated_at,
        __v: 0,
        vistaar: {
          id: r._id,
          agent_id: r.agent_id,
          partner_name: r.partner_name,
          village: r.village,
          district: r.district,
          state: r.state,
          product_name: r.product_name,
          crop: r.crop,
          kind: r.kind,
          rating: r.rating,
          media_path: r.media_path,
          media_url: r.media_url,
          duration_sec: r.duration_sec,
          status: r.status,
          reason: r.reason,
          decided_by: r.decided_by,
          decided_at: r.decided_at,
          approved_at: r.approved_at,
          testimonial_id: r.testimonial_id,
          gig_id: r.gig_id,
          views: r.views,
          shares: r.shares,
        },
      };
      log(
        `${r._id} (${r.status}, ${r.kind}) → product_reviews ${newId.toHexString()}` +
          (before && !before._id.equals(newId)
            ? `, old review ${before._id.toHexString()} deleted`
            : '') +
          (r.testimonial_id
            ? `, product_testimonials ${r.testimonial_id.toHexString()} marked (if written)`
            : ''),
      );
      if (!apply) continue;

      await reviews.replaceOne({ _id: newId, source: VISTAAR_SOURCE }, doc, {
        upsert: true,
      });
      if (before && !before._id.equals(newId)) {
        await reviews.deleteOne({ _id: before._id, source: VISTAAR_SOURCE });
      }
      if (r.testimonial_id) {
        await testimonials.updateOne(
          { _id: r.testimonial_id, source: VISTAAR_SOURCE },
          { $set: { vistaar: { id: r._id, agent_id: r.agent_id } } },
        );
      }
    }

    const moved = await reviews.countDocuments({
      source: VISTAAR_SOURCE,
      'vistaar.id': { $type: 'string' },
    });
    log(`product_reviews now holds ${moved} partner testimonials`);
  } finally {
    await conn.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
