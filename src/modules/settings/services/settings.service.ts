import { Injectable } from '@nestjs/common';

import { badRequest } from '@common/errors/api-error';
import { AccessService } from '@modules/access/services/access.service';

import type { UpdateSettingsDto } from '../dto/settings.dto';
import {
  SettingsRepository,
  type SettingsRecord,
} from '../repositories/settings.repository';

const DEFAULTS: SettingsRecord = {
  default_owner_agent_id: null,
  conflict_radius_km: 5,
};
const CACHE_MS = 60_000;

@Injectable()
export class SettingsService {
  private cached: { at: number; value: SettingsRecord } | null = null;

  constructor(
    private readonly settings: SettingsRepository,
    private readonly access: AccessService,
  ) {}

  /** Read on every signup, so held for a minute rather than read each time. */
  async get(): Promise<SettingsRecord> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS)
      return this.cached.value;
    const value = { ...DEFAULTS, ...((await this.settings.read()) ?? {}) };
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(dto: UpdateSettingsDto, by: string): Promise<SettingsRecord> {
    if (dto.default_owner_agent_id) {
      const owner = (
        await this.access.staffByIds([dto.default_owner_agent_id])
      ).get(dto.default_owner_agent_id);
      if (!owner?.is_active) {
        throw badRequest(
          'OWNER_NOT_FOUND',
          'No active staff member was found with this ID. Please check the default owner.',
        );
      }
    }
    const saved = await this.settings.write({ ...dto, updated_by: by });
    this.cached = null;
    return { ...DEFAULTS, ...saved };
  }
}
