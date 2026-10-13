import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ComposeTermsDto } from '../modules/terms/dto/terms.dto';
import { VISTAAR_TERMS } from './terms-content';

describe('Vistaar terms seed text', () => {
  it('passes the portal editor DTO', async () => {
    const errors = await validate(
      plainToInstance(ComposeTermsDto, VISTAAR_TERMS),
      {
        whitelist: true,
        forbidNonWhitelisted: true,
      },
    );
    expect(errors).toEqual([]);
  });
});
