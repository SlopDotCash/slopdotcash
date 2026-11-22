// spec/security/admission.md, "Every reviewed batch covers the next unreviewed inventory entries"

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const at = (bytes: Uint8Array, index: number): number => bytes[index] ?? 0;
const uint32 = (bytes: Uint8Array, index: number) => ((at(bytes, index) << 24) | (at(bytes, index + 1) << 16) | (at(bytes, index + 2) << 8) | at(bytes, index + 3)) >>> 0;
const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));

function wellFormedPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) return false;
  let offset = 8;
  let first = true;
  while (offset + 12 <= bytes.length) {
    const length = uint32(bytes, offset);
    const end = offset + 12 + length;
    if (length > 0x7fffffff || end > bytes.length) return false;
    const type = ascii(bytes, offset + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) return false;
    if (first && (type !== "IHDR" || length !== 13)) return false;
    first = false;
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== uint32(bytes, offset + 8 + length)) return false;
    offset = end;
    if (type === "IEND") return length === 0 && offset === bytes.length;
  }
  return false;
}

function wellFormedJpeg(bytes: Uint8Array): boolean {
  const n = bytes.length;
  if (n < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  if (bytes[n - 2] !== 0xff || bytes[n - 1] !== 0xd9) return false;
  let offset = 2;
  while (offset + 4 <= n) {
    if (bytes[offset] !== 0xff) return false;
    const marker = at(bytes, offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd8 || marker === 0xd9) return false;
    const length = (at(bytes, offset + 2) << 8) | at(bytes, offset + 3);
    if (length < 2 || offset + 2 + length > n) return false;
    if (marker === 0xda) return offset + 2 + length <= n - 2;
    offset += 2 + length;
  }
  return false;
}

function wellFormedGif(bytes: Uint8Array): boolean {
  const header = ascii(bytes, 0, 6);
  if (header !== "GIF87a" && header !== "GIF89a") return false;
  if (bytes.length < 14) return false;
  let offset = 13;
  if (at(bytes, 10) & 0x80) offset += 3 * 2 ** ((at(bytes, 10) & 0x07) + 1);
  const subBlocks = () => {
    for (;;) {
      if (offset >= bytes.length) return false;
      const size = at(bytes, offset);
      offset += 1 + size;
      if (size === 0) return offset <= bytes.length;
    }
  };
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x3b) return offset === bytes.length - 1;
    if (block === 0x21) {
      offset += 2;
      if (!subBlocks()) return false;
    } else if (block === 0x2c) {
      if (offset + 10 > bytes.length) return false;
      const packed = at(bytes, offset + 9);
      offset += 10;
      if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
      offset += 1;
      if (!subBlocks()) return false;
    } else return false;
  }
  return false;
}

function wellFormedWebp(bytes: Uint8Array): boolean {
  const le = (index: number) => (at(bytes, index) | (at(bytes, index + 1) << 8) | (at(bytes, index + 2) << 16) | (at(bytes, index + 3) << 24)) >>> 0;
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return false;
  if (le(4) + 8 !== bytes.length) return false;
  let offset = 12;
  let chunks = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return false;
    if (!/^[A-Z0-9 ]{4}$/u.test(ascii(bytes, offset, 4))) return false;
    const size = le(offset + 4);
    offset += 8 + size + (size % 2);
    chunks += 1;
  }
  return chunks > 0 && offset === bytes.length;
}

const IMAGE_FORMATS = [
  { extension: /\.png$/iu, format: "png", check: wellFormedPng },
  { extension: /\.jpe?g$/iu, format: "jpeg", check: wellFormedJpeg },
  { extension: /\.gif$/iu, format: "gif", check: wellFormedGif },
  { extension: /\.webp$/iu, format: "webp", check: wellFormedWebp },
] as const;

export type ImageFormat = (typeof IMAGE_FORMATS)[number]["format"];

/** @throws {never} */
export function wellFormedImage(path: string, bytes: Uint8Array): ImageFormat | null {
  for (const entry of IMAGE_FORMATS) if (entry.extension.test(path)) return entry.check(bytes) ? entry.format : null;
  return null;
}
