import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { verifyReferencedArtifacts } from "./pr-evidence-artifacts.mjs";

// Real GIF89a image: a 320x180 checkerboard followed by a 10x10 update.
// Both frames decode with Windows GDI+. Clear codes keep the fixture's LZW
// stream simple; its bytes are also exercised by the original ingestion API.
const gif = readFileSync(
  new URL("../tests/fixtures/optimized-evidence.gif", import.meta.url),
);
const delta = gif.lastIndexOf(Buffer.from([44, 8, 0, 8, 0, 10, 0, 10, 0, 0]));
if (delta < 0) throw new Error("Missing delta frame in the GIF fixture");
const url =
  "https://github.com/user-attachments/assets/11111111-1111-4111-8111-111111111111";
const body = `<!-- evidence-row:after-screenshots -->
![Recorded image](${url})`;

async function verify(bytes: Uint8Array) {
  return verifyReferencedArtifacts(
    body,
    [{ id: "after-screenshots", label: "After screenshots" }],
    {
      token: "",
      fetchImpl: async () =>
        new Response(new Uint8Array(bytes), {
          headers: {
            "content-type": "image/gif",
            "content-length": String(bytes.length),
          },
        }),
    },
  );
}

test("ingestion accepts the same full-size image with a small GIF update", async () => {
  const still = Buffer.concat([gif.subarray(0, delta - 8), Buffer.from([59])]);
  for (const bytes of [still, gif]) {
    const result = await verify(bytes);
    expect(result.ok).toBe(true);
    expect(result.findings.map((finding) => finding.status)).toEqual(["ok"]);
  }
});

test.each([
  ["small logical canvas", (bytes: Buffer) => bytes.writeUInt16LE(160, 6)],
  ["zero-width update", (bytes: Buffer) => bytes.writeUInt16LE(0, delta + 5)],
  [
    "out-of-canvas update",
    (bytes: Buffer) => bytes.writeUInt16LE(319, delta + 1),
  ],
])("ingestion still rejects a GIF with a %s", async (_name, change) => {
  const bytes = Buffer.from(gif);
  change(bytes);
  const result = await verify(bytes);
  expect(result.ok).toBe(false);
  expect(result.findings.map((finding) => finding.status)).toEqual([
    "artifact-kind-mismatch",
  ]);
});

test("ingestion still rejects an empty GIF update and a missing trailer", async () => {
  const empty = Buffer.concat([
    gif.subarray(0, delta + 11),
    Buffer.from([0, 59]),
  ]);
  for (const bytes of [empty, gif.subarray(0, gif.length - 1)]) {
    const result = await verify(bytes);
    expect(result.ok).toBe(false);
    expect(result.findings.map((finding) => finding.status)).toEqual([
      "artifact-kind-mismatch",
    ]);
  }
});
