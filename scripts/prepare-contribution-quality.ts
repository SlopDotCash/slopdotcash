/** Import safe metadata; never publish raw patches, comments or private evidence. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  assertQualityEvidence,
  type QualityEvent,
} from "../src/lib/contribution-quality";
import { assertFundingPreparation } from "../src/lib/funding-review-data";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { findProject } from "../src/lib/projects.mjs";

const [preparationPath, snapshotPath, closedPath, basesPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw new Error(
    "Usage: bun scripts/prepare-contribution-quality.ts PREPARATION SNAPSHOT CLOSED_CENSUS MERGE_BASES OUTPUT",
  );
const preparation = assertFundingPreparation(
  JSON.parse(await readFile(preparationPath, "utf8")),
);
const source = await readFile(snapshotPath);
if (
  createHash("sha256").update(source).digest("hex") !==
  preparation.sourceSnapshotSha256
)
  throw new Error("Snapshot hash mismatch");
const snapshot = JSON.parse(source.toString());
assertLeaderboardSnapshot(snapshot);
const project = findProject(preparation.projectId);
if (!project) throw new Error("Unknown project");
const repos = new Map(
  project.repositories.map((repo) => [repo.id, repo.integrationBranch]),
);
const censusBytes = await readFile(closedPath);
const census = JSON.parse(censusBytes.toString());
const bases: { id: string; baseRefName: string }[] = JSON.parse(
  await readFile(basesPath, "utf8"),
);
const byBase = new Map(bases.map((row) => [row.id, row.baseRefName]));
type Closed = {
  id: string;
  url: string;
  title: string;
  createdAt: string;
  closedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  author: { id: string; login: string } | null;
};
const nodes: Closed[] = census.nodes;
if (
  !Array.isArray(nodes) ||
  new Set(nodes.map((row) => row.id)).size !== nodes.length ||
  census.method !== "repository-created-order-v1" ||
  census.projectId !== preparation.projectId ||
  census.cycleId !== preparation.cycleId ||
  !Array.isArray(census.coverage) ||
  census.coverage.length !== repos.size ||
  new Set(census.coverage.map((row: { repository: string }) => row.repository))
    .size !== repos.size ||
  !census.coverage.every(
    (row: {
      repository: string;
      complete: boolean;
      pages: number;
      scanned: number;
    }) =>
      repos.has(row.repository) &&
      row.complete === true &&
      Number.isSafeInteger(row.pages) &&
      row.pages > 0 &&
      Number.isSafeInteger(row.scanned) &&
      row.scanned >= 0,
  )
)
  throw new Error(
    "Incomplete repository connection census; search indexing is not sufficient",
  );
const mergedCount = nodes.filter((row) => row.mergedAt !== null).length;
if (mergedCount !== preparation.provenance.mergedCensus)
  throw new Error(
    `Merged source mismatch: repository lists ${mergedCount}, frozen preparation lists ${preparation.provenance.mergedCensus}. Repair and review the source census before recalculating.`,
  );
const from = preparation.provenance.periodFrom,
  to = preparation.provenance.periodTo;
if (
  nodes.some(
    (row) =>
      !(row.closedAt >= from.slice(0, 19) && row.closedAt < to.slice(0, 19)),
  )
)
  throw new Error("Closure outside cycle");
const byId = new Map(nodes.map((row) => [row.id, row]));
const ledger = snapshot.ledger.filter(
  (event) =>
    repos.has(event.repository) &&
    Date.parse(event.occurredAt) >= Date.parse(from) &&
    Date.parse(event.occurredAt) < Date.parse(to),
);
const events: QualityEvent[] = ledger.map((event) => {
  const merge = event.category === "merged-pull-request";
  const row = byId.get(event.source.id);
  if (merge && (!row?.mergedAt || !byBase.has(row.id)))
    throw new Error(`Missing merged source/base ${event.id}`);
  const flags: string[] = [];
  if (merge && row) {
    if (row.additions + row.deletions === 0)
      flags.push("zero-diff: verify independent outcome");
    else if (row.additions + row.deletions <= 10)
      flags.push("tiny-diff: inspect value, not size");
    if (byBase.get(row.id) !== repos.get(event.repository))
      flags.push("non-integration merge: check duplicate landing");
    if (event.reason.includes("provisional"))
      flags.push("provisional tier: acceptance value unratified");
  }
  if (event.category === "substantive-review")
    flags.push("review: verify actionable finding and response");
  const thirds = event.scoreThirds ?? Math.round(event.points * 3);
  return {
    id: event.id,
    actorId: event.actor.id,
    url: event.source.url,
    title: event.source.title,
    kind: merge
      ? "implementation"
      : event.category === "substantive-review"
        ? "review"
        : "evaluation",
    scoreThirds: thirds,
    weight: (
      BigInt(thirds) * BigInt(10_000 + (event.evidenceBonusBasisPoints ?? 0))
    ).toString(),
    flags,
  };
});
const evidence = assertQualityEvidence(
  {
    schemaVersion: "1",
    projectId: preparation.projectId,
    cycleId: preparation.cycleId,
    sourceSnapshotSha256: preparation.sourceSnapshotSha256,
    closureCensus: {
      method: census.method,
      sourceSha256: createHash("sha256").update(censusBytes).digest("hex"),
      observedAt: census.observedAt,
      discussionSourceSha256: null,
    },
    events,
    closures: nodes
      .filter((row) => !row.mergedAt)
      .map((row) => ({
        id: row.id,
        actorId: row.author?.id ?? null,
        actorLogin: row.author?.login ?? null,
        flags: [],
        url: row.url,
        title: row.title,
        createdInCycle: Date.parse(row.createdAt) >= Date.parse(from),
      })),
  },
  preparation,
);
for (const contributor of preparation.contributors) {
  const ids = events
    .filter((event) => event.actorId === contributor.actor.id)
    .map((event) => event.id)
    .sort();
  if (
    createHash("sha256").update(JSON.stringify(ids)).digest("hex") !==
    contributor.eventIdsSha256
  )
    throw new Error("Actor event IDs do not reconcile");
}
await writeFile(outputPath, `${JSON.stringify(evidence)}\n`, { flag: "wx" });
console.log(
  `Prepared ${events.length} scored events, ${evidence.closures.length} unmerged closures; no decisions or payments applied.`,
);
