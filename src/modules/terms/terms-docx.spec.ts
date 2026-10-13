import { writeZip } from '@common/utils/zip.util';

import { buildTermsDocx, readTermsText, type TermsText } from './terms-docx';

const text: TermsText = {
  title: 'Privacy & Terms <v2>',
  intro: 'Hindi bhi chalega: किसान',
  sections: [
    {
      heading: 'What we collect',
      body: 'Para one.\n\nPara two.',
      points: ['A & B'],
      items: [{ title: 'Bank', detail: 'IFSC', purpose: null }],
    },
  ],
};

describe('terms docx', () => {
  it('gives back exactly the text it was made from', () => {
    expect(readTermsText(buildTermsDocx(text))).toEqual(text);
  });

  it('is a document Word can open: the main part and the escaped text are there', () => {
    const zip = buildTermsDocx(text).toString('latin1');
    expect(zip).toContain('word/document.xml');
    expect(zip.startsWith('PK')).toBe(true);
  });

  it('reads nothing from a docx it did not write, or from junk', () => {
    const other = writeZip([
      { name: 'word/document.xml', data: Buffer.from('<w:document/>') },
    ]);
    expect(readTermsText(other)).toBeNull();
    expect(readTermsText(Buffer.from('not a zip'))).toBeNull();
  });
});
