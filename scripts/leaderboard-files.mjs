import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  MAX_LEADERBOARD_BYTES,
  MAX_LEADERBOARD_PART_BYTES,
  readLeaderboardBytes,
} from "../src/lib/leaderboard-transport.mjs";

async function boundedFile(path, limit) {
  if ((await stat(path)).size > limit)
    throw new RangeError("Leaderboard file exceeds its transport limit");
  const bytes = await readFile(path);
  if (bytes.length > limit)
    throw new RangeError("Leaderboard file exceeds its transport limit");
  return bytes;
}

/** Return the exact logical snapshot bytes, preserving Points and allocation digests. */
export async function readLeaderboardFile(path) {
  return readLeaderboardBytes(
    await boundedFile(path, MAX_LEADERBOARD_BYTES),
    (part) =>
      boundedFile(
        join(dirname(path), part.slice("/data/".length)),
        MAX_LEADERBOARD_PART_BYTES,
      ),
  );
}
