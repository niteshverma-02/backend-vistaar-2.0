import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';

import { RecentSearchRepository } from '../repositories/recent-search.repository';

@Injectable()
export class RecentSearchService {
  constructor(private readonly repo: RecentSearchRepository) {}

  record(agentId: string, term: string): Promise<string[]> {
    const trimmed = term.trim();
    if (!trimmed) {
      throw badRequest('SEARCH_TERM_REQUIRED', 'Please enter a search term.');
    }
    return this.repo.record(agentId, trimmed);
  }

  list(agentId: string): Promise<string[]> {
    return this.repo.findMine(agentId);
  }

  clear(agentId: string): Promise<void> {
    return this.repo.clearMine(agentId);
  }
}
