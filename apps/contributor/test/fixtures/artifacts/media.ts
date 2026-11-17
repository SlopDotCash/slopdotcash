import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const encoder = new TextEncoder();

/** @throws {never} */
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = encoder.encode(type);
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(name, 4);
  bytes.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, data.length + 8)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
  return bytes;
}

/** @throws {never} */
export function concatenated(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const width = 320;
const height = 180;

function header(): Uint8Array {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes[8] = 8;
  bytes[9] = 2;
  return bytes;
}

function pixels(noise: boolean): Uint8Array {
  const rows = new Uint8Array((width * 3 + 1) * height);
  let seed = 7;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      rows[offset] = noise ? seed & 0xff : (x * 13 + y * 7) % 256;
      rows[offset + 1] = noise ? (seed >>> 8) & 0xff : (x * 3 + y * 11) % 256;
      rows[offset + 2] = noise ? (seed >>> 16) & 0xff : (x ^ y) % 256;
    }
  }
  return rows;
}

export const compressedPixels: Uint8Array = new Uint8Array(deflateSync(pixels(false)));

/** @throws {never} */
export function png(chunks: ReadonlyArray<Uint8Array>): Uint8Array {
  return concatenated([signature, pngChunk("IHDR", header()), ...chunks, pngChunk("IEND", new Uint8Array(0))]);
}

export const emptyIdat: Uint8Array = pngChunk("IDAT", new Uint8Array(0));
export const screenshot: Uint8Array = png([pngChunk("IDAT", compressedPixels)]);
export const largeScreenshot: Uint8Array = png([pngChunk("IDAT", new Uint8Array(deflateSync(pixels(true))))]);
export const commentOnlyScreenshot: Uint8Array = png([pngChunk("tEXt", concatenated([encoder.encode("Comment\0"), new Uint8Array(1100).fill(65)])), emptyIdat]);

/** @throws {never} */
export function withCorruptCrc(chunk: Uint8Array): Uint8Array {
  const corrupt = Uint8Array.from(chunk);
  corrupt[corrupt.length - 1] ^= 1;
  return corrupt;
}

/** @throws {Error} */
export function recordedGif(): Uint8Array {
  return new Uint8Array(readFileSync(new URL("./optimized-evidence.gif", import.meta.url)));
}

/** @throws {Error} */
export function gifDeltaOffset(gif: Uint8Array): number {
  const marker = [44, 8, 0, 8, 0, 10, 0, 10, 0, 0];
  for (let index = gif.length - marker.length; index >= 0; index--) {
    if (marker.every((byte, offset) => gif[index + offset] === byte)) return index;
  }
  throw new Error("Missing delta frame in the GIF fixture");
}

/** @throws {never} */
export function writeLittle16(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const changed = Uint8Array.from(bytes);
  changed[offset] = value & 0xff;
  changed[offset + 1] = (value >>> 8) & 0xff;
  return changed;
}

export const serverLog: Uint8Array = encoder.encode(
  [
    "2026-11-16T10:00:00.000Z INFO GET /api/v1/projects 200 12ms request_id=7d1c",
    "2026-11-16T10:00:01.000Z INFO POST /api/v1/referrals/code 409 8ms request_id=7d1d",
    "2026-11-16T10:00:02.000Z WARN GET /api/v1/points/ledger 503 30ms request_id=7d1e",
    "2026-11-16T10:00:03.000Z INFO GET /api/v1/projects/slop 200 9ms request_id=7d1f",
  ].join("\n"),
);

/** @throws {never} */
export function longLog(lines: number): Uint8Array {
  return encoder.encode(
    Array.from({ length: lines }, (_, index) => `2026-11-16T10:00:00.000Z INFO GET /api/v1/projects?page=${index} 200 ${index % 97}ms request_id=${index.toString(16)}`).join("\n"),
  );
}

export const trivialDocument: Uint8Array = encoder.encode("ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok ok\n");
