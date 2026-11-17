// spec/contributor/rendering.md, "The same template files, approved manifest, revision and digest render the same sorted bytes"
import { type SkillFile, comparePaths } from "./render.ts";

const encoder = new TextEncoder();

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** @throws {never} */
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const utf8Flag = 0x0800;
export const fixedDosDate = 0x0021;
export const regularFileMode = 0o100644;

function header(signature: number, size: number, name: Uint8Array) {
  const bytes = new Uint8Array(size + name.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  bytes.set(name, size);
  return { bytes, view };
}

/** @throws {never} */
export function storedZip(entries: ReadonlyArray<SkillFile>): Uint8Array {
  const sorted = [...entries].sort((left, right) => comparePaths(left.path, right.path));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const { path, bytes } of sorted) {
    const name = encoder.encode(path);
    const crc = crc32(bytes);
    const local = header(0x04034b50, 30, name);
    local.view.setUint16(4, 20, true);
    local.view.setUint16(6, utf8Flag, true);
    local.view.setUint16(12, fixedDosDate, true);
    local.view.setUint32(14, crc, true);
    local.view.setUint32(18, bytes.length, true);
    local.view.setUint32(22, bytes.length, true);
    local.view.setUint16(26, name.length, true);
    const central = header(0x02014b50, 46, name);
    central.view.setUint16(4, (3 << 8) | 20, true);
    central.view.setUint16(6, 20, true);
    central.view.setUint16(8, utf8Flag, true);
    central.view.setUint16(14, fixedDosDate, true);
    central.view.setUint32(16, crc, true);
    central.view.setUint32(20, bytes.length, true);
    central.view.setUint32(24, bytes.length, true);
    central.view.setUint16(28, name.length, true);
    central.view.setUint32(38, (regularFileMode << 16) >>> 0, true);
    central.view.setUint32(42, offset, true);
    locals.push(local.bytes, bytes);
    centrals.push(central.bytes);
    offset += local.bytes.length + bytes.length;
  }
  const centralSize = centrals.reduce((total, part) => total + part.length, 0);
  const end = header(0x06054b50, 22, new Uint8Array(0));
  end.view.setUint16(8, sorted.length, true);
  end.view.setUint16(10, sorted.length, true);
  end.view.setUint32(12, centralSize, true);
  end.view.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, end.bytes];
  const archive = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let position = 0;
  for (const part of parts) {
    archive.set(part, position);
    position += part.length;
  }
  return archive;
}
