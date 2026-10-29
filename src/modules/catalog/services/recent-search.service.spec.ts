import type { RecentSearchRepository } from '../repositories/recent-search.repository';
import { RecentSearchService } from './recent-search.service';

function fakeRepo() {
  return {
    record: jest.fn<Promise<string[]>, [string, string]>(),
    findMine: jest.fn<Promise<string[]>, [string]>(),
    clearMine: jest.fn<Promise<void>, [string]>(),
  };
}

const service = (repo: ReturnType<typeof fakeRepo>) =>
  new RecentSearchService(repo as unknown as RecentSearchRepository);

describe('RecentSearchService', () => {
  it('trims the term before recording it', async () => {
    const repo = fakeRepo();
    repo.record.mockResolvedValue(['urea']);

    await service(repo).record('VST-1', '  urea  ');

    expect(repo.record).toHaveBeenCalledWith('VST-1', 'urea');
  });

  it('rejects a blank term without reaching the repository', () => {
    const repo = fakeRepo();
    let caught: unknown;

    try {
      void service(repo).record('VST-1', '   ');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      response: { error: 'SEARCH_TERM_REQUIRED' },
    });
    expect(repo.record).not.toHaveBeenCalled();
  });

  it('lists the partner`s own terms', async () => {
    const repo = fakeRepo();
    repo.findMine.mockResolvedValue(['urea', 'dap']);

    await expect(service(repo).list('VST-1')).resolves.toEqual(['urea', 'dap']);
    expect(repo.findMine).toHaveBeenCalledWith('VST-1');
  });

  it('clears the partner`s own terms', async () => {
    const repo = fakeRepo();
    await service(repo).clear('VST-1');
    expect(repo.clearMine).toHaveBeenCalledWith('VST-1');
  });
});
