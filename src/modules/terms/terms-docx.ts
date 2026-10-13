import { readZipEntry, writeZip } from '@common/utils/zip.util';

/**
 * The T&C as HO writes it in the portal, and the .docx made from it.
 *
 * The shared `terms_and_conditions` row holds only a title and a link, so the
 * editable text travels **inside the document**: a custom XML part carries it
 * as JSON, and opening a version in the editor reads it back from there. No
 * other store is needed. Someone editing the file in Word changes the visible
 * text but not that part — the portal's text is the source of a new version.
 */

export interface TermsTextItem {
  title: string;
  detail: string;
  purpose: string | null;
}

export interface TermsTextSection {
  heading: string;
  body: string | null;
  points: string[];
  items: TermsTextItem[];
}

export interface TermsText {
  title: string;
  intro: string | null;
  sections: TermsTextSection[];
}

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const TEXT_PART = 'customXml/item1.xml';
const TEXT_NS = 'urn:katyayani:vistaar:terms:v1';

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function para(
  text: string,
  opts: {
    bold?: boolean;
    size?: number;
    after?: number;
    indent?: boolean;
  } = {},
): string {
  const ppr = `<w:pPr><w:spacing w:after="${opts.after ?? 120}"/>${
    opts.indent ? '<w:ind w:left="360" w:hanging="360"/>' : ''
  }</w:pPr>`;
  const rpr =
    opts.bold || opts.size
      ? `<w:rPr>${opts.bold ? '<w:b/>' : ''}${
          opts.size ? `<w:sz w:val="${opts.size}"/>` : ''
        }</w:rPr>`
      : '';
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
}

function documentXml(t: TermsText): string {
  const body: string[] = [
    para(t.title, { bold: true, size: 36, after: 80 }),
    para('Katyayani Organics · Vistaar', { size: 18, after: 240 }),
  ];
  if (t.intro) body.push(para(t.intro, { after: 240 }));
  for (const s of t.sections) {
    body.push(para(s.heading, { bold: true, size: 28, after: 120 }));
    if (s.body) {
      for (const line of s.body.split(/\n+/)) body.push(para(line));
    }
    s.points.forEach((p, i) =>
      body.push(para(`${i + 1}. ${p}`, { indent: true })),
    );
    for (const it of s.items) {
      body.push(para(it.title, { bold: true, after: 40 }));
      body.push(para(it.detail, { after: it.purpose ? 40 : 120 }));
      if (it.purpose) body.push(para(`Used: ${it.purpose}`));
    }
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>'
  );
}

/** A Word document of the text, carrying the text itself for the editor. */
export function buildTermsDocx(t: TermsText): Buffer {
  const json = Buffer.from(JSON.stringify(t), 'utf8').toString('base64');
  const files: [string, string][] = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    ],
    [
      'word/_rels/document.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../${TEXT_PART}"/>` +
        '</Relationships>',
    ],
    ['word/document.xml', documentXml(t)],
    [
      TEXT_PART,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><text xmlns="${TEXT_NS}">${json}</text>`,
    ],
  ];
  return writeZip(
    files.map(([name, s]) => ({ name, data: Buffer.from(s, 'utf8') })),
  );
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNullableStr = (v: unknown): v is string | null =>
  v === null || isStr(v);

function isTermsText(v: unknown): v is TermsText {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return (
    isStr(t.title) &&
    isNullableStr(t.intro) &&
    Array.isArray(t.sections) &&
    t.sections.every((s: unknown) => {
      if (!s || typeof s !== 'object') return false;
      const x = s as Record<string, unknown>;
      return (
        isStr(x.heading) &&
        isNullableStr(x.body) &&
        Array.isArray(x.points) &&
        x.points.every(isStr) &&
        Array.isArray(x.items) &&
        x.items.every((i: unknown) => {
          const it = i as Record<string, unknown> | null;
          return (
            !!it &&
            isStr(it.title) &&
            isStr(it.detail) &&
            isNullableStr(it.purpose)
          );
        })
      );
    })
  );
}

/** The text a `buildTermsDocx` document carries; `null` for any other file. */
export function readTermsText(docx: Buffer): TermsText | null {
  const part = readZipEntry(docx, TEXT_PART)?.toString('utf8');
  const b64 = part?.match(/<text xmlns="[^"]*">([A-Za-z0-9+/=]*)<\/text>/)?.[1];
  if (!b64) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(b64, 'base64').toString('utf8'),
    );
    return isTermsText(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
