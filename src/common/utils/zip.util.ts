import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * Just enough ZIP for the documents this service writes itself (docx is a
 * ZIP): deflated entries, no ZIP64, no encryption. Reading is bounded, so a
 * hostile archive cannot blow up memory.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
/** A docx part this service reads is a few KB; anything far beyond is not ours. */
const MAX_ENTRY_BYTES = 5 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(0, 10); // time + date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** One entry's bytes, or `null` when the archive has no such entry or is not a ZIP this can read. */
export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  try {
    const endAt = zip.lastIndexOf(
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      zip.length - 22,
    );
    if (endAt < 0) return null;
    const count = zip.readUInt16LE(endAt + 10);
    let at = zip.readUInt32LE(endAt + 16);
    for (let i = 0; i < count; i++) {
      if (zip.readUInt32LE(at) !== CENTRAL) return null;
      const method = zip.readUInt16LE(at + 10);
      const packedSize = zip.readUInt32LE(at + 20);
      const size = zip.readUInt32LE(at + 24);
      const nameLen = zip.readUInt16LE(at + 28);
      const extraLen = zip.readUInt16LE(at + 30);
      const commentLen = zip.readUInt16LE(at + 32);
      const localAt = zip.readUInt32LE(at + 42);
      const name = zip.toString('utf8', at + 46, at + 46 + nameLen);
      at += 46 + nameLen + extraLen + commentLen;
      if (name !== wanted) continue;

      if (size > MAX_ENTRY_BYTES || zip.readUInt32LE(localAt) !== LOCAL) {
        return null;
      }
      const dataAt =
        localAt +
        30 +
        zip.readUInt16LE(localAt + 26) +
        zip.readUInt16LE(localAt + 28);
      const packed = zip.subarray(dataAt, dataAt + packedSize);
      if (method === 0) return Buffer.from(packed);
      if (method !== 8) return null;
      return inflateRawSync(packed, { maxOutputLength: MAX_ENTRY_BYTES });
    }
    return null;
  } catch {
    return null;
  }
}
