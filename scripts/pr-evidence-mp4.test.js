import { expect, test } from "bun:test";
import { verifyReferencedArtifacts } from "./pr-evidence-artifacts.mjs";

const width = 320;
const height = 180;

function isoBox(type, payload) {
  const out = Buffer.alloc(8 + payload.length);
  out.writeUInt32BE(8 + payload.length, 0);
  out.write(type, 4);
  payload.copy(out, 8);
  return out;
}

function trak(codec, w = width, h = height) {
  const hdlrPayload = Buffer.alloc(24);
  hdlrPayload.write("vide", 8);
  const entry = Buffer.alloc(100);
  entry.writeUInt32BE(100, 0);
  entry.write(codec, 4);
  entry.writeUInt16BE(1, 14);
  entry.writeUInt16BE(w, 32);
  entry.writeUInt16BE(h, 34);
  const stsdPayload = Buffer.alloc(108);
  stsdPayload.writeUInt32BE(1, 4);
  entry.copy(stsdPayload, 8);
  return isoBox(
    "trak",
    isoBox(
      "mdia",
      Buffer.concat([
        isoBox("hdlr", hdlrPayload),
        isoBox("minf", isoBox("stbl", isoBox("stsd", stsdPayload))),
      ]),
    ),
  );
}

function ftyp() {
  return isoBox(
    "ftyp",
    Buffer.concat([
      Buffer.from("isom"),
      Buffer.from([0, 0, 2, 0]),
      Buffer.from("isomiso2"),
    ]),
  );
}

function mp4(codec, { w, h } = {}) {
  return Buffer.concat([
    ftyp(),
    isoBox("mdat", Buffer.alloc(17000, 0x55)),
    isoBox("moov", trak(codec, w, h)),
  ]);
}

function fragmentedMp4(codec) {
  const mvex = isoBox(
    "mvex",
    Buffer.concat([
      isoBox("mehd", Buffer.alloc(8)),
      isoBox("trex", Buffer.alloc(24)),
    ]),
  );
  const moof = (sequence) => {
    const mfhdPayload = Buffer.alloc(8);
    mfhdPayload.writeUInt32BE(sequence, 4);
    const traf = isoBox(
      "traf",
      Buffer.concat([
        isoBox("tfhd", Buffer.alloc(20)),
        isoBox("tfdt", Buffer.alloc(12)),
        isoBox("trun", Buffer.alloc(20)),
      ]),
    );
    return isoBox("moof", Buffer.concat([isoBox("mfhd", mfhdPayload), traf]));
  };
  return Buffer.concat([
    ftyp(),
    isoBox("moov", Buffer.concat([trak(codec), mvex])),
    moof(1),
    isoBox("mdat", Buffer.alloc(17000, 0x55)),
    moof(2),
    isoBox("mdat", Buffer.alloc(4000, 0x56)),
  ]);
}

function truncatedMp4(codec) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(17000 + 8, 0);
  header.write("mdat", 4);
  return Buffer.concat([
    ftyp(),
    header,
    Buffer.alloc(500, 0x55),
    isoBox("moov", trak(codec)),
  ]);
}

async function verify(bytes) {
  const url =
    "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
  return verifyReferencedArtifacts(
    '<!-- evidence-row:walkthrough-video -->\n<video src="' +
      url +
      '"></video>',
    [{ id: "walkthrough-video", label: "Walkthrough video" }],
    {
      contentDigestLimitBytes: 1024 * 1024,
      fetchImpl: async () =>
        new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "video/mp4",
            "content-length": String(bytes.length),
          },
        }),
    },
  );
}

// Browser MediaRecorder MP4 muxers write the avc3 sample entry whenever the
// H.264 stream carries its parameter sets in-band (the Chromium MP4 muxer
// picks avc3 for in-band streams; Firefox lists avc3 as a MediaRecorder MP4
// configuration). The entry layout is identical to avc1, and the HEVC
// in-band sibling hev1 is already accepted alongside hvc1.
test.each([
  ["plain avc3 sample entry", mp4("avc3")],
  ["fragmented avc3 sample entry", fragmentedMp4("avc3")],
])("walkthrough evidence accepts an MP4 with a %s", async (_, bytes) => {
  expect((await verify(bytes)).ok).toBe(true);
});

test.each([
  ["avc1", mp4("avc1")],
  ["fragmented avc1", fragmentedMp4("avc1")],
  ["hev1", mp4("hev1")],
  ["hvc1", mp4("hvc1")],
  ["vp09", mp4("vp09")],
  ["av01", mp4("av01")],
])(
  "walkthrough evidence still accepts an MP4 with a %s sample entry",
  async (_, bytes) => {
    expect((await verify(bytes)).ok).toBe(true);
  },
);

test.each([
  ["an unlisted mp4v sample entry", mp4("mp4v")],
  ["an unlisted vp08 sample entry", mp4("vp08")],
  ["an avc3 entry whose mdat payload is truncated", truncatedMp4("avc3")],
  ["an avc3 entry below the useful dimensions", mp4("avc3", { w: 160, h: 90 })],
  ["non-MP4 bytes", Buffer.alloc(20000, 0x07)],
])("walkthrough evidence still rejects %s", async (_, bytes) => {
  expect((await verify(bytes)).ok).toBe(false);
});
