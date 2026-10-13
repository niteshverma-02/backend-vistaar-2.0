export interface ImageInfo {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
}

/**
 * Type and pixel size read from the file's own bytes — the `Content-Type` a
 * client sends is a claim, this is the file. `null` when the bytes are not a
 * JPEG, PNG or WEBP this can measure.
 */
export function imageInfo(buf: Buffer): ImageInfo | null {
  return png(buf) ?? jpeg(buf) ?? webp(buf);
}

function png(buf: Buffer): ImageInfo | null {
  const signature = '89504e470d0a1a0a';
  if (buf.length < 24 || buf.toString('hex', 0, 8) !== signature) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return sized('image/png', buf.readUInt32BE(16), buf.readUInt32BE(20));
}

/** Walks the segments to the first start-of-frame, which holds the size. */
function jpeg(buf: Buffer): ImageInfo | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return sized(
        'image/jpeg',
        buf.readUInt16BE(at + 7),
        buf.readUInt16BE(at + 5),
      );
    }
    at += 2 + buf.readUInt16BE(at + 2);
  }
  return null;
}

function webp(buf: Buffer): ImageInfo | null {
  if (
    buf.length < 30 ||
    buf.toString('ascii', 0, 4) !== 'RIFF' ||
    buf.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  switch (buf.toString('ascii', 12, 16)) {
    case 'VP8 ':
      return sized(
        'image/webp',
        buf.readUInt16LE(26) & 0x3fff,
        buf.readUInt16LE(28) & 0x3fff,
      );
    case 'VP8L': {
      const bits = buf.readUInt32LE(21);
      return sized(
        'image/webp',
        (bits & 0x3fff) + 1,
        ((bits >> 14) & 0x3fff) + 1,
      );
    }
    case 'VP8X':
      return sized(
        'image/webp',
        buf.readUIntLE(24, 3) + 1,
        buf.readUIntLE(27, 3) + 1,
      );
    default:
      return null;
  }
}

function sized(
  mime: ImageInfo['mime'],
  width: number,
  height: number,
): ImageInfo | null {
  return width > 0 && height > 0 ? { mime, width, height } : null;
}
