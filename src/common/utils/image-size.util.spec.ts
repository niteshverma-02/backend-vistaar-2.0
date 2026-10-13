import { imageInfo } from './image-size.util';

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** SOI, an APP0 segment to skip, then a baseline SOF0 frame. */
function jpeg(width: number, height: number, sof = 0xc0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  const sofSeg = Buffer.alloc(19);
  sofSeg.writeUInt16BE(0xff00 | sof, 0);
  sofSeg.writeUInt16BE(17, 2);
  sofSeg[4] = 8;
  sofSeg.writeUInt16BE(height, 5);
  sofSeg.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sofSeg]);
}

function riff(chunk: string, body: Buffer): Buffer {
  const head = Buffer.alloc(20);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(12 + body.length, 4);
  head.write('WEBP', 8, 'ascii');
  head.write(chunk, 12, 'ascii');
  head.writeUInt32LE(body.length, 16);
  return Buffer.concat([head, body, Buffer.alloc(16)]);
}

function webpLossy(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  Buffer.from([0x9d, 0x01, 0x2a]).copy(body, 3);
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  return riff('VP8 ', body);
}

function webpLossless(width: number, height: number): Buffer {
  const body = Buffer.alloc(5);
  body[0] = 0x2f;
  body.writeUInt32LE(((height - 1) << 14) | (width - 1), 1);
  return riff('VP8L', body);
}

function webpExtended(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return riff('VP8X', body);
}

describe('imageInfo', () => {
  it.each([
    ['PNG', png(1200, 400), 'image/png'],
    ['baseline JPEG', jpeg(1200, 400), 'image/jpeg'],
    ['progressive JPEG', jpeg(1200, 400, 0xc2), 'image/jpeg'],
    ['lossy WEBP', webpLossy(1200, 400), 'image/webp'],
    ['lossless WEBP', webpLossless(1200, 400), 'image/webp'],
    ['extended WEBP', webpExtended(1200, 400), 'image/webp'],
  ])('reads a %s', (_, buf, mime) => {
    expect(imageInfo(buf)).toEqual({ mime, width: 1200, height: 400 });
  });

  it.each([
    ['a PDF', Buffer.from('%PDF-1.7\n1 0 obj')],
    ['text', Buffer.from('hello, this is not an image at all')],
    ['an empty file', Buffer.alloc(0)],
    ['a cut-off PNG', png(1200, 400).subarray(0, 20)],
    ['a zero-sized PNG', png(0, 400)],
    ['a GIF', Buffer.from('GIF89a\x10\x00\x10\x00')],
  ])('refuses %s', (_, buf) => {
    expect(imageInfo(buf)).toBeNull();
  });
});
