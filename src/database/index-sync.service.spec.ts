import type { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';

import type { Env } from '@config/env.schema';

import { IndexSyncService } from './index-sync.service';

function setup(nodeEnv = 'development') {
  const models: Record<
    string,
    {
      collection: { name: string; createIndex: jest.Mock };
      diffIndexes: jest.Mock;
    }
  > = {
    Reward: {
      collection: {
        name: 'vistaar_v2_rewards',
        createIndex: jest.fn().mockResolvedValue('key_1'),
      },
      diffIndexes: jest.fn().mockResolvedValue({
        toCreate: [[{ key: 1 }, { unique: true, _autoIndex: true }]],
        toDrop: [],
      }),
    },
    Shared: {
      collection: { name: 'leads_v2', createIndex: jest.fn() },
      diffIndexes: jest.fn(),
    },
  };
  const connection = {
    modelNames: () => Object.keys(models),
    model: (name: string) => models[name],
    db: { admin: () => ({ command: jest.fn() }) },
  };
  const service = new IndexSyncService(
    connection as unknown as Connection,
    { get: () => nodeEnv } as unknown as ConfigService<Env, true>,
  );
  return { service, models };
}

describe('IndexSyncService', () => {
  it('sends each missing v2 index with the deadline and our tag', async () => {
    const { service, models } = setup();
    await service.onApplicationBootstrap();

    expect(models.Reward.diffIndexes).toHaveBeenCalledWith({
      indexOptionsToCreate: true,
    });
    // Without them Mongo never gives up and the tagged kill finds nothing.
    expect(models.Reward.collection.createIndex).toHaveBeenCalledWith(
      { key: 1 },
      {
        unique: true,
        maxTimeMS: 15_000,
        comment: 'vistaar-index-sync:vistaar_v2_rewards',
      },
    );
  });

  it('never touches a shared collection', async () => {
    const { service, models } = setup();
    await service.onApplicationBootstrap();
    expect(models.Shared.diffIndexes).not.toHaveBeenCalled();
    expect(models.Shared.collection.createIndex).not.toHaveBeenCalled();
  });

  it('builds nothing in production', async () => {
    const { service, models } = setup('production');
    await service.onApplicationBootstrap();
    expect(models.Reward.diffIndexes).not.toHaveBeenCalled();
  });
});
