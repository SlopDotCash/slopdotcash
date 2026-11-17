// spec/contributor/artifactTransport.md, "Each request carries a credential only at the GitHub authority"
import { Arbitrary, Schema } from "effect";
import { contract } from "vibestack/testing";
import { crc32 } from "../render/archive.ts";
import { framing, mediaKind } from "./media.ts";

const encoder = new TextEncoder();

function chunk(type: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(encoder.encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(data.length + 8, crc32(bytes.subarray(4, data.length + 8)));
  return bytes;
}

const header = new Uint8Array(13);
new DataView(header.buffer).setUint32(0, 320);
new DataView(header.buffer).setUint32(4, 180);
header[8] = 8;
header[9] = 2;

const parts = [
  Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  chunk("IHDR", header),
  chunk("IDAT", Uint8Array.from({ length: 300 }, (_, index) => (index * 31) & 0xff)),
  chunk("IEND", new Uint8Array(0)),
];
const screenshot = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
parts.reduce((offset, part) => {
  screenshot.set(part, offset);
  return offset + part.length;
}, 0);

const byteArrays = Arbitrary.schema(Schema.Struct({ values: Schema.Array(Schema.Int), complete: Schema.Boolean })).pipe(
  Arbitrary.map(({ values, complete }) => ({ bytes: Uint8Array.from(values, (value) => value & 0xff), complete })),
);

const cuts = Arbitrary.schema(Schema.Int).pipe(Arbitrary.map((value) => Math.abs(value) % (screenshot.length + 1)));

const prefixes = Arbitrary.schema(Schema.Struct({ values: Schema.Array(Schema.Int), extra: Schema.Int })).pipe(
  Arbitrary.map(({ values, extra }) => ({ bytes: Uint8Array.from([0, ...values], (value) => value & 0xff), extra: 1 + (Math.abs(extra) % 1_000_000) })),
);

export const parsersAreTotalOnAnyBytes = contract({
  input: byteArrays,
  run: ({ bytes, complete }: { readonly bytes: Uint8Array; readonly complete: boolean }) => mediaKind(bytes, complete),
  deterministic: true,
});

export const aTruncatedScreenshotIsNeverACompleteImage = contract({
  input: cuts,
  run: (cut: number) => mediaKind(screenshot.subarray(0, cut), true),
  invariant: (cut, kind) => (cut === screenshot.length ? kind === "image" : kind === null),
});

export const aRangedPrefixIsNeverComplete = contract({
  input: prefixes,
  run: ({ bytes, extra }: { readonly bytes: Uint8Array; readonly extra: number }) =>
    framing({ status: 206, contentLength: String(bytes.length), contentRange: `bytes 0-${bytes.length - 1}/${bytes.length + extra}`, bytes, ended: true }),
  invariant: (_, framed) => !framed.complete && framed.lengthError === null,
});
