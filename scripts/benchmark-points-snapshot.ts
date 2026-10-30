/** Offline replay timing; use the same validated inputs on both revisions. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { LeaderboardSnapshot } from "../src/lib/leaderboard";
import { applyPointsSnapshot, type PointsJournal } from "../src/lib/points";
import { readLeaderboardFile } from "./leaderboard-files.mjs";

if (process.argv.length !== 4)
  throw new Error(
    "Usage: benchmark-points-snapshot.ts <journal.json> <leaderboard.json>",
  );
const journalText = await readFile(process.argv[2], "utf8");
const snapshotBytes = await readLeaderboardFile(process.argv[3]);
const snapshot = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(snapshotBytes),
) as LeaderboardSnapshot;
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const snapshotDigest = digest(snapshotBytes);
const times: number[] = [];
let resultDigest = "";
let resultRevisions = 0;
for (let run = 0; run < 7; run++) {
  const journal = JSON.parse(journalText) as PointsJournal;
  const started = performance.now();
  const result = applyPointsSnapshot(
    journal,
    snapshot,
    snapshotDigest,
    snapshot.generatedAt,
  );
  const elapsed = performance.now() - started;
  const current = digest(JSON.stringify(result));
  if (resultDigest && current !== resultDigest)
    throw new Error("Points replay changed between timing samples");
  resultDigest = current;
  resultRevisions = result.revisions.length;
  // Keep parsing, output hashing and the first warm-up out of the samples.
  if (run > 0) times.push(elapsed);
}
const ordered = [...times].sort((left, right) => left - right);
console.log(
  JSON.stringify(
    {
      journalDigest: digest(journalText),
      snapshotDigest,
      resultDigest,
      resultRevisions,
      timesMs: times,
      medianMs: (ordered[2] + ordered[3]) / 2,
    },
    null,
    2,
  ),
);
