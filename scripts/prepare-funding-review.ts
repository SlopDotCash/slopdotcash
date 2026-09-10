/** Explicit snapshot import followed by deterministic, offline preparation sync. */
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertFundingPreparation,
  assertFundingReviewIndex,
  createFundingReview,
  exactRecord,
  type FundingPreparation,
  type FundingReviewIndex,
} from "../src/lib/funding-review-data";
import { assertLeaderboardSnapshot } from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const fundingReviewSha256 = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
async function jsonFile(path: string, max = 4 * 1024 * 1024) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max)
    throw new TypeError(`Invalid preparation source: ${path}`);
  const bytes = await readFile(path);
  return {
    bytes,
    sha256: fundingReviewSha256(bytes),
    value: JSON.parse(bytes.toString()) as unknown,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid source object");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Invalid source array");
  return value;
}
/** Raw audit/source never enter the public tree. Only the validated projection does. */
export async function importFundingPreparations(options: {
  snapshot: string;
  audit: string;
  wallets: string;
  cycleId: string;
}): Promise<FundingPreparation[]> {
  const [source, auditFile, observations] = await Promise.all([
    jsonFile(options.snapshot, 64 * 1024 * 1024),
    jsonFile(options.audit, 16 * 1024 * 1024),
    jsonFile(options.wallets),
  ]);
  assertLeaderboardSnapshot(source.value);
  const snapshot = source.value;
  const audit = exactRecord(auditFile.value, "window,source,projects");
  const observed = exactRecord(
    observations.value,
    "observedAt,sourceSnapshotSha256,wallets",
  );
  if (
    observed.sourceSnapshotSha256 !== source.sha256 ||
    JSON.stringify(audit.source) !== JSON.stringify(snapshot.source) ||
    JSON.stringify(audit.window) !== JSON.stringify(snapshot.window) ||
    snapshot.stale ||
    snapshot.source.evidenceVerification.status !== "complete"
  )
    throw new TypeError(
      "Audit, complete snapshot and wallet source do not agree",
    );
  const wallets = new Map<string, Record<string, unknown>>();
  for (const raw of array(observed.wallets)) {
    const w = exactRecord(raw, "actor,status,wallet,observedAt,cycleLocked");
    const actor = object(w.actor);
    if (
      typeof actor.id !== "string" ||
      wallets.has(actor.id) ||
      w.cycleLocked !== false ||
      w.observedAt !== observed.observedAt ||
      !["missing", "registered", "lookup-unavailable"].includes(
        String(w.status),
      ) ||
      (w.status !== "registered") !== (w.wallet === null)
    )
      throw new TypeError("Invalid or duplicate wallet observation");
    wallets.set(actor.id, w);
  }
  const inputs: FundingPreparation[] = [];
  const projectIds = new Set<string>();
  const actorIds = new Set<string>();
  for (const raw of array(audit.projects)) {
    const p = exactRecord(
      raw,
      "project,window,mergedCensus,scoredMerges,unscoredMerges,totalScoreThirds,contributors",
    );
    if (typeof p.project !== "string" || projectIds.has(p.project))
      throw new TypeError("Duplicate audit project");
    projectIds.add(p.project);
    const view = createProjectView(snapshot, p.project, options.cycleId);
    if (
      view.cycle.status !== "closed" ||
      view.cycle.to !== view.cycle.endsAt ||
      JSON.stringify(p.window) !== JSON.stringify(view.cycle)
    )
      throw new TypeError(
        "Snapshot does not cover a complete canonical project period",
      );
    const auditRows = array(p.contributors).map(object);
    if (auditRows.length !== view.leaders.length)
      throw new TypeError("Audit contributor census mismatch");
    const contributors = view.leaders.map((leader) => {
      const matches = auditRows.filter(
        (r) => object(r.actor).id === leader.actor.id,
      );
      const row = matches[0];
      const events = view.ledger
        .filter((e) => e.actor.id === leader.actor.id)
        .map((e) => e.id)
        .sort();
      if (
        matches.length !== 1 ||
        object(row.actor).login !== leader.actor.login ||
        row.scoreThirds !== leader.scoreThirds ||
        row.weight !== leader.adjustedWeight ||
        !Number.isSafeInteger(leader.scoreThirds) ||
        !Number.isSafeInteger(leader.adjustedWeight) ||
        row.eventCount !== events.length ||
        JSON.stringify(array(row.eventIds).slice().sort()) !==
          JSON.stringify(events)
      )
        throw new TypeError("Audit score, weight or event provenance mismatch");
      const w = wallets.get(leader.actor.id);
      if (!w || object(w.actor).login !== leader.actor.login)
        throw new TypeError("Missing explicit wallet observation");
      actorIds.add(leader.actor.id);
      return {
        actor: { id: leader.actor.id, login: leader.actor.login },
        scoreThirds: String(leader.scoreThirds),
        weight: String(leader.adjustedWeight),
        eventCount: events.length,
        eventIdsSha256: fundingReviewSha256(JSON.stringify(events)),
        wallet: w.wallet,
        lookupUnavailable: w.status === "lookup-unavailable",
      };
    });
    const totalScore = contributors
      .reduce((s, r) => s + BigInt(r.scoreThirds), 0n)
      .toString();
    const scoredMerges = view.ledger.filter(
      (e) => e.category === "merged-pull-request",
    ).length;
    if (
      String(p.totalScoreThirds) !== totalScore ||
      p.scoredMerges !== scoredMerges ||
      Number(p.mergedCensus) !== scoredMerges + array(p.unscoredMerges).length
    )
      throw new TypeError("Audit merge census mismatch");
    inputs.push(
      assertFundingPreparation({
        projectId: p.project,
        cycleId: options.cycleId,
        sourceSnapshotSha256: source.sha256,
        sourceAuditSha256: auditFile.sha256,
        observedAt: observed.observedAt,
        provenance: {
          ruleVersion: snapshot.ruleVersion,
          walletObservationsSha256: observations.sha256,
          snapshotFrom: snapshot.window.from,
          snapshotTo: snapshot.window.to,
          periodFrom: view.cycle.from,
          periodTo: view.cycle.to,
          snapshotLedgerCount: snapshot.ledger.length,
          sourceMergedPullRequests: snapshot.source.counts.mergedPullRequests,
          mergedCensus: p.mergedCensus,
          scoredMerges: p.scoredMerges,
        },
        counts: {
          contributors: contributors.length,
          events: contributors.reduce((s, r) => s + r.eventCount, 0),
          scoreThirds: totalScore,
          weight: contributors
            .reduce((s, r) => s + BigInt(r.weight), 0n)
            .toString(),
        },
        contributors,
      }),
    );
  }
  if (wallets.size !== actorIds.size)
    throw new TypeError("Wallet census contains unmatched actors");
  return inputs;
}
export async function buildFundingReviewIndex(
  root = ROOT,
): Promise<FundingReviewIndex> {
  const inputRoot = join(root, "funding/preparations");
  const entries = await readdir(inputRoot, { withFileTypes: true });
  const inputs: FundingPreparation[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "README.md" && entry.isFile()) continue;
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !/^[a-z0-9-]+\.json$/u.test(entry.name)
    )
      throw new TypeError("Unexpected preparation input");
    const input = assertFundingPreparation(
      (await jsonFile(join(inputRoot, entry.name))).value,
    );
    if (entry.name !== `${input.projectId}-${input.cycleId}.json`)
      throw new TypeError("Noncanonical preparation filename");
    inputs.push(input);
  }
  // Source observation time makes identical tracked inputs byte-reproducible.
  return assertFundingReviewIndex({
    schemaVersion: "1",
    generatedAt:
      inputs
        .map((i) => i.observedAt)
        .sort()
        .at(-1) ?? "1970-01-01T00:00:00.000Z",
    reviews: inputs.map(createFundingReview),
  });
}
export async function syncFundingReviews(
  root = ROOT,
  check = false,
): Promise<void> {
  const output = join(root, "public/data/funding-reviews.json");
  const bytes = `${JSON.stringify(await buildFundingReviewIndex(root), null, 2)}\n`;
  if (check) {
    if ((await readFile(output, "utf8")) !== bytes)
      throw new TypeError("Funding review output is stale");
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, output);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  if (args[0] === "--import" && args.length === 5) {
    const inputs = await importFundingPreparations({
      cycleId: args[1],
      snapshot: args[2],
      audit: args[3],
      wallets: args[4],
    });
    await mkdir(join(ROOT, "funding/preparations"), { recursive: true });
    for (const input of inputs)
      await writeFile(
        join(
          ROOT,
          "funding/preparations",
          `${input.projectId}-${input.cycleId}.json`,
        ),
        `${JSON.stringify(input, null, 2)}\n`,
        { flag: "wx" },
      );
  } else if (args.length && !(args.length === 1 && args[0] === "--check"))
    throw new TypeError(
      "Usage: prepare-funding-review.ts [--check | --import YYYY-MM SNAPSHOT AUDIT WALLETS]",
    );
  await syncFundingReviews(ROOT, args[0] === "--check");
}
