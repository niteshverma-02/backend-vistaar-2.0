import { liveSections, questionKey } from './faqs.domain';

describe('questionKey', () => {
  it('ignores case and surrounding space', () => {
    expect(questionKey('  Is TDS deducted? ')).toBe('is tds deducted?');
  });

  it('collapses inner whitespace, so a double space is not a new question', () => {
    expect(questionKey('Is  TDS\ndeducted?')).toBe(
      questionKey('Is TDS deducted?'),
    );
  });

  it('keeps different questions apart', () => {
    expect(questionKey('Is TDS deducted?')).not.toBe(
      questionKey('Is GST deducted?'),
    );
  });
});

describe('liveSections', () => {
  const sections = [{ _id: 'program' }, { _id: 'payments' }, { _id: 'kyc' }];

  it('hides FAQs whose section is switched off or deleted', () => {
    const faqs = [
      { id: 1, category: 'program' },
      { id: 2, category: 'orders' },
    ];
    expect(liveSections(sections, faqs).faqs).toEqual([
      { id: 1, category: 'program' },
    ]);
  });

  it('drops sections with no FAQ, keeping section order', () => {
    const faqs = [
      { category: 'kyc' },
      { category: 'program' },
      { category: 'kyc' },
    ];
    expect(liveSections(sections, faqs).sections).toEqual([
      { _id: 'program' },
      { _id: 'kyc' },
    ]);
  });

  it('shows nothing when there are no sections', () => {
    expect(liveSections([], [{ category: 'kyc' }])).toEqual({
      sections: [],
      faqs: [],
    });
  });
});
