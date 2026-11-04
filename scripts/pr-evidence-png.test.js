import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { verifyReferencedArtifacts } from "./pr-evidence-artifacts.mjs";

function chunk(type, data) {
  const name = Buffer.from(type);
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  name.copy(bytes, 4);
  data.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return bytes;
}

const width = 320;
const height = 180;
const header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels[offset] = (x * 13 + y * 7) % 256;
    pixels[offset + 1] = (x * 3 + y * 11) % 256;
    pixels[offset + 2] = (x ^ y) % 256;
  }
}
const compressed = deflateSync(pixels);
const data = chunk("IDAT", compressed);
const empty = chunk("IDAT", Buffer.alloc(0));
const png = (chunks) =>
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    ...chunks,
    chunk("IEND", Buffer.alloc(0)),
  ]);

async function verify(bytes) {
  const url = "https://user-images.githubusercontent.com/123456/screenshot.png";
  return verifyReferencedArtifacts(
    "<!-- evidence-row:before-screenshots -->\n![Before](" + url + ")",
    [{ id: "before-screenshots", label: "Before screenshots" }],
    {
      token: "",
      contentDigestLimitBytes: 1024 * 1024,
      fetchImpl: async (requested) => {
        expect(String(requested)).toBe(url);
        return new Response(bytes, {
          headers: {
            "content-type": "image/png",
            "content-length": String(bytes.length),
          },
        });
      },
    },
  );
}

// PNG section 11.2.3 permits empty IDAT chunks within the compressed stream.
test.each([
  ["ordinary image", [data]],
  ["leading empty IDAT", [empty, data]],
  [
    "middle empty IDAT",
    [
      chunk("IDAT", compressed.subarray(0, 10)),
      empty,
      chunk("IDAT", compressed.subarray(10)),
    ],
  ],
  ["trailing empty IDAT", [data, empty]],
])("screenshot evidence accepts %s", async (_, chunks) => {
  expect((await verify(png(chunks))).ok).toBe(true);
});

test("screenshot evidence still rejects an empty-only image", async () => {
  const padding = chunk(
    "tEXt",
    Buffer.concat([Buffer.from("Comment\0"), Buffer.alloc(1100, 65)]),
  );
  expect((await verify(png([padding, empty]))).ok).toBe(false);
});

test("screenshot evidence still checks an empty IDAT's CRC", async () => {
  const corrupt = Buffer.from(empty);
  corrupt[corrupt.length - 1] ^= 1;
  expect((await verify(png([corrupt, data]))).ok).toBe(false);
});
