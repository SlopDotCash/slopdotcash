import { expect, test } from "bun:test";
import { verifyReferencedArtifacts } from "./pr-evidence-artifacts.mjs";

const width = 320;
const height = 180;

function webpChunk(type, payload) {
  const out = Buffer.alloc(8 + payload.length + (payload.length % 2));
  out.write(type, 0);
  out.writeUInt32LE(payload.length, 4);
  payload.copy(out, 8);
  return out;
}

function webp(chunks) {
  const body = Buffer.concat(chunks);
  const out = Buffer.alloc(12 + body.length);
  out.write("RIFF", 0);
  out.writeUInt32LE(4 + body.length, 4);
  out.write("WEBP", 8);
  body.copy(out, 12);
  return out;
}

function vp8Payload(total) {
  const payload = Buffer.alloc(total, 0x24);
  payload[3] = 0x9d;
  payload[4] = 0x01;
  payload[5] = 0x2a;
  payload.writeUInt16LE(width, 6);
  payload.writeUInt16LE(height, 8);
  return payload;
}

function vp8lPayload(total) {
  const payload = Buffer.alloc(total, 0x19);
  payload[0] = 0x2f;
  payload.writeUInt32LE(width - 1 + (height - 1) * 2 ** 14, 1);
  return payload;
}

function vp8xPayload(flags) {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return payload;
}

const animHeader = Buffer.alloc(6);
const frameHeader = Buffer.alloc(16);
frameHeader.writeUIntLE(width - 1, 6, 3);
frameHeader.writeUIntLE(height - 1, 9, 3);
const frame = (subChunks) =>
  webpChunk("ANMF", Buffer.concat([frameHeader, ...subChunks]));
const animated = (flags, frames, extra = []) =>
  webp([
    webpChunk("VP8X", vp8xPayload(flags)),
    webpChunk("ANIM", animHeader),
    ...frames,
    ...extra,
  ]);

async function verify(bytes) {
  const url = "https://user-images.githubusercontent.com/123456/evidence.webp";
  return verifyReferencedArtifacts(
    "<!-- evidence-row:before-screenshots -->\n![Before](" + url + ")",
    [{ id: "before-screenshots", label: "Before screenshots" }],
    {
      token: "",
      contentDigestLimitBytes: 1024 * 1024,
      fetchImpl: async () =>
        new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "image/webp",
            "content-length": String(bytes.length),
          },
        }),
    },
  );
}

// WebP animation keeps every frame inside ANMF chunks; a still-image VP8
// or VP8L chunk never appears at the top level of an animated file.
test.each([
  [
    "lossy frame",
    animated(0x02, [frame([webpChunk("VP8 ", vp8Payload(1500))])]),
  ],
  [
    "lossless frame",
    animated(0x02, [frame([webpChunk("VP8L", vp8lPayload(1500))])]),
  ],
  [
    "frame with an alpha sub-chunk",
    animated(0x12, [
      frame([
        webpChunk("ALPH", Buffer.alloc(64, 1)),
        webpChunk("VP8 ", vp8Payload(1500)),
      ]),
    ]),
  ],
  [
    "two frames",
    animated(0x02, [
      frame([webpChunk("VP8 ", vp8Payload(1500))]),
      frame([webpChunk("VP8 ", vp8Payload(1500))]),
    ]),
  ],
])(
  "screenshot evidence accepts an animated WebP with a %s",
  async (_, bytes) => {
    expect((await verify(bytes)).ok).toBe(true);
  },
);

test.each([
  ["still lossy image", webp([webpChunk("VP8 ", vp8Payload(1500))])],
  [
    "still extended image",
    webp([
      webpChunk("VP8X", vp8xPayload(0)),
      webpChunk("VP8 ", vp8Payload(1500)),
    ]),
  ],
])("screenshot evidence still accepts a %s", async (_, bytes) => {
  expect((await verify(bytes)).ok).toBe(true);
});

test("screenshot evidence still rejects an animated WebP whose frame payload is too small", async () => {
  const bytes = animated(
    0x02,
    [frame([webpChunk("VP8 ", vp8Payload(100))])],
    [webpChunk("XMP ", Buffer.alloc(1200, 0x20))],
  );
  expect((await verify(bytes)).ok).toBe(false);
});

test("screenshot evidence still rejects an ANMF chunk without the VP8X animation flag", async () => {
  const bytes = animated(0x00, [frame([webpChunk("VP8 ", vp8Payload(1500))])]);
  expect((await verify(bytes)).ok).toBe(false);
});

test("screenshot evidence still rejects an animated WebP whose frame holds no image sub-chunk", async () => {
  const bytes = animated(0x02, [
    frame([webpChunk("XTRA", Buffer.alloc(1500, 0x20))]),
  ]);
  expect((await verify(bytes)).ok).toBe(false);
});
