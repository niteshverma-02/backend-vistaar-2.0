import type { OfflineCrmSettingsRepository } from '../repositories/offline-crm-settings.repository';
import type {
  StaffAccountRepository,
  StaffRecord,
} from '../repositories/staff-account.repository';
import { AccessService } from './access.service';

const head = (
  agent_id: string,
  over: Partial<StaffRecord> = {},
): StaffRecord => ({
  ref: `ref-${agent_id}`,
  email: `${agent_id}@x.com`,
  agent_id,
  name: agent_id,
  user_role: 'USR-1037',
  is_active: true,
  phone: null,
  ...over,
});

describe('AccessService.offlineHead', () => {
  const setup = (picked: string | null, heads: StaffRecord[]) => {
    const staff = {
      findActiveByRole: jest.fn().mockResolvedValue(heads.slice(0, 2)),
      findByAgentIds: jest.fn((ids: string[]) =>
        Promise.resolve(heads.filter((h) => ids.includes(h.agent_id ?? ''))),
      ),
    } as unknown as StaffAccountRepository;
    const settings = {
      pickedLeadOwner: jest.fn().mockResolvedValue(picked),
    } as unknown as OfflineCrmSettingsRepository;
    return new AccessService(staff, settings);
  };

  it('takes the head head office picked when there are several', async () => {
    const service = setup('A0-2838', [head('A0-1005'), head('A0-2838')]);
    await expect(service.offlineHead()).resolves.toMatchObject({
      agent_id: 'A0-2838',
    });
  });

  it('takes the only head when none is picked', async () => {
    const service = setup(null, [head('A0-2838')]);
    await expect(service.offlineHead()).resolves.toMatchObject({
      agent_id: 'A0-2838',
    });
  });

  it('is null with several heads and no pick, or a pick that is no longer an active head', async () => {
    await expect(
      setup(null, [head('A0-1005'), head('A0-2838')]).offlineHead(),
    ).resolves.toBeNull();
    await expect(
      setup('A0-2838', [head('A0-2838', { is_active: false })]).offlineHead(),
    ).resolves.toBeNull();
    await expect(
      setup('A0-2838', [
        head('A0-2838', { user_role: 'USR-1012' }),
      ]).offlineHead(),
    ).resolves.toBeNull();
  });
});
