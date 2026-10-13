import { HttpException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { label, validationExceptionFactory } from './validation.factory';

class CropDto {
  @IsInt()
  @Min(0)
  area!: number;
}

class TitleDto {
  @IsString()
  @MaxLength(5)
  en!: string;
}

class FormDto {
  @IsNotEmpty()
  @IsString()
  shop_name!: string;

  @Matches(/^\d{4,6}$/, { message: 'Enter the 4 to 6 digit OTP.' })
  otp!: string;

  @IsIn(['kharif', 'rabi'])
  season!: string;

  @IsOptional()
  @ArrayMaxSize(1)
  @ValidateNested({ each: true })
  @Type(() => CropDto)
  crops?: CropDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => TitleDto)
  title?: TitleDto;
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: validationExceptionFactory,
});

async function detailsFor(body: object): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: FormDto });
  } catch (error) {
    const response = (error as HttpException).getResponse() as {
      error: string;
      message: string;
      details: string[];
    };
    expect(response.error).toBe('VALIDATION_FAILED');
    expect(response.message).toBe(
      'Some details are missing or not correct. Please check and try again.',
    );
    return response.details;
  }
  throw new Error('expected the body to fail validation');
}

const valid = { shop_name: 'Ram Krishi', otp: '1234', season: 'rabi' };

describe('validationExceptionFactory', () => {
  it('says what is missing, in words, without the code name', async () => {
    expect(await detailsFor({ ...valid, shop_name: '' })).toEqual([
      'Shop name is required.',
    ]);
  });

  it("keeps a DTO's own message as it is", async () => {
    expect(await detailsFor({ ...valid, otp: '12' })).toEqual([
      'Enter the 4 to 6 digit OTP.',
    ]);
  });

  it('lists the allowed choices', async () => {
    expect(await detailsFor({ ...valid, season: 'summer' })).toEqual([
      'Season must be one of: kharif, rabi.',
    ]);
  });

  it('names the row of a list that is wrong', async () => {
    expect(await detailsFor({ ...valid, crops: [{ area: -1 }] })).toEqual([
      'Area (crops, row 1) must be at least 0.',
    ]);
  });

  it('names the language of a translated text', async () => {
    expect(await detailsFor({ ...valid, title: { en: 'Too long' } })).toEqual([
      'Title (English) must be at most 5 characters.',
    ]);
  });

  it('refuses an unknown field without code words', async () => {
    expect(await detailsFor({ ...valid, agent_id: 'VST-1' })).toEqual([
      'Agent ID is not accepted here.',
    ]);
  });

  it('counts list items, not elements', async () => {
    expect(
      await detailsFor({ ...valid, crops: [{ area: 1 }, { area: 2 }] }),
    ).toEqual(['Crops can have at most 1 item.']);
  });
});

describe('label', () => {
  it.each([
    [['phone'], 'Phone'],
    [['raw_data', 'crops', '0', 'area'], 'Area (crops, row 1)'],
    [['sections', '2'], 'Sections (row 3)'],
    [['texts', 'hi'], 'Texts (Hindi)'],
    [['pii_id'], 'Customer ID'],
    [['q'], 'Question'],
  ])('%j → %s', (path, expected) => {
    expect(label(path)).toBe(expected);
  });
});
