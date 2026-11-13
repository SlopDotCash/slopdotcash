import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import { findProject } from "../src/lib/projects.mjs";
import {
  CorrectionEvidenceCache,
  censusMonths,
  collectImplementationCorrections,
  inventoryCorrectionPools,
  parseCollectionArguments,
} from "./collect-implementation-corrections";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "slop-correction-collector-"));
  dirs.push(dir);
  return dir;
}
const when = "2026-01-15T00:00:00.000Z";
const sha = "a".repeat(40);
const actor = { id: "MDQ6VXNlcjQy", login: "author" };
function award(amount = 13, grouped = false): PointAward {
  const unit = grouped ? `wu_${"b".repeat(64)}` : "history_PR_source";
  return {
    key: pointKey(
      "asi",
      actor.id,
      "merged-pull-request",
      "PR_source",
      grouped ? unit : undefined,
    ),
    actor,
    category: "merged-pull-request",
    projectId: "asi",
    sourceId: "PR_source",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/1",
    occurredAt: when,
    workUnitId: unit,
    amount,
    provisional: true,
  };
}
function baseline(rows = [award()]) {
  return appendPointAwards(
    emptyPointsJournal("2026-01-31T00:00:00.000Z"),
    rows,
    "f".repeat(64),
    "github-merged-history-v1",
    "2026-01-31T00:00:00.000Z",
  );
}
function registry() {
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  return { projects: [project], revisions: [], withheld: [] };
}
function fixture(merge = sha) {
  const who = {
    __typename: "User",
    ...actor,
    avatarUrl: "https://avatars.githubusercontent.com/u/42",
    url: "https://github.com/author",
  };
  return {
    __typename: "PullRequest",
    id: "PR_source",
    number: 1,
    url: "https://github.com/SlopDotCash/asi/pull/1",
    title: "Fix",
    body: "Fix",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
    mergedAt: "2026-01-15T00:00:00Z",
    state: "MERGED",
    author: who,
    additions: 2,
    deletions: 1,
    baseRefName: "main",
    baseRefOid: "b".repeat(40),
    headRefOid: sha,
    repository: {
      id: "R_kgDOT23CXA",
      nameWithOwner: "SlopDotCash/asi",
      isPrivate: false,
    },
    mergeCommit: merge ? { oid: merge } : null,
    commits: {
      totalCount: 1,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          commit: {
            id: "C_source",
            oid: sha,
            parents: { totalCount: 1 },
            author: { user: who },
          },
        },
      ],
    },
  };
}
function transport(merge = sha) {
  let requests = 0;
  const call = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      const query: string = body.query;
      let data: Record<string, unknown>;
      if (query.includes("CorrectionRepository"))
        data = {
          repository: {
            id: "R_kgDOT23CXA",
            nameWithOwner: "SlopDotCash/asi",
            isPrivate: false,
            createdAt: "2026-01-01T00:00:00Z",
          },
        };
      else if (query.includes("LeaderboardSearchReferences"))
        data = {
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [fixture(merge)],
          },
        };
      else if (query.includes("CorrectionMetadata"))
        data = { nodes: [fixture(merge)] };
      else if (query.includes("LeaderboardOutcomeCommitLines"))
        data = {
          nodes: [
            {
              __typename: "Commit",
              id: "C_source",
              oid: sha,
              additions: 2,
              deletions: 1,
              repository: { id: "R_kgDOT23CXA" },
            },
          ],
        };
      else throw new Error(`Unexpected fixture query: ${query.slice(0, 70)}`);
      return new Response(
        JSON.stringify({
          data: {
            ...data,
            rateLimit: {
              cost: 1,
              limit: 5000,
              remaining: 4900 - requests,
              resetAt: "2026-02-01T01:00:00Z",
            },
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  return { call, requests: () => requests };
}

test("inventory includes every positive current pool and all zero-valued predecessors", () => {
  const zero = {
    ...award(0),
    actor: { id: "MDQ6VXNlcjQz", login: "former" },
    key: pointKey("asi", "MDQ6VXNlcjQz", "merged-pull-request", "PR_source"),
  };
  const other = {
    ...award(4),
    projectId: "slopdotcash",
    sourceUrl: "https://github.com/SlopDotCash/slopdotcash/pull/1",
    key: pointKey("slopdotcash", actor.id, "merged-pull-request", "PR_source"),
  };
  const result = inventoryCorrectionPools(
    baseline([award(), zero, award(7, true), other]),
    ["asi"],
  );
  expect(result).toHaveLength(2);
  expect(
    result.find((p) => p.candidate.kind === "pull-request")?.candidate
      .expectedPredecessors,
  ).toHaveLength(2);
  expect(result.map((p) => p.totalPoints).sort()).toEqual([13, 7]);
  expect(result.every((p) => p.candidate.proof.status === "held")).toBe(true);
});

test("monthly intervals partition the entire repository lifetime with no overlap or day limit", () => {
  expect(censusMonths("2025-12-31T23:59:59Z", "2026-02-02T00:00:00Z")).toEqual([
    {
      month: "2025-12",
      from: "2025-12-31T23:59:59.000Z",
      to: "2026-01-01T00:00:00.000Z",
    },
    {
      month: "2026-01",
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    },
    {
      month: "2026-02",
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-02T00:00:00.000Z",
    },
  ]);
});

test("a bounded source sample is held without a complete first-accepted census", async () => {
  const dir = await directory(),
    network = transport();
  const result = await collectImplementationCorrections(
    {
      projects: ["asi"],
      before: "2026-01-31T00:00:00.000Z",
      directory: dir,
      sampleSourceIds: ["PR_source"],
    },
    {
      journal: baseline(),
      registry: registry(),
      token: "private-test-token",
      transport: network.call,
      now: new Date("2026-02-02T00:00:00Z"),
    },
  );
  expect(result.receipt.sourceFactsCollected).toBe(1);
  expect(result.receipt.ownershipComplete).toBe(false);
  expect(result.manifest.candidates[0].proof.status).toBe("held");
  expect(result.receipt.missingMonths).toHaveLength(2);
  const files = await readdir(join(dir, "attempts"));
  for (const file of files)
    expect(await readFile(join(dir, "attempts", file), "utf8")).not.toContain(
      "private-test-token",
    );
});

test("complete canonical census derives first acceptance and resumes from raw evidence", async () => {
  const dir = await directory(),
    network = transport();
  const options = {
    projects: ["asi"],
    before: "2026-01-31T00:00:00.000Z",
    directory: dir,
    month: "2026-01",
  };
  const deps = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network.call,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const result = await collectImplementationCorrections(options, deps);
  const proof = result.manifest.candidates[0].proof;
  expect(result.receipt.ownershipComplete).toBe(true);
  expect(proof.status).toBe("complete");
  if (proof.status === "complete")
    expect(proof.sources[0].commits[0].firstAcceptedSourceId).toBe("PR_source");
  const before = network.requests();
  const repeated = await collectImplementationCorrections(options, deps);
  expect(network.requests()).toBe(before);
  expect(repeated.receipt.completeProofs).toBe(1);
  expect(repeated.receipt.cacheHits).toBeGreaterThan(0);
  const repo = (await readdir(join(dir, "census")))[0];
  const file = join(dir, "census", repo, "2026-01.json"),
    part = JSON.parse(await readFile(file, "utf8"));
  part.outcomes[0].commits[0].additions = 999;
  part.digest = createHash("sha256")
    .update(
      JSON.stringify({
        repositoryNodeId: part.repositoryNodeId,
        from: part.from,
        to: part.to,
        outcomes: part.outcomes,
      }),
    )
    .digest("hex");
  await writeFile(file, JSON.stringify(part));
  await expect(collectImplementationCorrections(options, deps)).rejects.toThrow(
    "reconstructed raw evidence",
  );
});

test("missing accepted merge object leaves its pool held even after census completion", async () => {
  const dir = await directory(),
    network = transport("");
  const result = await collectImplementationCorrections(
    {
      projects: ["asi"],
      before: "2026-01-31T00:00:00.000Z",
      directory: dir,
      month: "2026-01",
    },
    {
      journal: baseline(),
      registry: registry(),
      token: "private-test-token",
      transport: network.call,
      now: new Date("2026-01-31T23:59:59Z"),
    },
  );
  expect(result.receipt.ownershipComplete).toBe(true);
  expect(result.manifest.candidates[0].proof.status).toBe("held");
  expect(result.receipt.limitations).toContainEqual({
    id: "PR_source",
    reason: "accepted-merge-object-unavailable",
  });
});

test("evidence transport rejects mutations and untrusted origins before sending", async () => {
  const dir = await directory();
  let requests = 0;
  const cache = new CorrectionEvidenceCache(
    dir,
    Object.assign(
      async () => {
        requests++;
        return new Response("{}");
      },
      { preconnect: fetch.preconnect },
    ),
  );
  await expect(
    cache.fetch("https://api.github.com/graphql", {
      method: "POST",
      body: JSON.stringify({ query: "mutation Update { x }" }),
    }),
  ).rejects.toThrow("read-only");
  await expect(cache.fetch("https://evil.example/data")).rejects.toThrow(
    "read-only",
  );
  expect(requests).toBe(0);
});

test("CLI accepts explicit bounded scope and rejects arbitrary proof import", () => {
  expect(
    parseCollectionArguments([
      "--project",
      "asi",
      "--output",
      "/tmp/review",
      "--month",
      "2026-01",
    ]).month,
  ).toBe("2026-01");
  expect(() =>
    parseCollectionArguments([
      "--project",
      "asi",
      "--output",
      "/tmp/review",
      "--proof",
      "anything.json",
    ]),
  ).toThrow("Unknown");
});

test("a frozen campaign accepts unrelated appended journal records without widening its scope", async () => {
  const dir = await directory(),
    network = transport();
  const journal = baseline(),
    options = {
      projects: ["asi"],
      before: "2026-01-31T00:00:00.000Z",
      directory: dir,
      month: "2026-01",
    };
  const deps = {
    journal,
    registry: registry(),
    token: "private-test-token",
    transport: network.call,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const first = await collectImplementationCorrections(options, deps);
  const extra = {
    ...award(5),
    sourceId: "PR_other",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/2",
    key: pointKey("asi", actor.id, "merged-pull-request", "PR_other"),
    workUnitId: "history_PR_other",
  };
  const appended = appendPointAwards(
    journal,
    [extra],
    "e".repeat(64),
    "slop-score-v1",
    "2026-02-01T00:00:00.000Z",
  );
  const again = await collectImplementationCorrections(options, {
    ...deps,
    journal: appended,
    now: new Date("2026-02-02T00:00:00Z"),
  });
  expect(again.manifest.generatedAt).toBe(first.manifest.generatedAt);
  expect(again.manifest.baseline).toEqual(first.manifest.baseline);
  expect(again.manifest.candidates.map((c) => c.sourceId)).toEqual([
    "PR_source",
  ]);
});

test("a request-budget stop retains raw progress and the next invocation completes the same campaign", async () => {
  const dir = await directory(),
    network = transport();
  const options = {
    projects: ["asi"],
    before: "2026-01-31T00:00:00.000Z",
    directory: dir,
    month: "2026-01",
    requestBudget: 2,
  };
  const deps = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network.call,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  await expect(
    collectImplementationCorrections(options, deps),
  ).rejects.toThrow();
  expect((await readdir(join(dir, "objects"))).length).toBeGreaterThan(0);
  const resumed = await collectImplementationCorrections(
    { ...options, requestBudget: 3 },
    deps,
  );
  expect(resumed.receipt.ownershipComplete).toBe(true);
  expect(resumed.receipt.completeProofs).toBe(1);
  expect(resumed.receipt.cacheHits).toBeGreaterThan(0);
});

test("CLI rejects invalid calendar months", () => {
  for (const month of ["2026-00", "2026-13"])
    expect(() =>
      parseCollectionArguments([
        "--project",
        "asi",
        "--output",
        "/tmp/review",
        "--month",
        month,
      ]),
    ).toThrow("Invalid census month");
});
