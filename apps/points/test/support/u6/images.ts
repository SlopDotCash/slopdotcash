// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"
import { crc32, deflateSync } from "node:zlib";

const width = 320;
const height = 180;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(name, 4);
  bytes.set(data, 8);
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
  return bytes;
}

function joined(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function pixels(): Uint8Array {
  const rows = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      rows[offset] = (x * 13 + y * 7) % 256;
      rows[offset + 1] = (x * 3 + y * 11) % 256;
      rows[offset + 2] = (x ^ y) % 256;
    }
  }
  return rows;
}

const header = (() => {
  const bytes = new Uint8Array(13);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  bytes[8] = 8;
  bytes[9] = 2;
  return bytes;
})();

const compressed = new Uint8Array(deflateSync(pixels()));

export type PngVariant = "ordinary" | "leadingEmpty" | "middleEmpty" | "trailingEmpty" | "emptyOnly" | "corruptEmpty";

/** @throws {never} */
export function png(variant: PngVariant): Uint8Array {
  const data = chunk("IDAT", compressed);
  const empty = chunk("IDAT", new Uint8Array(0));
  const corrupt = Uint8Array.from(empty);
  corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 1;
  const padding = chunk("tEXt", joined([new TextEncoder().encode("Comment\0"), new Uint8Array(1100).fill(65)]));
  const chunks: Record<PngVariant, ReadonlyArray<Uint8Array>> = {
    ordinary: [data],
    leadingEmpty: [empty, data],
    middleEmpty: [chunk("IDAT", compressed.subarray(0, 10)), empty, chunk("IDAT", compressed.subarray(10))],
    trailingEmpty: [data, empty],
    emptyOnly: [padding, empty],
    corruptEmpty: [corrupt, data],
  };
  return joined([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), ...chunks[variant], chunk("IEND", new Uint8Array(0))]);
}

function subBlocks(payload: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += 255) {
    const block = payload.subarray(offset, offset + 255);
    parts.push(Uint8Array.from([block.length]), block);
  }
  parts.push(Uint8Array.from([0]));
  return joined(parts);
}

function frame(left: number, top: number, frameWidth: number, frameHeight: number, payloadBytes: number): Uint8Array {
  const descriptor = new Uint8Array(10);
  const view = new DataView(descriptor.buffer);
  descriptor[0] = 44;
  view.setUint16(1, left, true);
  view.setUint16(3, top, true);
  view.setUint16(5, frameWidth, true);
  view.setUint16(7, frameHeight, true);
  const payload = new Uint8Array(payloadBytes).map((_, index) => (index * 37) % 251);
  return joined([descriptor, Uint8Array.from([8]), subBlocks(payload)]);
}

export type GifVariant = "still" | "updated" | "smallCanvas" | "zeroWidthUpdate" | "outsideUpdate" | "emptyUpdate" | "missingTrailer";

/** @throws {never} */
export function gif(variant: GifVariant): Uint8Array {
  const screen = new Uint8Array(13);
  screen.set(new TextEncoder().encode("GIF89a"));
  const view = new DataView(screen.buffer);
  view.setUint16(6, variant === "smallCanvas" ? 160 : width, true);
  view.setUint16(8, height, true);
  screen[10] = 0;
  const update = variant === "zeroWidthUpdate" ? frame(8, 8, 0, 10, 40) : variant === "outsideUpdate" ? frame(319, 8, 10, 10, 40) : frame(8, 8, 10, 10, 40);
  const emptyUpdate = joined([update.subarray(0, 11), Uint8Array.from([0])]);
  const frames = variant === "still" ? [] : variant === "emptyUpdate" ? [emptyUpdate] : [update];
  const trailer = variant === "missingTrailer" ? [] : [Uint8Array.from([59])];
  return joined([screen, frame(0, 0, width, height, 2048), ...frames, ...trailer]);
}
