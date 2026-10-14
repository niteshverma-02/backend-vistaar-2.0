import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { UpdateSettingsDto } from './settings.dto';

const parse = (body: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateSettingsDto, body);
  return { dto, errors: validateSync(dto) };
};

describe('UpdateSettingsDto — owners', () => {
  it('clears an owner from an emptied field or null', () => {
    for (const value of ['', '  ', null]) {
      const { dto, errors } = parse({ lead_owner_agent_id: value });
      expect(errors).toHaveLength(0);
      expect(dto.lead_owner_agent_id).toBeNull();
    }
    expect(
      parse({ default_owner_agent_id: '' }).dto.default_owner_agent_id,
    ).toBeNull();
  });

  it('still takes a staff id, and refuses anything else', () => {
    expect(parse({ lead_owner_agent_id: 'A0-2691' }).errors).toHaveLength(0);
    expect(
      parse({ lead_owner_agent_id: 'VST-000006' }).errors,
    ).not.toHaveLength(0);
  });
});
