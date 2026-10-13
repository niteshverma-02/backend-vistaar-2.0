import type { HttpException } from '@nestjs/common';

import type { StoryTemplateRepository } from '../repositories/story-template.repository';
import type { StoryTemplateRow } from '../schemas/story-template.schema';
import type { StoryDesignsService } from './story-designs.service';
import { StoryTemplatesService } from './story-templates.service';

function row(overrides: Partial<StoryTemplateRow> = {}): StoryTemplateRow {
  return {
    _id: 'product',
    base: 'product',
    builtin: true,
    fields: {},
    suggested: false,
    starts_at: null,
    ends_at: null,
    label: { en: 'Product offer' },
    hint: { en: 'Price vs MRP' },
    texts: { en: { kicker: 'Special offer', cta: 'Order today' } },
    emojis: [],
    default_design: null,
    order: 1,
    is_active: true,
    created_by: 'seed',
    updated_by: 'seed',
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

function setup(
  opts: { rows?: StoryTemplateRow[]; active?: number; designs?: string[] } = {},
) {
  const rows = opts.rows ?? [
    row(),
    row({ _id: 'custom', base: 'custom', is_active: false }),
    row({ _id: 'diwali_offer', builtin: false, suggested: true }),
  ];
  const repo = {
    all: jest.fn().mockResolvedValue(rows),
    find: jest.fn((key: string) =>
      Promise.resolve(rows.find((r) => r._id === key) ?? null),
    ),
    update: jest.fn((key: string, set: Partial<StoryTemplateRow>) =>
      Promise.resolve({ ...rows.find((r) => r._id === key)!, ...set }),
    ),
    countActive: jest.fn().mockResolvedValue(opts.active ?? 2),
    create: jest.fn((r: StoryTemplateRow) => Promise.resolve(r)),
    remove: jest.fn().mockResolvedValue(true),
  };
  const designs = {
    exists: jest.fn((key: string) =>
      Promise.resolve((opts.designs ?? ['green']).includes(key)),
    ),
  };
  const service = new StoryTemplatesService(
    repo as unknown as StoryTemplateRepository,
    designs as unknown as StoryDesignsService,
  );
  return { service, repo };
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (e) {
    return ((e as HttpException).getResponse() as { error: string }).error;
  }
  throw new Error('expected the call to fail');
}

describe('StoryTemplatesService', () => {
  it('gives the app only shown cards; HO sees all of them', async () => {
    const { service } = setup();
    expect((await service.live()).map((t) => t.key)).toEqual([
      'product',
      'diwali_offer',
    ]);
    expect((await service.list()).map((t) => t.key)).toEqual([
      'product',
      'custom',
      'diwali_offer',
    ]);
  });

  it('404s a card that does not exist', async () => {
    const { service } = setup();
    expect(await codeOf(service.get('poster'))).toBe('NOT_FOUND');
  });

  it('makes a custom card on a layout, never under a built-in key', async () => {
    const { service, repo } = setup();
    const dto = {
      key: 'rabi_offer',
      base: 'product' as const,
      label: { en: 'Rabi offer' },
      hint: { en: 'Season price' },
      texts: { en: { kicker: 'Rabi special', cta: 'Book now' } },
      fields: { en: { headline: ' ', body: 'Book before 15 Nov' } },
      suggested: true,
    };
    const made = await service.create(dto, 'ho');
    expect(made).toMatchObject({
      key: 'rabi_offer',
      base: 'product',
      builtin: false,
      suggested: true,
      // An empty pre-fill means "the layout's default".
      fields: { en: { body: 'Book before 15 Nov' } },
    });
    expect(await codeOf(service.create({ ...dto, key: 'product' }, 'ho'))).toBe(
      'TEMPLATE_EXISTS',
    );
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('deletes a custom card but only hides a built-in one', async () => {
    const { service, repo } = setup();
    expect(await codeOf(service.remove('product'))).toBe('VALIDATION_FAILED');
    await expect(service.remove('diwali_offer')).resolves.toEqual({
      deleted: true,
    });
    expect(repo.remove).toHaveBeenCalledWith('diwali_offer');
  });

  it('refuses a design that does not exist and hiding the last card', async () => {
    const { service, repo } = setup({ active: 1 });
    expect(
      await codeOf(service.update('product', { default_design: 'neon' }, 'ho')),
    ).toBe('VALIDATION_FAILED');
    expect(
      await codeOf(service.update('product', { is_active: false }, 'ho')),
    ).toBe('VALIDATION_FAILED');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('saves trimmed words and de-duplicated icons', async () => {
    const { service, repo } = setup();
    await service.update(
      'product',
      {
        texts: { en: { kicker: ' Big sale ', cta: ' Buy ' } },
        emojis: ['🌾', ' 🌾', '🚜', ''],
        default_design: 'green',
      },
      'ho@katyayani',
    );
    expect(repo.update).toHaveBeenCalledWith('product', {
      texts: { en: { kicker: 'Big sale', cta: 'Buy' } },
      emojis: ['🌾', '🚜'],
      default_design: 'green',
      updated_by: 'ho@katyayani',
    });
  });
});
