import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeLeaderboardParts } from "../src/lib/leaderboard-transport.mjs";
import { readLocalLeaderboard } from "./read-local-leaderboard";

async function restored(bytes: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "collected-"));
  await mkdir(join(dir, "leaderboard"));
  const { root, parts } = encodeLeaderboardParts(bytes);
  await writeFile(join(dir, "leaderboard.json"), root);
  for (const part of parts)
    await writeFile(join(dir, part.path.replace("/data/", "")), part.bytes);
  return { dir, parts };
}

describe("restored collected leaderboard", () => {
  test("reassembles the exact bytes of a split ledger", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ filler: "x".repeat(26 * 1024 * 1024) }),
    );
    const { dir, parts } = await restored(bytes);
    expect(parts.length).toBeGreaterThan(1);
    const out = join(dir, "out.json");
    await readLocalLeaderboard(dir, out);
    expect(Buffer.compare(await readFile(out), Buffer.from(bytes))).toBe(0);
  });

  test("refuses a part whose bytes do not match the manifest", async () => {
    const bytes = new TextEncoder().encode(
      JSON.stringify({ filler: "y".repeat(26 * 1024 * 1024) }),
    );
    const { dir, parts } = await restored(bytes);
    const tampered = new Uint8Array(parts[0].bytes);
    tampered[0] ^= 1;
    await writeFile(join(dir, parts[0].path.replace("/data/", "")), tampered);
    await expect(
      readLocalLeaderboard(dir, join(dir, "out.json")),
    ).rejects.toThrow();
  });

  test("passes a small single-file ledger through unchanged", async () => {
    const bytes = new TextEncoder().encode(
      '{"generatedAt":"2026-11-18T00:00:00.000Z"}\n',
    );
    const { dir } = await restored(bytes);
    const out = join(dir, "out.json");
    await readLocalLeaderboard(dir, out);
    expect(await readFile(out, "utf8")).toBe(new TextDecoder().decode(bytes));
  });
});
