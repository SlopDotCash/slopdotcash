// The quality census must cover exactly the preparation period. A project
// whose reward opens mid-month has a period that starts at its reward start
// (assertFundingPreparation), so closures earlier in the calendar month are
// outside the cycle and prepare-contribution-quality refuses them.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LeaderboardSnapshot, ScoreEvent } from "../src/lib/leaderboard";
import { createPaymentProjectView } from "../src/lib/project-view";
import { sha256 } from "./source-correction";

const SNAPSHOT_BYTES = gunzipSync(
  readFileSync(
    "tests/fixtures/history/cycles/eliza/2026-07/source-snapshot.json.gz",
  ),
).toString("utf8");
const snapshot = JSON.parse(SNAPSHOT_BYTES) as LeaderboardSnapshot;
const root = mkdtempSync(join(tmpdir(), "quality-census-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// eliza's reward opened on 2026-07-07, so its July period starts then.
const view = createPaymentProjectView(snapshot, "eliza", "2026-07");
const MONTH_START = "2026-07-01T00:00:00Z";
const MONTH_END = "2026-08-01T00:00:00Z";

/** The archived July ledger's merges, closed anywhere in the calendar month. */
const merges = new Map<string, ScoreEvent>();
for (const event of snapshot.ledger)
  if (
    event.category === "merged-pull-request" &&
    event.repository === "elizaOS/eliza" &&
    Date.parse(event.occurredAt) >= Date.parse(MONTH_START) &&
    Date.parse(event.occurredAt) < Date.parse(MONTH_END) &&
    !merges.has(event.source.id)
  )
    merges.set(event.source.id, event);
const node = (
  id: string,
  number: number,
  createdAt: string,
  closedAt: string,
  mergedAt: string | null,
  author: { id: string; login: string },
) => ({
  id,
  number,
  title: `PR ${number}`,
  url: `https://github.com/elizaOS/eliza/pull/${number}`,
  state: mergedAt ? "MERGED" : "CLOSED",
  createdAt,
  updatedAt: closedAt,
  closedAt,
  mergedAt,
  headRefOid: "a".repeat(40),
  baseRefName: "develop",
  author,
});
const author = { id: "U_census_author", login: "census-author" };
const NODES = [
  ...[...merges.values()].map((event) =>
    node(
      event.source.id,
      event.source.number,
      event.occurredAt,
      event.occurredAt,
      event.occurredAt,
      { id: event.actor.id, login: event.actor.login },
    ),
  ),
  // Unmerged closures before and inside the period.
  node(
    "PR_before_start",
    1,
    "2026-06-30T00:00:00Z",
    "2026-07-03T00:00:00Z",
    null,
    author,
  ),
  node(
    "PR_in_period",
    2,
    "2026-06-30T00:00:01Z",
    "2026-07-10T00:00:00Z",
    null,
    author,
  ),
].sort(
  (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
);

const inPeriod = (iso: string) =>
  Date.parse(iso) >= Date.parse(view.cycle.from) &&
  Date.parse(iso) < Date.parse(view.cycle.to);
const periodMerges = [...merges.values()].filter((event) =>
  inPeriod(event.occurredAt),
);

/** An audited preparation, built the way `prepare-funding-review` imports one. */
function preparationBytes(): string {
  const contributors = view.leaders.map((leader) => {
    const events = view.ledger
      .filter((event) => event.actor.id === leader.actor.id)
      .map((event) => event.id)
      .sort();
    return {
      actor: { id: leader.actor.id, login: leader.actor.login },
      scoreThirds: String(leader.scoreThirds),
      weight: String(leader.adjustedWeight),
      eventCount: events.length,
      eventIdsSha256: sha256(JSON.stringify(events)),
      wallet: null,
      lookupUnavailable: false,
    };
  });
  const scored = new Set(
    view.ledger
      .filter((event) => event.category === "merged-pull-request")
      .map((event) => event.source.id),
  ).size;
  return JSON.stringify({
    projectId: "eliza",
    cycleId: "2026-07",
    sourceSnapshotSha256: sha256(SNAPSHOT_BYTES),
    sourceAuditSha256: sha256("audit-bytes"),
    observedAt: view.cycle.to,
    provenance: {
      ruleVersion: snapshot.ruleVersion,
      walletObservationsSha256: sha256("wallets"),
      snapshotFrom: snapshot.window.from,
      snapshotTo: snapshot.window.to,
      periodFrom: view.cycle.from,
      periodTo: view.cycle.to,
      snapshotLedgerCount: snapshot.ledger.length,
      sourceMergedPullRequests: snapshot.source.counts.mergedPullRequests,
      mergedCensus: periodMerges.length,
      scoredMerges: scored,
    },
    counts: {
      contributors: contributors.length,
      events: contributors.reduce((sum, row) => sum + row.eventCount, 0),
      scoreThirds: contributors
        .reduce((sum, row) => sum + BigInt(row.scoreThirds), 0n)
        .toString(),
      weight: contributors
        .reduce((sum, row) => sum + BigInt(row.weight), 0n)
        .toString(),
    },
    contributors,
  });
}

/** A `gh api graphql` stand-in serving the census pages and diff statistics. */
const stub = `const fs=require('node:fs');
const args=process.argv.slice(2);
const nodes=JSON.parse(fs.readFileSync(process.env.CENSUS_NODES,'utf8'));
if(args.includes('--input')){
  const ids=JSON.parse(fs.readFileSync(0,'utf8')).variables.ids;
  const byId=new Map(nodes.map((n)=>[n.id,n]));
  process.stdout.write(JSON.stringify({data:{nodes:ids.map((id)=>({id,headRefOid:byId.get(id).headRefOid,additions:20,deletions:5,changedFiles:1}))}}));
}else{
  const cursor=args.find((a)=>a.startsWith('cursor='));
  const page=cursor?Number(cursor.slice(7)):0;
  const slice=nodes.slice(page*100,page*100+100);
  const hasNextPage=(page+1)*100<nodes.length;
  process.stdout.write(JSON.stringify({data:{repository:{pullRequests:{pageInfo:{hasNextPage,endCursor:hasNextPage?String(page+1):null},nodes:slice}}}}));
}
`;
const cwd = join(root, "cwd");
const bin = join(root, "bin");
mkdirSync(cwd);
mkdirSync(bin);
if (process.platform === "win32") {
  // execFile needs a native executable on Windows; the copied runtime runs
  // the local \`api\` script for \`gh api graphql ...\`.
  copyFileSync(process.execPath, join(bin, "gh.exe"));
  writeFileSync(join(cwd, "api"), stub);
} else {
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\n${stub}`);
  chmodSync(join(bin, "gh"), 0o755);
}
writeFileSync(join(root, "nodes.json"), JSON.stringify(NODES));

function census(projectId: string, cycleId: string, prefix: string) {
  return spawnSync(
    process.execPath,
    [
      "--preload",
      resolve("tests/registry-preload.ts"),
      resolve("scripts/collect-quality-census.ts"),
      projectId,
      cycleId,
      prefix,
    ],
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        CENSUS_NODES: join(root, "nodes.json"),
      },
    },
  );
}

describe("collect-quality-census covers the preparation period", () => {
  test("a mid-month reward start excludes earlier closures and the census reconciles", () => {
    const prefix = join(root, "eliza-2026-07");
    const run = census("eliza", "2026-07", prefix);
    expect(run.status).toBe(0);
    const closed = JSON.parse(readFileSync(`${prefix}-closed.json`, "utf8"));
    const ids = closed.nodes.map((row: { id: string }) => row.id);
    expect(ids).not.toContain("PR_before_start");
    expect(ids).toContain("PR_in_period");
    expect(
      closed.nodes.every((row: { closedAt: string }) => inPeriod(row.closedAt)),
    ).toBe(true);
    expect(
      closed.nodes.filter((row: { mergedAt: string | null }) => row.mergedAt)
        .length,
    ).toBe(periodMerges.length);

    // The documented next step accepts this census for the frozen preparation.
    writeFileSync(join(root, "preparation.json"), preparationBytes());
    writeFileSync(join(root, "snapshot.json"), SNAPSHOT_BYTES);
    const quality = spawnSync(
      process.execPath,
      [
        "--preload",
        resolve("tests/registry-preload.ts"),
        resolve("scripts/prepare-contribution-quality.ts"),
        join(root, "preparation.json"),
        join(root, "snapshot.json"),
        `${prefix}-closed.json`,
        `${prefix}-bases.json`,
        join(root, "quality.json"),
      ],
      { encoding: "utf8" },
    );
    expect(quality.status).toBe(0);
  }, 120_000);

  test("a month before the project's reward start is refused", () => {
    const run = census("slopdotcash", "2026-09", join(root, "slop-2026-09"));
    expect(run.stderr).toContain(
      "Project reward period does not cover this cycle",
    );
    expect(run.status).not.toBe(0);
  });
});
