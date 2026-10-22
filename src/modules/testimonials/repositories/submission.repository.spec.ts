import { Types, mongo, type Connection } from 'mongoose';

import { reviewIdOf } from '../testimonials.domain';
import {
  SubmissionRepository,
  type NewSubmission,
} from './submission.repository';

const ID = '0b6e7c1e-2f7a-4c55-9a43-6b0f0e3f8a11';
const BY = 'ho@katyayaniorganics.com';

const fresh = (o: Partial<NewSubmission> = {}): NewSubmission => ({
  _id: ID,
  agent_id: 'VST-000123',
  partner_name: 'Asha',
  pii_id: 'PII-1',
  farmer_name: 'Ramu',
  farmer_contact: '+919155061725',
  village: 'Rampur',
  district: 'Indore',
  state: 'Madhya Pradesh',
  type: 'product',
  bulk: 'BK-48',
  family: null,
  product_name: 'HUMIC+FULVIC',
  crop: 'Wheat',
  kind: 'video',
  text: 'Yield went up',
  rating: 5,
  media_path: 'vistaar/testimonials/VST-000123/video/x.mp4',
  duration_sec: 40,
  testimonial_id: new Types.ObjectId(),
  gig_id: null,
  ...o,
});

function setup() {
  const collection = {
    insertOne: jest.fn().mockResolvedValue({}),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
  };
  const connection = { collection: jest.fn(() => collection) };
  return {
    collection,
    connection,
    repo: new SubmissionRepository(connection as unknown as Connection),
  };
}

const argsOf = (fn: jest.Mock): unknown[] =>
  (fn.mock.calls as unknown as unknown[][])[0];

describe('SubmissionRepository', () => {
  it('sends one in on product_reviews: hidden, no stars for the average, ours under vistaar', async () => {
    const { repo, collection, connection } = setup();
    await repo.insert(fresh());
    expect(connection.collection).toHaveBeenCalledWith('product_reviews');
    const [doc] = argsOf(collection.insertOne) as [Record<string, unknown>];
    expect(doc).toMatchObject({
      _id: new Types.ObjectId(reviewIdOf(ID)),
      source: 'vistaar',
      verified: false,
      deleted: false,
      rating: null,
      review: 'Yield went up',
      pii_id: 'PII-1',
      user: { contact: '+919155061725', name: 'Ramu' },
      __v: 0,
      vistaar: {
        id: ID,
        agent_id: 'VST-000123',
        rating: 5,
        crop: 'Wheat',
        status: 'submitted',
        views: 0,
      },
    });
  });

  it('answers false on a retried submit (same derived _id)', async () => {
    const { repo, collection } = setup();
    collection.insertOne.mockRejectedValue(
      new mongo.MongoServerError({ code: 11000, message: 'dup' }),
    );
    expect(await repo.insert(fresh())).toBe(false);
  });

  it('approving shows it on Stockship with the stars, from an allowed status only', async () => {
    const { repo, collection } = setup();
    await repo.transition(ID, ['submitted'], {
      status: 'approved',
      rating: 4,
      reason: null,
      decided_by: BY,
    });
    const [filter, update] = argsOf(collection.findOneAndUpdate) as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toMatchObject({
      _id: new Types.ObjectId(reviewIdOf(ID)),
      source: 'vistaar',
      'vistaar.status': { $in: ['submitted'] },
    });
    expect(update.$set).toMatchObject({
      verified: true,
      deleted: false,
      rating: 4,
      verified_by: BY,
      deleted_by: null,
      'vistaar.status': 'approved',
      'vistaar.reason': null,
    });
    expect(update.$set).not.toHaveProperty('vistaar.rating');
  });

  it('a rejection goes to the deleted tray without stars; a withdrawal wipes the words', async () => {
    const { repo, collection } = setup();
    await repo.transition(ID, ['submitted'], {
      status: 'rejected',
      reason: 'Too dark',
      decided_by: BY,
    });
    await repo.transition(ID, ['approved'], {
      status: 'removed',
      text: '',
      media_path: null,
      decided_by: BY,
    });
    const calls = collection.findOneAndUpdate.mock.calls as unknown as [
      unknown,
      { $set: Record<string, unknown> },
    ][];
    expect(calls[0][1].$set).toMatchObject({
      verified: false,
      deleted: true,
      rating: null,
      deleted_by: BY,
      'vistaar.reason': 'Too dark',
    });
    expect(calls[1][1].$set).toMatchObject({
      deleted: true,
      rating: null,
      review: '',
      'vistaar.media_path': null,
    });
  });
});
