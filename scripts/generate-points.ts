import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedJson, readBoundedText } from "../src/lib/browser-json";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";
import {
  assertLeaderboardSnapshot,
  ledgerWorkUnitId,
  SCORE_V2_EFFECTIVE_AT,
  type ScoreEvent,
} from "../src/lib/leaderboard";
import { payoutPointAwards } from "../src/lib/payout-points";
import {
  appendPointAwards,
  applyPointsSnapshot,
  assemblePoints,
  assertPointsJournal,
  awardForScore,
  latestPoints,
  type PointAward,
  type PointsIndex,
  type PointsJournal,
  type PointsMember,
  pointMembers,
  pointRevisionId,
  reconcilePointPenalties,
  retainedBatchOwnedKeys,
} from "../src/lib/points";
import type { PointsSummary } from "../src/lib/points-summary";
import { findHistoricalRepository, findProject } from "../src/lib/projects.mjs";
import { readLeaderboardFile } from "./leaderboard-files.mjs";
import { syncCycleIndex } from "./sync-cycle-index";

function hash(s: string) {
  return createHash("sha256").update(s).digest("hex");
}
type PointsOrigin = "https://slop.cash" | "https://staging.slop.cash";

async function loadPublishedProjection(
  origin: PointsOrigin,
  indexResponse?: Response,
): Promise<PointsJournal> {
  indexResponse ??= await fetch(`${origin}/data/points.json`, {
    signal: AbortSignal.timeout(30000),
    cache: "no-store",
  });
  if (!indexResponse.ok)
    throw new Error("Published points projection unavailable");
  const index = (await readBoundedJson(
    indexResponse,
    1024 * 1024,
    "points index",
  )) as PointsIndex;
  if (!Array.isArray(index.shards) || index.shards.length !== 16)
    throw new Error("Invalid published points index");
  const parts = await Promise.all(
    index.shards.map(async (shard, i) => {
      if (shard.path !== `/data/points/${i.toString(16)}.json`)
        throw new Error("Invalid published points shard path");
      const response = await fetch(`${origin}${shard.path}`, {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Published points history unavailable");
      return readBoundedText(response, 8 * 1024 * 1024, "points shard");
    }),
  );
  return assemblePoints(index, parts);
}

export async function loadPublishedPoints(
  bootstrap = false,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  origin: PointsOrigin = "https://slop.cash",
): Promise<PointsJournal | null> {
  let cursor: number | null = 0;
  let batch: string | undefined;
  let journal: PointsJournal | undefined;
  do {
    const url = new URL(`${origin}/api/v1/points/journal`);
    url.searchParams.set("after", String(cursor));
    if (batch) url.searchParams.set("batch", batch);
    let response: Response;
    let value: Record<string, unknown>;
    for (let attempt = 0; ; attempt++) {
      response = await fetch(url, {
        signal: AbortSignal.timeout(30000),
        headers: { Accept: "application/json" },
      });
      value = (await readBoundedJson(
        response,
        8 * 1024 * 1024,
        "published points",
      )) as Record<string, unknown>;
      // Retry only the known transient database refusal, at the same cursor
      // and batch. Three 30-second requests plus two 15-second waits at most.
      if (
        response.status !== 503 ||
        value.error !== "points_unavailable" ||
        attempt === 2
      )
        break;
      await wait(15000);
    }
    // Staging has historically published its journal in Pages without a D1
    // checkpoint. Retain that complete, validated staging snapshot, rather
    // than importing production awards for a different project inventory.
    if (
      origin === "https://staging.slop.cash" &&
      cursor === 0 &&
      response.status === 503 &&
      value.error === "points_not_published"
    ) {
      const existing = await fetch(`${origin}/data/points.json`, {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      if (bootstrap && existing.status === 404) {
        await existing.body?.cancel();
        return null;
      }
      return loadPublishedProjection(origin, existing);
    }
    if (
      bootstrap &&
      cursor === 0 &&
      [404, 503].includes(response.status) &&
      ["points_not_published", "not_found"].includes(String(value.error))
    ) {
      const existing = await fetch(`${origin}/data/points.json`, {
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
      await existing.body?.cancel();
      if (existing.status !== 404)
        throw new Error(
          "Refusing bootstrap: published points may already exist",
        );
      return null;
    }
    if (!response.ok)
      throw new Error(
        `Points history returned ${response.status}; refusing to discard history`,
      );
    if (
      typeof value.batch !== "string" ||
      !Array.isArray(value.revisions) ||
      !Number.isSafeInteger(value.total) ||
      Number(value.total) > 250000
    )
      throw new Error("Invalid points history page");
    if (batch && batch !== value.batch)
      throw new Error("Points batch changed during pagination");
    batch = value.batch;
    journal ??= {
      schemaVersion: "1",
      ruleVersion: "slop-points-v1",
      generatedAt: value.generatedAt as string,
      coverage: value.coverage as PointsJournal["coverage"],
      revisions: [],
    };
    journal.revisions.push(...value.revisions);
    if (
      value.next !== null &&
      (!Number.isSafeInteger(value.next) ||
        Number(value.next) <= Number(cursor))
    )
      throw new Error("Invalid points history cursor");
    cursor = value.next as number | null;
    if (cursor === null && journal.revisions.length !== value.total)
      throw new Error("Incomplete points history");
  } while (cursor !== null);
  if (!journal) throw new Error("Missing points history");
  assertPointsJournal(journal);
  if (hash(JSON.stringify(journal)) !== batch)
    throw new Error("Points batch digest mismatch");
  // Scheduled refreshes have Pages-only authority. Retain their published journal
  // as well as the latest protected-release D1 checkpoint; neither may fork history.
  return retainPublishedHistory(journal, await loadPublishedProjection(origin));
}
export function retainPublishedHistory(
  checkpoint: PointsJournal,
  published: PointsJournal,
): PointsJournal {
  assertPointsJournal(checkpoint);
  assertPointsJournal(published);
  const [earlier, later] =
    checkpoint.revisions.length > published.revisions.length
      ? [published, checkpoint]
      : [checkpoint, published];
  if (
    earlier.revisions.some(
      (revision, i) => later.revisions[i]?.id !== revision.id,
    )
  )
    throw new Error("Published points history diverged from its checkpoint");
  return later;
}
export function pointsSql(journal: PointsJournal): string {
  assertPointsJournal(journal);
  const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  const digest = hash(JSON.stringify(journal));
  const statements = journal.revisions.map(
    (r, sequence) =>
      `INSERT INTO points_staging(batch_id,sequence,payload) VALUES(${quote(digest)},${sequence},${quote(JSON.stringify(r))}) ON CONFLICT(batch_id,sequence) DO NOTHING;`,
  );
  // Coverage is staged one entry per statement so the batch statement stays
  // within D1's 100 KB statement limit however long coverage grows.
  for (const [sequence, entry] of journal.coverage.entries())
    statements.push(
      `INSERT INTO points_coverage_staging(batch_id,sequence,entry) VALUES(${quote(digest)},${sequence},${quote(JSON.stringify(entry))}) ON CONFLICT(batch_id,sequence) DO NOTHING;`,
    );
  statements.push(
    // Skip the insert before its BEFORE trigger runs. A known older batch is
    // an idempotent replay, not a new candidate with a shorter history.
    // Incomplete staged coverage yields NULL, which the NOT NULL column rejects.
    `INSERT INTO points_batches(digest,generated_at,coverage,revision_count) SELECT ${quote(digest)},${quote(journal.generatedAt)},(SELECT CASE WHEN COUNT(*)=${journal.coverage.length} THEN json_group_array(json(entry)) END FROM (SELECT entry FROM points_coverage_staging WHERE batch_id=${quote(digest)} ORDER BY sequence)),${journal.revisions.length} WHERE NOT EXISTS (SELECT 1 FROM points_batches WHERE digest=${quote(digest)});`,
    // Replayed batches skip the AFTER INSERT triggers that normally clear staging.
    `DELETE FROM points_staging WHERE batch_id=${quote(digest)} AND EXISTS (SELECT 1 FROM points_batches WHERE digest=${quote(digest)});`,
    `DELETE FROM points_coverage_staging WHERE batch_id=${quote(digest)} AND EXISTS (SELECT 1 FROM points_batches WHERE digest=${quote(digest)});`,
  );
  return statements.join("\n") + "\n";
}
async function archivePaths(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const e of entries) {
    if (e.isDirectory())
      paths.push(...(await archivePaths(join(directory, e.name))));
    else if (e.name === "source-snapshot.json")
      paths.push(join(directory, e.name));
  }
  return paths;
}
/**
 * Awards from the retained review history and the evaluator manifests are
 * supplied only by those files, so a maintainer who deletes or excludes an
 * entry supplies no replacement award and the prior positive revision would
 * remain latest forever. Reconcile such a removal with one zero-valued
 * successor, but only for an award proven to originate from this batch.
 * Presence in a snapshot proves nothing: the leaderboard generator injects
 * these same retained events into its snapshot ledgers, so a snapshot copy
 * is a downstream copy of this batch, not an independent source, and an
 * archived snapshot copy must not suppress a correction forever. Ownership
 * is therefore read from the latest revision's durable provenance, never
 * from the snapshots a single run happens to read and never from earlier
 * revisions in the chain. A snapshot application records its digest in
 * the journal coverage when it appends a revision, while a batch append
 * never records coverage. An award is batch-owned when its latest
 * revision carries the batch rule with a digest absent from the coverage.
 * A snapshot-owned award is never zeroed here, even when the snapshot
 * that supplied it is absent from this run's inputs; snapshot corrections
 * stay with applyPointsSnapshot. An already-zero latest award needs no
 * successor, so replaying the same inputs appends nothing. Removing a whole
 * project from the registry also removes its manifests, but that is not a
 * maintainer revocation: an award of a project that is no longer listed keeps
 * its last recorded amount.
 */
export function retainedHistoryCorrections(
  journal: PointsJournal,
  currentAwards: PointAward[],
): PointAward[] {
  const currentKeys = new Set(currentAwards.map((a) => a.key));
  const latest = latestPoints(journal);
  const corrections: PointAward[] = [];
  for (const key of retainedBatchOwnedKeys(journal)) {
    const award = latest.get(key)?.award;
    if (award && !currentKeys.has(key) && findProject(award.projectId) !== null)
      corrections.push({ ...award, amount: 0 });
  }
  return corrections;
}

// #857 retired the evaluator manifests, without revoking their awards. The
// published journal's first batch after the projects returned erroneously
// zeroed eleven of them. Identify that exact batch, not arbitrary later zeroes.
const EVALUATIONS_RETIRED_AT = "2026-10-19T01:22:36.000Z";
const RETIREMENT_ZEROED_AT = "2026-10-20T05:30:25.870Z";
const RETIREMENT_ZERO_DIGEST =
  "782097740ab32fa43352c9b7d43b34cc4586f8611068c40a9cddcc58edc9aa37";
// Recovery gets distinct durable provenance so a subsequent maintainer decision
// (including a zero or an unchanged explicit award) ends retirement protection.
const RETIREMENT_RECOVERY_DIGEST = hash(
  `retired-evaluator-recovery-v1:${RETIREMENT_ZERO_DIGEST}`,
);

export function retiredEvaluatorAwards(journal: PointsJournal): PointAward[] {
  const retained = new Map<string, { award: PointAward; latestId: string }>();
  for (const revision of journal.revisions) {
    const { award } = revision;
    if (award.category !== "evaluated-contribution") continue;
    if (revision.recordedAt < EVALUATIONS_RETIRED_AT) {
      retained.set(award.key, { award, latestId: revision.id });
      continue;
    }
    const prior = retained.get(award.key);
    if (!prior) continue;
    const erroneousZero =
      revision.recordedAt === RETIREMENT_ZEROED_AT &&
      revision.sourceDigest === RETIREMENT_ZERO_DIGEST &&
      revision.sourceRule === "slop-score-v2" &&
      JSON.stringify(award) === JSON.stringify({ ...prior.award, amount: 0 });
    const recovery =
      revision.sourceDigest === RETIREMENT_RECOVERY_DIGEST &&
      revision.sourceRule === "slop-score-v2" &&
      JSON.stringify(award) === JSON.stringify(prior.award);
    if (revision.previous === prior.latestId && (erroneousZero || recovery))
      prior.latestId = revision.id;
    else retained.delete(award.key);
  }
  return [...retained.values()].map(({ award }) => award);
}

/**
 * Applies the retained history batch in full: the supplied awards, the
 * removal corrections they imply, and explicit source provenance.
 * generatePoints applies snapshots before this batch, and a snapshot
 * ledger can contain the identical retained award (the leaderboard
 * generator injects the retained events into its snapshots). In that
 * order appendPointAwards correctly appends no revision for the identical
 * award, so without a further record the journal's only provenance for
 * the award is the snapshot digest in the coverage, and a later removal
 * from the retained manifest can never be corrected. When the latest
 * revision of a supplied award is snapshot-sourced for exactly this
 * reason, this function appends one provenance successor: the same award,
 * unchanged, recorded with the batch digest and the batch rule. The
 * latest revision then proves batch ownership durably, independently of
 * ingestion order, in every later run. Replaying the same batch appends
 * nothing, because the latest revision already carries batch provenance.
 */
export function applyRetainedHistoryBatch(
  journal: PointsJournal,
  awards: PointAward[],
  sourceDigest: string,
  recordedAt: string,
): PointsJournal {
  const retired = retiredEvaluatorAwards(journal);
  const supplied = new Set(awards.map((award) => award.key));
  const retiredKeys = new Set(retired.map((award) => award.key));
  const priorIds = new Set(
    [...latestPoints(journal).values()]
      .filter((revision) => retiredKeys.has(revision.award.key))
      .map((revision) => revision.id),
  );
  const recovered = appendPointAwards(
    journal,
    retired.filter((award) => !supplied.has(award.key)),
    RETIREMENT_RECOVERY_DIGEST,
    "slop-score-v2",
    recordedAt,
  );
  let result = appendPointAwards(
    recovered,
    [
      ...awards,
      ...retainedHistoryCorrections(recovered, [...awards, ...retired]),
    ],
    sourceDigest,
    "slop-score-v2",
    recordedAt,
  );
  const coverageDigests = new Set(result.coverage.map((c) => c.digest));
  const latest = latestPoints(result);
  const confirmations = [...awards]
    .sort((a, b) => a.key.localeCompare(b.key))
    .filter((award) => {
      const revision = latest.get(award.key);
      return (
        award.amount > 0 &&
        (award.category === "substantive-review" ||
          award.category === "evaluated-contribution") &&
        revision !== undefined &&
        JSON.stringify(revision.award) === JSON.stringify(award) &&
        (coverageDigests.has(revision.sourceDigest) ||
          priorIds.has(revision.id))
      );
    });
  if (confirmations.length) {
    const output = { ...result, revisions: [...result.revisions] };
    for (const award of confirmations) {
      const previous = latest.get(award.key);
      if (!previous) continue;
      const revision = {
        previous: previous.id,
        recordedAt,
        sourceDigest,
        sourceRule: "slop-score-v2",
        award,
      };
      const next = { id: pointRevisionId(revision), ...revision };
      output.revisions.push(next);
      latest.set(award.key, next);
    }
    assertPointsJournal(output);
    result = output;
  }
  return result;
}

/**
 * Converts retained review and evaluator events to point awards as the
 * published snapshot ledger records them. The leaderboard gives a v2 event
 * without a work unit the work unit from ledgerWorkUnitId, and evaluator
 * award events never carry one. If this batch used a different work unit,
 * the batch award and the snapshot award of the same event would differ.
 * Then each run with a new snapshot would append two revisions for each
 * such award in the rolling window, and the replay would never be idempotent.
 */
export function retainedHistoryAwards(events: ScoreEvent[]): PointAward[] {
  return events.map((event) => {
    if (Date.parse(event.occurredAt) < Date.parse(SCORE_V2_EFFECTIVE_AT))
      return awardForScore(event);
    // Retained history may name a project removed from the registry.
    const projectId = findHistoricalRepository(event.repository)?.projectId;
    if (!projectId)
      throw new Error(
        `Score event repository is not registered: ${event.repository}`,
      );
    return awardForScore({
      ...event,
      workUnitId: ledgerWorkUnitId(projectId, event),
    });
  });
}

/** Every contributor's all-time total, derived from the same journal. */
export function pointsSummary(
  journal: PointsJournal,
  members: readonly PointsMember[],
  indexDigest: string,
): PointsSummary {
  const ranked = members
    .filter((member) => member.total > 0)
    .sort((a, b) => b.total - a.total || a.actor.id.localeCompare(b.actor.id));
  return {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    indexDigest,
    totals: {
      contributors: ranked.length,
      points: ranked.reduce((sum, member) => sum + member.total, 0),
    },
    contributors: ranked.map((member) => ({
      actor: { id: member.actor.id, login: member.actor.login },
      total: member.total,
    })),
  };
}

export async function generatePoints(
  options: {
    online?: boolean;
    bootstrap?: boolean;
    origin?: PointsOrigin;
  } = {},
) {
  const history: unknown = JSON.parse(
    await readFile("data/points/history.json", "utf8"),
  );
  assertPointsJournal(history);
  let journal: PointsJournal = history;
  const published = options.online
    ? await loadPublishedPoints(options.bootstrap, undefined, options.origin)
    : null;
  if (published) {
    // The checked-in history is an ancestor, never a second award source.
    const ids = new Set(published.revisions.map((r) => r.id));
    if (history.revisions.some((r) => !ids.has(r.id)))
      throw new Error(
        "Published points history diverges from checked-in backfill",
      );
    journal = published;
  }
  const now = new Date().toISOString();
  const snapshots = [];
  for (const path of [
    ...(await archivePaths("cycles")),
    "public/data/leaderboard.json",
  ]) {
    const bytes = new TextDecoder("utf-8", { fatal: true }).decode(
      await readLeaderboardFile(path),
    );
    const snapshot: unknown = JSON.parse(bytes);
    assertLeaderboardSnapshot(snapshot);
    snapshots.push({ snapshot, digest: hash(bytes) });
  }
  snapshots.sort((a, b) =>
    a.snapshot.generatedAt.localeCompare(b.snapshot.generatedAt),
  );
  // Replaying an older archive after a newer batch must not roll back corrections.
  const applied = new Set(journal.coverage.map((c) => c.digest));
  for (const { snapshot, digest } of snapshots) {
    if (!applied.has(digest))
      journal = applyPointsSnapshot(journal, snapshot, digest, now);
  }
  const cycles = await syncCycleIndex({
    checkOnly: true,
    generatedAt: now,
  });
  journal = appendPointAwards(
    journal,
    payoutPointAwards(cycles),
    hash(JSON.stringify(cycles)),
    "verified-payout-v1",
    now,
  );
  const evaluations = loadEvaluatorAwardEvents();
  const reviews = JSON.parse(
    await readFile("data/accepted-review-history.json", "utf8"),
  );
  // The history file is the only source for these awards, so a maintainer
  // correction to it must reach the journal. appendPointAwards already skips
  // an award identical to the latest revision and appends a successor
  // revision for a changed one; filtering by existing keys here would drop
  // every correction silently and freeze the first recorded amount forever.
  const reviewed = [...reviews.events, ...evaluations];
  const reviewedAwards = retainedHistoryAwards(reviewed);
  // Snapshots were applied above, so an identical retained award may
  // already carry snapshot provenance; applyRetainedHistoryBatch persists
  // explicit batch provenance for it and reconciles removals.
  journal = applyRetainedHistoryBatch(
    journal,
    reviewedAwards,
    hash(JSON.stringify(reviewed)),
    now,
  );
  journal = reconcilePointPenalties(
    journal,
    hash(JSON.stringify(reviewed)),
    now,
  );
  journal.generatedAt = now;
  assertPointsJournal(journal);
  await mkdir("public/data", { recursive: true });
  await mkdir("public/data/points", { recursive: true });
  const index: PointsIndex = {
    schemaVersion: "1",
    ruleVersion: journal.ruleVersion,
    generatedAt: journal.generatedAt,
    coverage: journal.coverage,
    revisionCount: journal.revisions.length,
    shards: [],
  };
  for (let i = 0; i < 16; i++) {
    const name = i.toString(16);
    const rows = journal.revisions
      .map((revision, sequence) => ({ sequence, revision }))
      .filter((r) => r.revision.award.key.startsWith(name));
    const bytes = JSON.stringify(rows) + "\n";
    if (Buffer.byteLength(bytes) > 8 * 1024 * 1024)
      throw new Error("Points shard exceeds size limit");
    await writeFile(`public/data/points/${name}.json`, bytes);
    index.shards.push({
      path: `/data/points/${name}.json`,
      sha256: hash(bytes),
      count: rows.length,
    });
  }
  await writeFile("public/data/points.json.tmp", JSON.stringify(index) + "\n");
  await rename("public/data/points.json.tmp", "public/data/points.json");
  await mkdir(".points-build", { recursive: true });
  await writeFile(".points-build/import.sql", pointsSql(journal));
  const members = pointMembers(journal);
  // The home page ranks the top contributors from this small summary instead
  // of downloading every shard of the journal.
  const summary = pointsSummary(journal, members, hash(JSON.stringify(index)));
  await writeFile(
    "public/data/points-summary.json.tmp",
    JSON.stringify(summary) + "\n",
  );
  await rename(
    "public/data/points-summary.json.tmp",
    "public/data/points-summary.json",
  );
  await writeFile(
    ".points-build/report.json",
    JSON.stringify(
      {
        generatedAt: now,
        revisionCount: journal.revisions.length,
        contributors: members.length,
        points: members.reduce((sum, m) => sum + m.total, 0),
        coverage: journal.coverage,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[points] ${members.length} contributors; ${journal.revisions.length} historical revisions`,
  );
  return journal;
}
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((a) => !["--online", "--bootstrap"].includes(a)))
    throw new Error("Usage: generate-points.ts [--online] [--bootstrap]");
  await generatePoints({
    online: args.includes("--online") || process.env.SLOP_POINTS_ONLINE === "1",
    bootstrap:
      args.includes("--bootstrap") || process.env.SLOP_POINTS_BOOTSTRAP === "1",
    origin:
      process.env.VITE_SLOP_ENVIRONMENT === "staging"
        ? "https://staging.slop.cash"
        : "https://slop.cash",
  });
}
