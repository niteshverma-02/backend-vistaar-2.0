import { apiId, fromStored, storedId, toStored } from './story-content.mapping';

const design = {
  _id: '6f1c2a4e-0000-4000-8000-000000000001',
  key: 'diwali_lights',
  order: 1,
};
const card = { _id: 'diwali_offer', base: 'product', order: 2 };

describe('story content ids', () => {
  it('puts the kind in front of the id the API shows', () => {
    expect(storedId('design', design._id)).toBe(`design:${design._id}`);
    expect(storedId('template', 'product')).toBe('template:product');
  });

  it('keeps one id apart per kind: the same key is two rows', () => {
    expect(storedId('festival', 'diwali')).not.toBe(
      storedId('template', 'diwali'),
    );
  });

  it("strips only the row's own kind", () => {
    expect(apiId('template', 'template:product')).toBe('product');
    expect(apiId('design', 'template:product')).toBe('template:product');
  });
});

describe('toStored / fromStored', () => {
  it('stores a design under its kind and gives back the same row', () => {
    const stored = toStored('design', design);
    expect(stored).toEqual({
      ...design,
      _id: `design:${design._id}`,
      kind: 'design',
    });
    expect(fromStored('design', stored)).toEqual(design);
  });

  it("stores a card's key from its id, and the API never sees it", () => {
    const stored = toStored('template', card);
    expect(stored).toEqual({
      ...card,
      _id: 'template:diwali_offer',
      kind: 'template',
      key: 'diwali_offer',
    });
    expect(fromStored('template', stored)).toEqual(card);
  });

  it('refuses a design, festival or sample with no key', () => {
    expect(() => toStored('festival', { _id: 'f1' })).toThrow(
      'festival f1 has no key',
    );
  });
});
