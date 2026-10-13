import { plainToInstance, type ClassConstructor } from 'class-transformer';
import { validate } from 'class-validator';

import { AboutCompanyContentDto } from '../modules/info-pages/dto/about-company.dto';
import { AboutProgramContentDto } from '../modules/info-pages/dto/about-program.dto';
import { ContactUsContentDto } from '../modules/info-pages/dto/contact-us.dto';
import { contentProblems } from '../modules/info-pages/info-pages.domain';
import { ABOUT_COMPANY, ABOUT_PROGRAM, CONTACT_US } from './info-pages-content';

const check = async (dto: ClassConstructor<object>, content: object) =>
  validate(plainToInstance(dto, content), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('info-page seed content', () => {
  it('passes the portal DTOs', async () => {
    expect(await check(AboutProgramContentDto, ABOUT_PROGRAM)).toEqual([]);
    expect(await check(AboutCompanyContentDto, ABOUT_COMPANY)).toEqual([]);
    expect(await check(ContactUsContentDto, CONTACT_US)).toEqual([]);
  });

  it('passes the page rules', () => {
    expect(contentProblems('about_program', ABOUT_PROGRAM)).toEqual([]);
    expect(contentProblems('contact_us', CONTACT_US)).toEqual([]);
  });
});
