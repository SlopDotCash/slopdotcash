import { afterEach, expect, spyOn, test } from "bun:test";
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
import { collectTargetRepositories } from "../src/lib/repositories.mjs";
import {
  CollectionBudgetExhausted,
  CorrectionEvidenceCache,
  censusMonths,
  collectImplementationCorrections,
  collectWithQuotaResume,
  immutableBytes,
  inventoryCorrectionPools,
  parseCollectionArguments,
} from "./collect-implementation-corrections";
import {
  CommitStatisticsUnavailableError,
  collectSearchReferences,
  GitHubGraphqlClient,
  type GraphqlExecutor,
  OutcomeCommitLineLoader,
} from "./generate-leaderboard";

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
  const searchPageSizes: number[] = [];
  const call = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      const query: string = body.query;
      if (query.includes("LeaderboardSearchReferences"))
        searchPageSizes.push(body.variables.pageSize);
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
  return { call, requests: () => requests, searchPageSizes };
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

test("resume reconstructs the complete repository plan from cached canonical preflight evidence", async () => {
  const dir = await directory();
  const network = transport();
  const options = {
    projects: ["asi"],
    before: "2026-01-31T00:00:00.000Z",
    directory: dir,
    month: "2026-01",
  };
  const dependencies = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network.call,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const first = await collectImplementationCorrections(options, dependencies);
  const path = join(dir, "campaign.json");
  const original = await readFile(path, "utf8");
  const calls = network.requests();
  const resumed = await collectImplementationCorrections(options, dependencies);
  expect(resumed.receipt.manifestDigest).toBe(first.receipt.manifestDigest);
  expect(network.requests()).toBe(calls);
  type FrozenCampaign = {
    through: string;
    repositories: {
      nodeId: string;
      createdAt: string;
      months: ReturnType<typeof censusMonths>;
    }[];
  };
  for (const mutate of [
    (campaign: FrozenCampaign) => {
      campaign.repositories = [];
    },
    (campaign: FrozenCampaign) => {
      campaign.repositories.push(structuredClone(campaign.repositories[0]));
    },
    (campaign: FrozenCampaign) => {
      campaign.repositories[0].months = [];
    },
    (campaign: FrozenCampaign) => {
      const plan = campaign.repositories[0];
      plan.createdAt = "2026-01-02T00:00:00Z";
      plan.months = censusMonths(plan.createdAt, campaign.through);
    },
    (campaign: FrozenCampaign) => {
      campaign.repositories[0].nodeId = "R_changed";
    },
  ]) {
    const changed = JSON.parse(original);
    mutate(changed);
    await writeFile(path, JSON.stringify(changed));
    await expect(
      collectImplementationCorrections(options, dependencies),
    ).rejects.toThrow("Campaign repository scope or monthly partition");
    expect(network.requests()).toBe(calls);
  }
  await writeFile(path, original);
  for (const name of await readdir(join(dir, "attempts"))) {
    const attempt = JSON.parse(
      await readFile(join(dir, "attempts", name), "utf8"),
    );
    if (!attempt.body?.includes("CorrectionRepository")) continue;
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          url: attempt.url,
          method: attempt.method,
          body: attempt.body,
        }),
      )
      .digest("hex");
    await rm(join(dir, "requests", `${key}.json`));
  }
  await expect(
    collectImplementationCorrections(options, dependencies),
  ).rejects.toThrow("Cached census is missing raw request evidence");
  expect(network.requests()).toBe(calls);
});

test("a complete census supplies source proofs without another metadata or statistics pass", async () => {
  const dir = await directory();
  const base = transport();
  const operations: string[] = [];
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const operation = /query\s+(\w+)/u.exec(body.query)?.[1] ?? "unknown";
      operations.push(operation);
      if (operation === "CorrectionMetadata")
        throw new Error("Complete census must not re-read PR metadata");
      return base.call(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  const options = {
    projects: ["asi"],
    directory: dir,
    month: "2026-01",
    before: "2026-01-31T00:00:00.000Z",
  };
  const deps = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const result = await collectImplementationCorrections(options, deps);
  expect(result.receipt.completeProofs).toBe(1);
  expect(result.receipt.sourceFactsCollected).toBe(1);
  expect(
    operations.filter(
      (operation) => operation === "LeaderboardOutcomeCommitLines",
    ),
  ).toHaveLength(1);
  expect(operations).not.toContain("CorrectionMetadata");
  const count = operations.length;
  const repeated = await collectImplementationCorrections(options, deps);
  expect(operations).toHaveLength(count);
  expect(repeated.receipt.manifestDigest).toBe(result.receipt.manifestDigest);
});

test("complete census reuse holds absent or mismatched recorded sources", async () => {
  for (const mismatch of ["absent", "url", "occurredAt"] as const) {
    const dir = await directory();
    const base = transport();
    const network = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("CorrectionMetadata"))
          throw new Error("Complete census must not re-read metadata");
        if (!body.query.includes("LeaderboardSearchReferences"))
          return base.call(input, init);
        const node = fixture();
        if (mismatch === "absent") node.id = "PR_other";
        if (mismatch === "url")
          node.url = "https://github.com/SlopDotCash/asi/pull/2";
        if (mismatch === "occurredAt") node.mergedAt = "2026-01-16T00:00:00Z";
        return Response.json({
          data: {
            search: {
              issueCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [node],
            },
            rateLimit: {
              cost: 1,
              limit: 5000,
              remaining: 4900,
              resetAt: "2026-02-01T00:00:00Z",
            },
          },
        });
      },
      { preconnect: fetch.preconnect },
    );
    const result = await collectImplementationCorrections(
      {
        projects: ["asi"],
        directory: dir,
        month: "2026-01",
        before: "2026-01-31T00:00:00.000Z",
      },
      {
        journal: baseline(),
        registry: registry(),
        token: "private-test-token",
        transport: network,
        now: new Date("2026-01-31T23:59:59Z"),
      },
    );
    expect(result.receipt.ownershipComplete).toBe(true);
    expect(result.manifest.candidates[0].proof.status).toBe("held");
  }
});

test("an empty accepted commit list holds only that source while another source remains complete", async () => {
  const dir = await directory();
  const base = transport();
  const emptyAward: PointAward = {
    ...award(),
    sourceId: "PR_empty",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/2",
    workUnitId: "history_PR_empty",
    key: pointKey("asi", actor.id, "merged-pull-request", "PR_empty"),
  };
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("CorrectionMetadata"))
        throw new Error("Complete census must not re-read metadata");
      if (!body.query.includes("LeaderboardSearchReferences"))
        return base.call(input, init);
      const empty = {
        ...fixture(),
        id: "PR_empty",
        number: 2,
        url: emptyAward.sourceUrl,
        commits: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      };
      return Response.json({
        data: {
          search: {
            issueCount: 2,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [fixture(), empty],
          },
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 4900,
            resetAt: "2026-02-01T00:00:00Z",
          },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
  const options = {
    projects: ["asi"],
    directory: dir,
    month: "2026-01",
    before: "2026-01-31T00:00:00.000Z",
  };
  const deps = {
    journal: baseline([award(), emptyAward]),
    registry: registry(),
    token: "private-test-token",
    transport: network,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const result = await collectImplementationCorrections(options, deps);
  expect(result.receipt.ownershipComplete).toBe(true);
  expect(result.receipt.completeProofs).toBe(1);
  expect(result.receipt.heldProofs).toBe(1);
  expect(
    result.manifest.candidates.find(
      (candidate) => candidate.sourceId === "PR_source",
    )?.proof.status,
  ).toBe("complete");
  const empty = result.manifest.candidates.find(
    (candidate) => candidate.sourceId === "PR_empty",
  );
  if (!empty) throw new Error("Empty source was omitted from the inventory");
  expect(empty?.proof.status).toBe("held");
  expect(result.receipt.limitations).toContainEqual({
    id: empty.id,
    reason: "accepted-source-commit-list-empty",
  });
  const calls = base.requests();
  const repeated = await collectImplementationCorrections(options, deps);
  expect(base.requests()).toBe(calls);
  expect(repeated.receipt.manifestDigest).toBe(result.receipt.manifestDigest);
});

test("linked ordinary attribution uses the canonical accepted source even when the merge object is unavailable", async () => {
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
  expect(result.manifest.candidates[0].proof.status).toBe("complete");
  expect(result.receipt.completeProofs).toBe(1);
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

test("resumed attempts in one millisecond retain distinct immutable evidence", async () => {
  const dir = await directory();
  const clock = spyOn(Date, "now").mockReturnValue(1794620000000);
  let calls = 0;
  const transport = Object.assign(
    async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json({ restored: true });
    },
    { preconnect: fetch.preconnect },
  );
  const url = "https://api.github.com/repos/SlopDotCash/asi/pulls/1";
  try {
    const first = new CorrectionEvidenceCache(dir, transport);
    expect((await first.fetch(url)).status).toBe(503);
    const resumed = new CorrectionEvidenceCache(dir, transport);
    expect(await (await resumed.fetch(url)).json()).toEqual({ restored: true });
    expect(await (await resumed.fetch(url)).json()).toEqual({ restored: true });
    expect(calls).toBe(2);
    const attempts = await readdir(join(dir, "attempts"));
    expect(attempts).toHaveLength(2);
    const retained = await Promise.all(
      attempts.map(async (name) => {
        const attempt = JSON.parse(
          await readFile(join(dir, "attempts", name), "utf8"),
        );
        const bytes = await readFile(join(dir, "objects", attempt.bodyDigest));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          attempt.bodyDigest,
        );
        return attempt.status;
      }),
    );
    expect(retained.sort()).toEqual([200, 503]);
  } finally {
    clock.mockRestore();
  }
});

test("GitHub quota failures retain raw attempts without caching them or swallowing other failures", async () => {
  const failures: {
    url: string;
    init: RequestInit;
    body: unknown;
    status: number;
    headers: HeadersInit;
  }[] = [
    {
      url: "https://api.github.com/repos/SlopDotCash/asi/pulls/1",
      init: {},
      body: { message: "API rate limit exceeded" },
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    },
    {
      url: "https://api.github.com/repos/SlopDotCash/asi/pulls/1",
      init: {},
      body: { message: "Too many requests" },
      status: 429,
      headers: {},
    },
    {
      url: "https://api.github.com/repos/SlopDotCash/asi/pulls/1",
      init: {},
      body: { message: "You have exceeded a secondary rate limit" },
      status: 403,
      headers: {},
    },
    {
      url: "https://api.github.com/graphql",
      init: {
        method: "POST",
        body: JSON.stringify({ query: "query Sample { node }" }),
      },
      body: { data: null, errors: [{ type: "RATE_LIMITED" }] },
      status: 200,
      headers: {},
    },
  ];
  for (const failure of failures) {
    const dir = await directory();
    let requests = 0;
    const transport = Object.assign(
      async () => {
        requests++;
        return requests === 1
          ? Response.json(failure.body, {
              status: failure.status,
              headers: failure.headers,
            })
          : Response.json({ data: { node: null } });
      },
      { preconnect: fetch.preconnect },
    );
    const cache = new CorrectionEvidenceCache(dir, transport);
    await expect(cache.fetch(failure.url, failure.init)).rejects.toBeInstanceOf(
      CollectionBudgetExhausted,
    );
    const attempts = await readdir(join(dir, "attempts"));
    expect(attempts).toHaveLength(1);
    const retained = JSON.parse(
      await readFile(join(dir, "attempts", attempts[0]), "utf8"),
    );
    expect(retained.status).toBe(failure.status);
    expect(
      JSON.parse(
        await readFile(join(dir, "objects", retained.bodyDigest), "utf8"),
      ),
    ).toEqual(failure.body);
    await expect(cache.fetch(failure.url, failure.init)).rejects.toBeInstanceOf(
      CollectionBudgetExhausted,
    );
    expect(requests).toBe(1);
    expect(() => cache.assertUninterrupted()).toThrow(
      CollectionBudgetExhausted,
    );
    const resumed = new CorrectionEvidenceCache(dir, transport);
    expect(
      await (await resumed.fetch(failure.url, failure.init)).json(),
    ).toEqual({ data: { node: null } });
    await resumed.fetch(failure.url, failure.init);
    expect(requests).toBe(2);
    expect(resumed.cacheHits).toBe(1);
  }
  for (const [url, status, headers] of [
    ["https://api.github.com/repos/SlopDotCash/asi/pulls/1", 403, {}],
    [
      "https://api.github.com/repos/SlopDotCash/asi/pulls/1",
      403,
      { "x-ratelimit-remaining": "1" },
    ],
    ["https://api.github.com/repos/SlopDotCash/asi/pulls/1", 404, {}],
    ["https://api.github.com/repos/SlopDotCash/asi/pulls/1", 503, {}],
    ["https://slop.cash/api/v1/points/journal", 429, {}],
  ] as const) {
    const cache = new CorrectionEvidenceCache(
      await directory(),
      Object.assign(
        async () =>
          Response.json({ error: "unavailable" }, { status, headers }),
        { preconnect: fetch.preconnect },
      ),
    );
    expect((await cache.fetch(url)).status).toBe(status);
  }
});

test("retained-source quota and budget interruptions survive caught discovery errors", async () => {
  const dir = await directory();
  const base = transport();
  let quotaAvailable = false;
  let timelineQuotaAvailable = false;
  let outgoingQuotaAvailable = false;
  let outgoingRequests = 0;
  let pullRequests = 0;
  let requests = 0;
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const url = new URL(String(input));
      if (url.pathname.endsWith("/asi/pulls/1")) {
        pullRequests++;
        if (!quotaAvailable)
          return Response.json(
            { message: "API rate limit exceeded" },
            { status: 403, headers: { "x-ratelimit-remaining": "0" } },
          );
        return Response.json({
          node_id: "PR_source",
          number: 1,
          body: "Fix #2 and #3",
          head: { sha },
          merged_at: when,
          comments: 0,
          review_comments: 0,
        });
      }
      if (url.pathname !== "/graphql") return Response.json([]);
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("issueOrPullRequest")) {
        outgoingRequests++;
        if (!outgoingQuotaAvailable)
          return Response.json(
            { message: "Too many requests" },
            { status: 429 },
          );
        return Response.json({
          data: {
            repository: {
              isPrivate: false,
              nameWithOwner: "elizaOS/asi",
              issueOrPullRequest: { __typename: "Issue" },
            },
          },
        });
      }
      if (body.query.includes("CROSS_REFERENCED_EVENT")) {
        if (!timelineQuotaAvailable)
          return Response.json({
            data: null,
            errors: [{ type: "RATE_LIMITED" }],
          });
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                id: "PR_source",
                timelineItems: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      }
      if (body.query.includes("LeaderboardSearchReferences")) {
        const pull = fixture();
        (pull.commits.nodes[0].commit.author as { user: unknown }).user = null;
        return Response.json({
          data: {
            search: {
              issueCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [pull],
            },
            rateLimit: {
              cost: 1,
              limit: 5000,
              remaining: 4900,
              resetAt: "2026-02-01T01:00:00Z",
            },
          },
        });
      }
      return base.call(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  const options = {
    projects: ["asi"],
    before: "2026-01-31T00:00:00.000Z",
    directory: dir,
    month: "2026-01",
  };
  const dependencies = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  await expect(
    collectImplementationCorrections(options, dependencies),
  ).rejects.toBeInstanceOf(CollectionBudgetExhausted);
  await expect(readFile(join(dir, "manifest.json"), "utf8")).rejects.toThrow();
  expect(pullRequests).toBe(1);
  const censusRequests = base.requests();
  quotaAvailable = true;
  await expect(
    collectImplementationCorrections(options, dependencies),
  ).rejects.toBeInstanceOf(CollectionBudgetExhausted);
  await expect(readFile(join(dir, "manifest.json"), "utf8")).rejects.toThrow();
  timelineQuotaAvailable = true;
  await expect(
    collectImplementationCorrections(options, dependencies),
  ).rejects.toBeInstanceOf(CollectionBudgetExhausted);
  await expect(readFile(join(dir, "manifest.json"), "utf8")).rejects.toThrow();
  expect(outgoingRequests).toBe(1);
  outgoingQuotaAvailable = true;
  await expect(
    collectImplementationCorrections(
      { ...options, requestBudget: 1 },
      dependencies,
    ),
  ).rejects.toBeInstanceOf(CollectionBudgetExhausted);
  await expect(readFile(join(dir, "manifest.json"), "utf8")).rejects.toThrow();
  expect(outgoingRequests).toBe(2);
  const resumed = await collectImplementationCorrections(options, dependencies);
  expect(resumed.receipt.ownershipComplete).toBe(true);
  expect(resumed.receipt.completeProofs).toBe(1);
  expect(resumed.receipt.heldProofs).toBe(0);
  expect(base.requests()).toBe(censusRequests);
  expect(pullRequests).toBe(2);
  const completedRequests = requests;
  const replayed = await collectImplementationCorrections(
    options,
    dependencies,
  );
  expect(requests).toBe(completedRequests);
  expect(replayed.receipt.manifestDigest).toBe(resumed.receipt.manifestDigest);
});

test("opt-in quota resume replays the same campaign across shared REST and GraphQL windows", async () => {
  const dir = await directory();
  const base = transport();
  const now = new Date("2026-01-31T23:59:59Z");
  let clock = now.getTime();
  const delays: number[] = [];
  let comparisons = 0;
  let timelineReads = 0;
  let initialCensusReads = 0;
  let totalReads = 0;
  let sourceGraphqlCost = 0;
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      totalReads++;
      const url = new URL(String(input));
      if (url.pathname.endsWith("/asi/pulls/1")) {
        comparisons++;
        if (comparisons === 1)
          return Response.json(
            { message: "API rate limit exceeded" },
            {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.floor(clock / 1000) + 5),
              },
            },
          );
        if (comparisons === 2)
          return Response.json(
            { message: "Secondary rate limit" },
            { status: 403, headers: { "retry-after": "10" } },
          );
        return Response.json({
          node_id: "PR_source",
          number: 1,
          body: "Fix",
          head: { sha },
          merged_at: when,
          comments: 0,
          review_comments: 0,
        });
      }
      if (url.pathname !== "/graphql") return Response.json([]);
      const { query } = JSON.parse(String(init?.body));
      if (query.includes("CROSS_REFERENCED_EVENT")) {
        timelineReads++;
        if (timelineReads === 1) {
          sourceGraphqlCost += 3;
          return Response.json({
            errors: [{ type: "RATE_LIMITED" }],
            data: {
              rateLimit: {
                cost: 3,
                resetAt: new Date(clock + 4_000).toISOString(),
              },
            },
          });
        }
        return Response.json({
          data: {
            repository: {
              pullRequest: {
                id: "PR_source",
                timelineItems: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      }
      if (query.includes("LeaderboardSearchReferences")) {
        initialCensusReads++;
        sourceGraphqlCost++;
        const pull = fixture();
        (pull.commits.nodes[0].commit.author as { user: unknown }).user = null;
        return Response.json({
          data: {
            search: {
              issueCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [pull],
            },
            rateLimit: {
              cost: 1,
              limit: 5000,
              remaining: 4900,
              resetAt: "2026-02-01T01:00:00Z",
            },
          },
        });
      }
      const response = await base.call(input, init);
      const value = await response.clone().json();
      sourceGraphqlCost += value.data?.rateLimit?.cost ?? 0;
      return response;
    },
    { preconnect: fetch.preconnect },
  );
  const options = {
    projects: ["asi"],
    before: "2026-01-31T00:00:00.000Z",
    directory: dir,
    month: "2026-01",
    resumeForSeconds: 300,
  };
  const dependencies = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network,
    now,
  };
  const result = await collectWithQuotaResume(options, dependencies, {
    now: () => clock,
    wait: async (ms) => {
      await expect(
        readFile(join(dir, "manifest.json"), "utf8"),
      ).rejects.toThrow();
      delays.push(ms);
      clock += ms;
    },
  });
  expect(delays).toEqual([7_000, 12_000, 6_000]);
  expect(result.receipt.ownershipComplete).toBe(true);
  expect(result.receipt.completeProofs).toBe(1);
  expect(result.receipt.heldProofs).toBe(0);
  expect(result.receipt.through).toBe(now.toISOString());
  expect(result.receipt.requests).toBe(totalReads);
  expect(result.receipt.reportedGraphqlCost).toBe(sourceGraphqlCost);
  expect(sourceGraphqlCost).toBeGreaterThan(3);
  expect(initialCensusReads).toBe(1);
  expect(comparisons).toBe(3);
  expect(timelineReads).toBe(2);
  const replay = await collectImplementationCorrections(options, dependencies);
  expect(replay.receipt.manifestDigest).toBe(result.receipt.manifestDigest);
  expect(replay.receipt.requests).toBe(0);
  expect(replay.receipt.reportedGraphqlCost).toBe(0);
});

test("quota resume checkpoints on deadline, unusable reset, repeated refusal and cumulative budget", async () => {
  for (const scenario of [
    "deadline",
    "reset",
    "refusal",
    "budget",
    "unrelated",
  ] as const) {
    const dir = await directory();
    const waitFor = 120;
    let clock = Date.parse("2026-01-31T23:59:59Z");
    let attempts = 0;
    const delays: number[] = [];
    const network = Object.assign(
      async () => {
        attempts++;
        if (scenario === "unrelated") throw new Error("Malformed source data");
        return Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset":
                scenario === "reset"
                  ? "bad"
                  : String(
                      Math.floor(clock / 1000) +
                        (scenario === "deadline" ? waitFor : 1),
                    ),
            },
          },
        );
      },
      { preconnect: fetch.preconnect },
    );
    const options = {
      projects: ["asi"],
      directory: dir,
      month: "2026-01",
      resumeForSeconds: 60,
      requestBudget: scenario === "budget" ? 2 : 30,
    };
    const dependencies = {
      journal: baseline(),
      registry: registry(),
      token: "private-test-token",
      transport: network,
    };
    await expect(
      collectWithQuotaResume(options, dependencies, {
        now: () => clock,
        wait: async (ms) => {
          delays.push(ms);
          clock += ms;
        },
      }),
    ).rejects.toThrow(
      scenario === "unrelated"
        ? "GitHub GraphQL network request failed"
        : "GitHub API quota exhausted",
    );
    expect(attempts).toBe(
      scenario === "refusal" ? 3 : scenario === "budget" ? 2 : 1,
    );
    expect(delays.length).toBe(attempts - 1);
    await expect(
      readFile(join(dir, "manifest.json"), "utf8"),
    ).rejects.toThrow();
  }
});

test("parallel quota reads wait for the strictest reset and stop when no request entries persist", async () => {
  for (const unknownPrimaryReset of [false, true]) {
    const dir = await directory();
    const base = transport();
    const now = new Date("2026-01-31T23:59:59Z");
    let clock = now.getTime();
    let siblingReads = 0;
    const delays: number[] = [];
    const network = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/asi/pulls/1"))
          return Response.json({
            node_id: "PR_source",
            number: 1,
            body: "Fix",
            head: { sha },
            merged_at: when,
            comments: 0,
            review_comments: 0,
          });
        if (url.pathname !== "/graphql") {
          siblingReads++;
          if (url.pathname.endsWith("/reviews"))
            return Response.json(
              { message: "Secondary rate limit" },
              { status: 403, headers: { "retry-after": "5" } },
            );
          await Bun.sleep(30);
          return Response.json(
            { message: "API rate limit exceeded" },
            {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": unknownPrimaryReset
                  ? "invalid"
                  : String(Math.floor(clock / 1_000) + 20),
              },
            },
          );
        }
        if (
          JSON.parse(String(init?.body)).query.includes(
            "LeaderboardSearchReferences",
          )
        ) {
          const pull = fixture();
          (pull.commits.nodes[0].commit.author as { user: unknown }).user =
            null;
          return Response.json({
            data: {
              search: {
                issueCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [pull],
              },
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: 4900,
                resetAt: "2026-02-01T01:00:00Z",
              },
            },
          });
        }
        return base.call(input, init);
      },
      { preconnect: fetch.preconnect },
    );
    await expect(
      collectWithQuotaResume(
        {
          projects: ["asi"],
          before: "2026-01-31T00:00:00.000Z",
          directory: dir,
          month: "2026-01",
          resumeForSeconds: 300,
        },
        {
          journal: baseline(),
          registry: registry(),
          token: "private-test-token",
          transport: network,
          now,
        },
        {
          now: () => clock,
          wait: async (ms) => {
            delays.push(ms);
            clock += ms;
          },
        },
      ),
    ).rejects.toBeInstanceOf(CollectionBudgetExhausted);
    expect(delays).toEqual(unknownPrimaryReset ? [] : [22_000, 22_000, 22_000]);
    expect(siblingReads).toBe(unknownPrimaryReset ? 3 : 12);
    await expect(
      readFile(join(dir, "manifest.json"), "utf8"),
    ).rejects.toThrow();
  }
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

test("immutable publication survives an orphan temporary file and concurrent identical writers", async () => {
  const dir = await directory(),
    path = join(dir, "object");
  const bytes = new TextEncoder().encode("complete response bytes");
  await writeFile(`${path}.orphan.tmp`, "interrupted prefix");
  await Promise.all(
    Array.from({ length: 8 }, () => immutableBytes(path, bytes)),
  );
  expect(await readFile(path, "utf8")).toBe("complete response bytes");
  expect((await readdir(dir)).sort()).toEqual(["object", "object.orphan.tmp"]);
  expect(await readFile(`${path}.orphan.tmp`, "utf8")).toBe(
    "interrupted prefix",
  );
});

test("racing different immutable bytes never overwrite the winner", async () => {
  const dir = await directory(),
    path = join(dir, "object");
  const results = await Promise.allSettled([
    immutableBytes(path, new TextEncoder().encode("first")),
    immutableBytes(path, new TextEncoder().encode("second")),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  const retained = await readFile(path, "utf8");
  expect(["first", "second"]).toContain(retained);
  await expect(
    immutableBytes(path, new TextEncoder().encode("replacement")),
  ).rejects.toThrow("Immutable cache bytes changed");
  expect(await readFile(path, "utf8")).toBe(retained);
  expect(await readdir(dir)).toEqual(["object"]);
});

test("the canonical collector completes fifty-result pages with exact cursors and counts", async () => {
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const repository = collectTargetRepositories([project])[0];
  const observed: { pageSize: unknown; after: unknown }[] = [];
  let requestCount = 0;
  const client: GraphqlExecutor = {
    async execute(query, variables = {}) {
      requestCount++;
      const rateLimit = {
        cost: 1,
        limit: 5000,
        remaining: 4990,
        resetAt: "2026-02-01T00:00:00Z",
      };
      if (query.includes("LeaderboardOutcomeCommitLines"))
        return {
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
          rateLimit,
        };
      observed.push({ pageSize: variables.pageSize, after: variables.after });
      const offset = Number(variables.after ?? 0),
        end = Math.min(offset + Number(variables.pageSize), 120);
      const nodes = Array.from({ length: end - offset }, (_, index) => ({
        ...fixture(),
        id: `PR_page_${offset + index + 1}`,
        number: offset + index + 1,
        url: `https://github.com/SlopDotCash/asi/pull/${offset + index + 1}`,
      }));
      return {
        search: {
          issueCount: 120,
          nodes,
          pageInfo: { hasNextPage: end < 120, endCursor: String(end) },
        },
        rateLimit,
      };
    },
    getRequestCount: () => requestCount,
    getRateLimit: () => ({
      cost: 1,
      consumedDuringRun: requestCount,
      limit: 5000,
      remaining: 4990,
      resetAt: "2026-02-01T00:00:00Z",
    }),
  };
  const references = await collectSearchReferences(
    client,
    repository,
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-02-01T00:00:00Z"),
    "merged",
    "is:pr is:merged",
    "PullRequest",
    { searchSliceCount: 0 },
    undefined,
    "R_kgDOT23CXA",
    50,
  );
  expect(references).toHaveLength(120);
  expect(new Set(references.map((entry) => entry.id)).size).toBe(120);
  expect(observed).toEqual([
    { pageSize: 50, after: null },
    { pageSize: 50, after: "50" },
    { pageSize: 50, after: "100" },
  ]);
});

test("new campaigns freeze fifty-result searches while fieldless campaigns retain one hundred", async () => {
  const fresh = await directory(),
    freshNetwork = transport();
  const dependencies = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    now: new Date("2026-01-31T23:59:59Z"),
  };
  await collectImplementationCorrections(
    {
      projects: ["asi"],
      directory: fresh,
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    },
    { ...dependencies, transport: freshNetwork.call },
  );
  expect(freshNetwork.searchPageSizes).toEqual([50]);
  const old = await directory(),
    oldNetwork = transport();
  const options = {
    projects: ["asi"],
    directory: old,
    sampleSourceIds: ["PR_source"],
    before: "2026-01-31T00:00:00.000Z",
  };
  await collectImplementationCorrections(options, {
    ...dependencies,
    transport: oldNetwork.call,
  });
  const path = join(old, "campaign.json"),
    campaign = JSON.parse(await readFile(path, "utf8"));
  delete campaign.initialSearchPageSize;
  await writeFile(path, JSON.stringify(campaign));
  await collectImplementationCorrections(
    { ...options, month: "2026-01", sampleSourceIds: undefined },
    { ...dependencies, transport: oldNetwork.call },
  );
  expect(oldNetwork.searchPageSizes).toEqual([100]);
  const count = oldNetwork.requests();
  await collectImplementationCorrections(
    { ...options, month: "2026-01", sampleSourceIds: undefined },
    { ...dependencies, transport: oldNetwork.call },
  );
  expect(oldNetwork.requests()).toBe(count);
});

test("malformed successful responses remain raw evidence but never poison the resumable cache", async () => {
  const dir = await directory();
  let requests = 0;
  const transport = Object.assign(
    async () => {
      requests++;
      return new Response(
        requests === 1 ? "" : JSON.stringify({ data: { node: null } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    { preconnect: fetch.preconnect },
  );
  const cache = new CorrectionEvidenceCache(dir, transport);
  const input = "https://api.github.com/graphql";
  const init = {
    method: "POST",
    body: JSON.stringify({ query: "query Sample { node }" }),
  };
  expect(await (await cache.fetch(input, init)).text()).toBe("");
  expect(await (await cache.fetch(input, init)).json()).toEqual({
    data: { node: null },
  });
  expect(await (await cache.fetch(input, init)).json()).toEqual({
    data: { node: null },
  });
  expect(requests).toBe(2);
  expect(cache.cacheHits).toBe(1);
  expect((await readdir(join(dir, "objects"))).length).toBe(2);
});

test("a gateway-narrowed successful page reconstructs offline without retrying the failed larger request", async () => {
  const dir = await directory(),
    network = transport();
  let requests = 0;
  const sizes: number[] = [];
  const flaky = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("LeaderboardSearchReferences")) {
        sizes.push(body.variables.pageSize);
        if (body.variables.pageSize === 100)
          return new Response("gateway failure", { status: 502 });
      }
      return network.call(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  const deps = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: flaky,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const options = {
    projects: ["asi"],
    directory: dir,
    sampleSourceIds: ["PR_source"],
    before: "2026-01-31T00:00:00.000Z",
  };
  await collectImplementationCorrections(options, deps);
  const path = join(dir, "campaign.json"),
    campaign = JSON.parse(await readFile(path, "utf8"));
  delete campaign.initialSearchPageSize;
  await writeFile(path, JSON.stringify(campaign));
  const month = { ...options, month: "2026-01", sampleSourceIds: undefined };
  const first = await collectImplementationCorrections(month, deps);
  expect(first.receipt.ownershipComplete).toBe(true);
  expect(sizes).toEqual([100, 50]);
  const count = requests;
  const resumed = await collectImplementationCorrections(month, deps);
  expect(requests).toBe(count);
  expect(resumed.receipt.completeProofs).toBe(1);
  expect(resumed.receipt.manifestDigest).toBe(first.receipt.manifestDigest);
});

test("missing commit evidence and changed source identity never create a complete proof", async () => {
  for (const failure of ["commits", "identity"]) {
    const dir = await directory(),
      base = transport();
    const altered = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (!body.query.includes("CorrectionMetadata"))
          return base.call(input, init);
        const node = fixture();
        if (failure === "commits") node.commits.nodes = [];
        else node.id = "PR_changed";
        return new Response(
          JSON.stringify({
            data: {
              nodes: [node],
              rateLimit: {
                cost: 1,
                limit: 5000,
                remaining: 4900,
                resetAt: "2026-02-01T00:00:00Z",
              },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
      { preconnect: fetch.preconnect },
    );
    await expect(
      collectImplementationCorrections(
        {
          projects: ["asi"],
          directory: dir,
          sampleSourceIds: ["PR_source"],
          before: "2026-01-31T00:00:00.000Z",
        },
        {
          journal: baseline(),
          registry: registry(),
          token: "private-test-token",
          transport: altered,
          now: new Date("2026-02-02T00:00:00Z"),
        },
      ),
    ).rejects.toThrow();
    await expect(readFile(join(dir, "manifest.json"))).rejects.toThrow();
  }
});

test("split node batches reconstruct a complete checkpoint offline and missing or tampered halves refuse", async () => {
  const dir = await directory();
  const node = fixture();
  const commits = Array.from({ length: 100 }, (_, index) => ({
    commit: {
      ...node.commits.nodes[0].commit,
      id: `C_split_${index}`,
      oid: (index + 1).toString(16).padStart(40, "0"),
    },
  }));
  const large = {
    ...node,
    headRefOid: commits.at(-1)?.commit.oid,
    commits: { ...node.commits, totalCount: commits.length, nodes: commits },
  };
  const byId = new Map(commits.map(({ commit }) => [commit.id, commit]));
  const base = transport();
  let requests = 0;
  const observedBatches: number[] = [];
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const body = JSON.parse(String(init?.body));
      const query = body.query as string;
      let data: Record<string, unknown>;
      if (query.includes("LeaderboardSearchReferences")) {
        data = {
          search: {
            issueCount: 1,
            nodes: [large],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
      } else if (query.includes("CorrectionMetadata")) {
        data = { nodes: [large] };
      } else if (query.includes("LeaderboardOutcomeCommitLines")) {
        const ids = body.variables.ids as string[];
        observedBatches.push(ids.length);
        if (
          ids.length === 100 ||
          (ids.length === 50 && ids[0] === "C_split_50")
        )
          return new Response("gateway failure", { status: 502 });
        data = {
          nodes: ids.map((id) => ({
            __typename: "Commit",
            id,
            oid: byId.get(id)?.oid,
            additions: 2,
            deletions: 1,
            repository: { id: "R_kgDOT23CXA" },
          })),
        };
      } else return base.call(input, init);
      return Response.json({
        data: {
          ...data,
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 4900,
            resetAt: "2026-02-01T01:00:00Z",
          },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
  const options = {
    projects: ["asi"],
    directory: dir,
    month: "2026-01",
    before: "2026-01-31T00:00:00.000Z",
  };
  const deps = {
    journal: baseline(),
    registry: registry(),
    token: "private-test-token",
    transport: network,
    now: new Date("2026-01-31T23:59:59Z"),
  };
  const first = await collectImplementationCorrections(options, deps);
  expect(first.receipt.ownershipComplete).toBe(true);
  expect(first.receipt.completeProofs).toBe(1);
  expect(observedBatches).toContain(100);
  expect(observedBatches).toContain(50);
  expect(observedBatches).toContain(25);
  const count = requests;
  const resumed = await collectImplementationCorrections(options, deps);
  expect(requests).toBe(count);
  expect(resumed.receipt.manifestDigest).toBe(first.receipt.manifestDigest);

  // One retained half's object and pointer are enough to exercise both
  // integrity boundaries without changing the complete checkpoint itself.
  let pointerPath = "";
  let objectPath = "";
  for (const file of await readdir(join(dir, "attempts"))) {
    const attempt = JSON.parse(
      await readFile(join(dir, "attempts", file), "utf8"),
    );
    if (attempt.status !== 200 || !attempt.body) continue;
    const body = JSON.parse(attempt.body);
    if (
      !body.query.includes("LeaderboardOutcomeCommitLines") ||
      body.variables.ids.length !== 50
    )
      continue;
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          url: attempt.url,
          method: attempt.method,
          body: attempt.body,
        }),
      )
      .digest("hex");
    pointerPath = join(dir, "requests", `${key}.json`);
    objectPath = join(dir, "objects", attempt.bodyDigest);
    break;
  }
  expect(pointerPath).not.toBe("");
  const originalObject = await readFile(objectPath);
  await writeFile(objectPath, "tampered response");
  await expect(collectImplementationCorrections(options, deps)).rejects.toThrow(
    "digest mismatch",
  );
  expect(requests).toBe(count);
  await writeFile(objectPath, originalObject);
  await rm(pointerPath);
  await expect(collectImplementationCorrections(options, deps)).rejects.toThrow(
    "missing raw request evidence",
  );
  expect(requests).toBe(count);
}, 30_000);

function unavailableCounterTransport(
  options: {
    parentCount?: number;
    unlinked?: boolean;
    alterRest?: (value: Record<string, unknown>) => unknown;
    alterError?: (value: Record<string, unknown>) => void;
    missingRateLimit?: boolean;
  } = {},
) {
  const parentCount = options.parentCount ?? 1;
  const base = transport();
  const who = {
    ...actor,
    type: "User",
    node_id: actor.id,
    avatar_url: "https://avatars.githubusercontent.com/u/42",
    html_url: "https://github.com/author",
  };
  const pull = fixture();
  pull.commits.nodes[0].commit.parents.totalCount = parentCount;
  if (options.unlinked)
    (pull.commits.nodes[0].commit.author as { user: unknown }).user = null;
  const rateLimit = {
    cost: 1,
    limit: 5000,
    remaining: 4900,
    resetAt: "2026-02-01T01:00:00Z",
  };
  let requests = 0;
  let restRequests = 0;
  const call = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const url = new URL(String(input));
      if (url.pathname === `/repos/SlopDotCash/asi/commits/${sha}`) {
        restRequests++;
        const value = {
          node_id: "C_source",
          sha,
          url: url.href,
          html_url: `https://github.com/SlopDotCash/asi/commit/${sha}`,
          author: who,
          parents: Array.from({ length: parentCount }, (_, index) => ({
            sha: (index + 1).toString(16).padStart(40, "0"),
          })),
          stats:
            parentCount > 1
              ? { additions: 0, deletions: 0, total: 0 }
              : { additions: 2, deletions: 1, total: 3 },
        };
        const altered = options.alterRest ? options.alterRest(value) : value;
        return altered === null
          ? new Response("not found", { status: 404 })
          : Response.json(altered);
      }
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("LeaderboardOutcomeCommitLines")) {
        const error = {
          type: "SERVICE_UNAVAILABLE",
          path: ["nodes", 0, "additions"],
          message: "The additions count for this commit is unavailable.",
        };
        options.alterError?.(error);
        return Response.json({
          data: {
            nodes: [null],
            ...(options.missingRateLimit ? {} : { rateLimit }),
          },
          errors: [error],
        });
      }
      if (body.query.includes("LeaderboardSearchReferences"))
        return Response.json({
          data: {
            search: {
              issueCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [pull],
            },
            rateLimit,
          },
        });
      if (body.query.includes("CorrectionMetadata"))
        return Response.json({ data: { nodes: [pull], rateLimit } });
      return base.call(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  return { call, requests: () => requests, restRequests: () => restRequests };
}

test("verified REST counters recover ordinary and merge commits and replay the raw error offline", async () => {
  for (const parentCount of [1, 2]) {
    const dir = await directory();
    const network = unavailableCounterTransport({
      parentCount,
      alterError:
        parentCount > 1
          ? (error) => {
              error.path = ["nodes", 0, "deletions"];
            }
          : undefined,
    });
    const options = {
      projects: ["asi"],
      directory: dir,
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    };
    const deps = {
      journal: baseline(),
      registry: registry(),
      token: "private-test-token",
      transport: network.call,
      now: new Date("2026-01-31T23:59:59Z"),
    };
    const first = await collectImplementationCorrections(options, deps);
    expect(first.receipt.ownershipComplete).toBe(true);
    const proof = first.manifest.candidates[0].proof;
    expect(proof.status).toBe("complete");
    if (proof.status !== "complete")
      throw new Error("expected complete source evidence");
    expect(proof.sources[0].commits[0]).toMatchObject({
      parentCount,
      additions: parentCount > 1 ? 0 : 2,
      deletions: parentCount > 1 ? 0 : 1,
    });
    expect(network.restRequests()).toBe(1);
    const before = network.requests();
    const repeated = await collectImplementationCorrections(options, deps);
    expect(network.requests()).toBe(before);
    expect(repeated.receipt.manifestDigest).toBe(first.receipt.manifestDigest);
    const raw = await Promise.all(
      (await readdir(join(dir, "objects"))).map((name) =>
        readFile(join(dir, "objects", name), "utf8"),
      ),
    );
    expect(
      raw.some((text) =>
        text.includes('"errors":[{"type":"SERVICE_UNAVAILABLE"'),
      ),
    ).toBe(true);
  }
});

test("REST recovery can supply a previously unavailable primary-author link", async () => {
  const dir = await directory();
  const network = unavailableCounterTransport({ unlinked: true });
  const result = await collectImplementationCorrections(
    {
      projects: ["asi"],
      directory: dir,
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    },
    {
      journal: baseline(),
      registry: registry(),
      token: "private-test-token",
      transport: network.call,
      now: new Date("2026-01-31T23:59:59Z"),
    },
  );
  const proof = result.manifest.candidates[0].proof;
  if (proof.status !== "complete")
    throw new Error("expected complete source evidence");
  expect(proof.sources[0].commits[0].author).toMatchObject({
    id: actor.id,
    kind: "User",
  });
});

test("REST counter recovery refuses wrong commit, repository, parents, author, stats and missing evidence", async () => {
  const alterations: Array<(value: Record<string, unknown>) => unknown> = [
    (value) => ({ ...value, node_id: "C_other" }),
    (value) => ({ ...value, sha: "b".repeat(40) }),
    (value) => ({
      ...value,
      url: `https://api.github.com/repos/other/repo/commits/${sha}`,
    }),
    (value) => ({ ...value, parents: [] }),
    (value) => ({ ...value, parents: [{ sha: "bad" }] }),
    (value) => ({
      ...value,
      author: {
        ...(value.author as Record<string, unknown>),
        node_id: "MDQ6VXNlcjQz",
      },
    }),
    (value) => ({ ...value, stats: { additions: -1, deletions: 1, total: 0 } }),
    (value) => ({ ...value, stats: { additions: 2, deletions: 1, total: 4 } }),
    (value) => ({
      ...value,
      stats: { additions: 0.5, deletions: 0.5, total: 1 },
    }),
    () => null,
  ];
  for (const alterRest of alterations) {
    const dir = await directory();
    const network = unavailableCounterTransport({ alterRest });
    await expect(
      collectImplementationCorrections(
        {
          projects: ["asi"],
          directory: dir,
          month: "2026-01",
          before: "2026-01-31T00:00:00.000Z",
        },
        {
          journal: baseline(),
          registry: registry(),
          token: "private-test-token",
          transport: network.call,
          now: new Date("2026-01-31T23:59:59Z"),
        },
      ),
    ).rejects.toThrow();
    await expect(readFile(join(dir, "manifest.json"))).rejects.toThrow();
  }
});

test("unrelated GraphQL errors never invoke historical REST counter recovery", async () => {
  for (const alterError of [
    (value: Record<string, unknown>) => {
      value.type = "FORBIDDEN";
    },
    (value: Record<string, unknown>) => {
      value.path = ["nodes", 0, "repository"];
    },
    (value: Record<string, unknown>) => {
      value.path = ["nodes", 5, "additions"];
    },
  ]) {
    const dir = await directory();
    const network = unavailableCounterTransport({ alterError });
    await expect(
      collectImplementationCorrections(
        {
          projects: ["asi"],
          directory: dir,
          month: "2026-01",
          before: "2026-01-31T00:00:00.000Z",
        },
        {
          journal: baseline(),
          registry: registry(),
          token: "private-test-token",
          transport: network.call,
          now: new Date("2026-01-31T23:59:59Z"),
        },
      ),
    ).rejects.toThrow();
    expect(network.restRequests()).toBe(0);
  }
});

test("ordinary line loaders retain their refusal and account for the unavailable query", async () => {
  const network = unavailableCounterTransport();
  const client = new GitHubGraphqlClient("private-test-token", network.call);
  const expected = fixture().commits.nodes[0].commit;
  const loader = new OutcomeCommitLineLoader(client);
  await expect(
    loader.hydrate("R_kgDOT23CXA", [
      {
        id: expected.id,
        oid: expected.oid,
        parentCount: 1,
        author: {
          ...actor,
          kind: "User",
          avatarUrl: "https://avatars.githubusercontent.com/u/42",
          url: "https://github.com/author",
        },
      },
    ]),
  ).rejects.toBeInstanceOf(CommitStatisticsUnavailableError);
  expect(client.getRateLimit().consumedDuringRun).toBe(1);
  expect(network.restRequests()).toBe(0);
});

test("a counter error without rate accounting is never admitted for cached recovery", async () => {
  const dir = await directory();
  const network = unavailableCounterTransport({ missingRateLimit: true });
  await expect(
    collectImplementationCorrections(
      {
        projects: ["asi"],
        directory: dir,
        month: "2026-01",
        before: "2026-01-31T00:00:00.000Z",
      },
      {
        journal: baseline(),
        registry: registry(),
        token: "private-test-token",
        transport: network.call,
        now: new Date("2026-01-31T23:59:59Z"),
      },
    ),
  ).rejects.toThrow();
  expect(network.restRequests()).toBe(0);
  for (const name of await readdir(join(dir, "requests"))) {
    const pointer = JSON.parse(
      await readFile(join(dir, "requests", name), "utf8"),
    );
    const envelope = JSON.parse(
      await readFile(join(dir, "objects", pointer.bodyDigest), "utf8"),
    );
    expect(envelope.errors).toBeUndefined();
  }
});
