/**
 * Publishes public/data/standings.json from the prepared leaderboard snapshot
 * and cycle index, so the contributor and project pages can read their few
 * values without downloading the complete snapshot.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertCycleIndex } from "../src/lib/cycle-index";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { sha256Hex } from "../src/lib/sha256";
import {
  assertPublishedStandings,
  createPublishedStandings,
  MAX_STANDINGS_BYTES,
} from "../src/lib/standings";
import { readLeaderboardFile } from "./leaderboard-files.mjs";

export const STANDINGS_PATHS = {
  leaderboard: "public/data/leaderboard.json",
  cycles: "public/data/cycles/index.json",
  output: "public/data/standings.json",
};

export async function generateStandings(paths = STANDINGS_PATHS) {
  const bytes = await readLeaderboardFile(paths.leaderboard);
  const snapshot: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  );
  assertLeaderboardSnapshot(snapshot);
  const cycleIndex: unknown = JSON.parse(await readFile(paths.cycles, "utf8"));
  assertCycleIndex(cycleIndex);
  const standings = createPublishedStandings(
    snapshot,
    cycleIndex,
    sha256Hex(bytes),
  );
  const output = `${JSON.stringify(standings)}\n`;
  if (Buffer.byteLength(output) > MAX_STANDINGS_BYTES)
    throw new RangeError("Published standings exceed their size limit");
  // The page refuses anything this validator refuses, so a publication that
  // cannot be read stops here instead of on every profile.
  assertPublishedStandings(JSON.parse(output));
  await mkdir(dirname(paths.output), { recursive: true });
  const temporary = `${paths.output}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, output, { flag: "wx" });
    await rename(temporary, paths.output);
  } finally {
    await rm(temporary, { force: true });
  }
  return {
    snapshotBytes: bytes.length,
    bytes: Buffer.byteLength(output),
    projects: standings.projects.length,
    leaders: standings.leaders.length,
    actors: standings.actors.length,
    penalties: standings.penalties.length,
  };
}

if (import.meta.main) {
  if (process.argv.length > 2) throw new Error("Usage: generate-standings.ts");
  const result = await generateStandings();
  console.log(`[Slop] standings ${JSON.stringify(result)}`);
}
