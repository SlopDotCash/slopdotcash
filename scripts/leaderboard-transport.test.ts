import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  encodeLeaderboardParts,
  MAX_LEADERBOARD_BYTES,
  MAX_LEADERBOARD_FILE_BYTES,
  MAX_LEADERBOARD_PART_BYTES,
  readLeaderboardBytes,
} from "../src/lib/leaderboard-transport.mjs";
import { createDistManifest } from "./dist-manifest.mjs";
import { readLeaderboardFile } from "./leaderboard-files.mjs";
import { prepareLeaderboardTransport } from "./prepare-leaderboard-transport.mjs";

const original = new TextEncoder().encode(
  `${JSON.stringify({ records: ["é😃".repeat(4_400_000)], sourceCount: 1 })}\n`,
);
const encoded = encodeLeaderboardParts(original);
const parts = new Map(encoded.parts.map((part) => [part.path, part.bytes]));
async function readPart(path: string) {
  const bytes = parts.get(path);
  if (!bytes) throw new Error("Missing test part");
  return bytes;
}

test("oversized JSON survives Pages-sized parts byte-for-byte, including UTF-8 split across parts", async () => {
  expect(original.length).toBeGreaterThan(MAX_LEADERBOARD_FILE_BYTES);
  expect(encoded.root.length).toBeLessThan(MAX_LEADERBOARD_FILE_BYTES);
  expect(
    encoded.parts.every((p) => p.bytes.length <= MAX_LEADERBOARD_PART_BYTES),
  ).toBe(true);
  const restored = await readLeaderboardBytes(encoded.root, readPart);
  expect(Buffer.compare(original, restored)).toBe(0);
  expect(JSON.parse(new TextDecoder().decode(restored)).sourceCount).toBe(1);
});

test("missing, changed, reordered and extra parts fail without accepting a partial snapshot", async () => {
  await expect(
    readLeaderboardBytes(encoded.root, async () => new Uint8Array()),
  ).rejects.toThrow("digest mismatch");
  await expect(
    readLeaderboardBytes(encoded.root, async () => {
      throw Error("missing");
    }),
  ).rejects.toThrow("missing");
  const reordered = JSON.parse(new TextDecoder().decode(encoded.root));
  [reordered.parts[0], reordered.parts[1]] = [
    reordered.parts[1],
    reordered.parts[0],
  ];
  await expect(
    readLeaderboardBytes(
      new TextEncoder().encode(JSON.stringify(reordered)),
      readPart,
    ),
  ).rejects.toThrow();
  const extra = JSON.parse(new TextDecoder().decode(encoded.root));
  extra.parts.push(extra.parts[0]);
  let reads = 0;
  await expect(
    readLeaderboardBytes(
      new TextEncoder().encode(JSON.stringify(extra)),
      async () => {
        reads++;
        return new Uint8Array();
      },
    ),
  ).rejects.toThrow();
  expect(reads).toBe(0);
});

test("manifest cannot fetch outside the fixed part namespace or exceed existing aggregate limit", async () => {
  for (const path of [
    "https://other.invalid/a",
    "/data/leaderboard/../../secret",
    "/data/other.part",
  ]) {
    const index = JSON.parse(new TextDecoder().decode(encoded.root));
    index.parts[0].path = path;
    let read = false;
    await expect(
      readLeaderboardBytes(
        new TextEncoder().encode(JSON.stringify(index)),
        async () => {
          read = true;
          return new Uint8Array();
        },
      ),
    ).rejects.toThrow();
    expect(read).toBe(false);
  }
  expect(() =>
    encodeLeaderboardParts(new Uint8Array(MAX_LEADERBOARD_BYTES + 1)),
  ).toThrow();
});

test("publication and local consumers preserve original digest and support rebuilding a sharded snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "slop-leaderboard-parts-"));
  const path = join(dir, "data/leaderboard.json");
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(join(dir, "index.html"), "<!doctype html>");
    await writeFile(join(dir, "skill-manifest.json"), "{}");
    await writeFile(path, original);
    await expect(createDistManifest(dir)).rejects.toThrow(
      "26214400-byte bound",
    );
    await prepareLeaderboardTransport(path);
    expect(
      (await createDistManifest(dir)).files.every(
        (file) => file.bytes <= MAX_LEADERBOARD_FILE_BYTES,
      ),
    ).toBe(true);
    expect(Buffer.compare(await readLeaderboardFile(path), original)).toBe(0);
    const root = await readFile(path);
    await prepareLeaderboardTransport(path);
    expect(Buffer.compare(await readFile(path), root)).toBe(0);
    const small = new TextEncoder().encode('{ "legacy": true }\n');
    await writeFile(path, small);
    await prepareLeaderboardTransport(path);
    expect(Buffer.compare(await readLeaderboardFile(path), small)).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
