/** Reassemble a leaderboard from a restored data directory (manifest plus
 * parts), with the same checks as the published-snapshot download. */
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MAX_LEADERBOARD_BYTES,
  MAX_LEADERBOARD_PART_BYTES,
  readLeaderboardBytes,
} from "../src/lib/leaderboard-transport.mjs";

async function bounded(path: string, maximum: number) {
  const info = await stat(path);
  if (!info.isFile() || info.size > maximum)
    throw new RangeError("Restored leaderboard file exceeds its bound");
  return new Uint8Array(await readFile(path));
}

export async function readLocalLeaderboard(directory: string, output: string) {
  const root = await bounded(
    join(directory, "leaderboard.json"),
    MAX_LEADERBOARD_BYTES,
  );
  const bytes = await readLeaderboardBytes(root, async (path: string) => {
    const match = /^\/data\/leaderboard\/([a-f0-9]{64})\.part$/.exec(path);
    if (!match) throw new Error("Invalid restored leaderboard part path");
    return bounded(
      join(directory, "leaderboard", `${match[1]}.part`),
      MAX_LEADERBOARD_PART_BYTES,
    );
  });
  const target = resolve(output);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes.byteLength;
}

if (import.meta.main) {
  if (process.argv.length !== 4)
    throw new Error("Usage: read-local-leaderboard.ts <data dir> <output>");
  const bytes = await readLocalLeaderboard(process.argv[2], process.argv[3]);
  console.log(`[Slop] restored ${bytes} collected leaderboard bytes`);
}
