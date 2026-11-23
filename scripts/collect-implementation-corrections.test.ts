import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPointAwards,
  emptyPointsJournal,
  latestPoints,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import { applyPointsImplementationCorrections } from "../src/lib/points-implementation-corrections";
import { findProject } from "../src/lib/projects.mjs";
import { collectTargetRepositories } from "../src/lib/repositories.mjs";
import {
  fixture as valueFixture,
  repository as valueRepository,
} from "../tests/value-binary-fixture";
import {
  base,
  commit,
  makeOriginal,
  actor as nativeActor,
  repository,
} from "../tests/value-promotion-fixture";
import type { FileChange } from "../workers/slopbot/value-evidence-types";
import {
  collectNativeMergeAcceptance,
  NATIVE_MERGE_CONTEXT,
} from "../workers/slopbot/value-native-merge";
import { prepareWorkUnitEvidence } from "../workers/slopbot/value-work-unit";
import {
  bindRetained,
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
import * as valueIngestion from "./value-ingestion";

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
            author: { user: who as typeof who | null },
          },
        },
      ],
    },
  };
}
function transport(merge = sha, node = fixture(merge)) {
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
            nodes: [node],
          },
        };
      else if (query.includes("CorrectionMetadata")) data = { nodes: [node] };
      else if (query.includes("LeaderboardOutcomeCommitLines"))
        data = {
          nodes: (body.variables.ids as string[]).map((id) => ({
            __typename: "Commit",
            id,
            oid: node.commits.nodes.find(({ commit }) => commit.id === id)
              ?.commit.oid,
            additions: 2,
            deletions: 1,
            repository: { id: "R_kgDOT23CXA" },
          })),
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

test("a complete census binds the head without assuming chronological commit order", async () => {
  const ancestor = "c".repeat(40);
  for (const list of [
    "head-first",
    "head-missing",
    "head-duplicated",
  ] as const) {
    const node = fixture();
    node.url = "https://github.com/elizaOS/asi/pull/1";
    const head = node.commits.nodes[0];
    const earlier = {
      commit: { ...head.commit, id: "C_ancestor", oid: ancestor },
    };
    node.commits.nodes =
      list === "head-first"
        ? [head, earlier]
        : list === "head-missing"
          ? [earlier]
          : [head, head];
    node.commits.totalCount = node.commits.nodes.length;
    const options = {
      projects: ["asi"],
      directory: await directory(),
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    };
    const network = transport(sha, node);
    const journal = baseline([{ ...award(), sourceUrl: node.url }]);
    const collection = collectImplementationCorrections(options, {
      journal,
      registry: registry(),
      token: "private-test-token",
      transport: network.call,
      now: new Date("2026-01-31T23:59:59Z"),
    });
    if (list === "head-missing") {
      await expect(collection).rejects.toThrow(
        "Complete census source identity or commit evidence is invalid",
      );
    } else if (list === "head-duplicated") {
      await expect(collection).rejects.toThrow(
        "commit totals do not match complete unique evidence",
      );
    } else {
      const result = await collection;
      expect(result.receipt.ownershipComplete).toBe(true);
      expect(result.receipt.completeProofs).toBe(1);
      const candidate = result.manifest.candidates[0];
      expect(candidate.proof).toMatchObject({
        status: "complete",
        sources: [{ headSha: sha, commits: [{ sha }, { sha: ancestor }] }],
      });
      const corrected = applyPointsImplementationCorrections(
        journal,
        result.manifest,
        [{ candidateId: candidate.id, eligible: true }],
        result.manifest.generatedAt,
        new Map(),
      );
      expect(corrected.dispositions[0].status).toBe("unchanged");
    }
  }
});

test("October opt-in holds both sides of a merged donor's shared commit", async () => {
  const donor = fixture();
  Object.assign(donor, {
    url: "https://github.com/elizaOS/asi/pull/1",
    mergedAt: "2026-10-15T00:00:02Z",
    updatedAt: "2026-10-15T00:00:02Z",
  });
  const carrier = {
    ...donor,
    id: "PR_carrier",
    number: 2,
    url: "https://github.com/elizaOS/asi/pull/2",
    mergedAt: "2026-10-15T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
    author: {
      ...donor.author,
      id: "MDQ6VXNlcjQz",
      login: "carrier",
      url: "https://github.com/carrier",
      avatarUrl: "https://avatars.githubusercontent.com/u/43",
    },
  };
  const base = transport();
  const network = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (body.query.includes("LeaderboardSearchReferences"))
        return Response.json({
          data: {
            search: {
              issueCount: 2,
              nodes: [carrier, donor],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
            rateLimit: {
              cost: 1,
              remaining: 4900,
              limit: 5000,
              resetAt: "2026-11-01T01:00:00Z",
            },
          },
        });
      const response = await base.call(input, init);
      if (!body.query.includes("CorrectionRepository")) return response;
      const repository = await response.json();
      repository.data.repository.createdAt = "2026-10-01T00:00:00Z";
      return Response.json(repository);
    },
    { preconnect: fetch.preconnect },
  );
  const before = "2026-11-01T00:00:00.000Z";
  const journal = appendPointAwards(
    emptyPointsJournal(before),
    [donor, carrier].map((pull) => ({
      ...award(),
      key: pointKey("asi", actor.id, "merged-pull-request", pull.id),
      sourceId: pull.id,
      sourceUrl: pull.url,
      workUnitId: `history_${pull.id}`,
      occurredAt: new Date(pull.mergedAt).toISOString(),
    })),
    "f".repeat(64),
    "github-merged-history-v1",
    before,
  );
  const options = {
    projects: ["asi"],
    directory: await directory(),
    before,
    octoberOriginalCredit: true,
  };
  const dependencies = {
    journal,
    registry: registry(),
    token: "fixture-token",
    transport: network,
    now: new Date(before),
  };
  const completed = await collectImplementationCorrections(
    options,
    dependencies,
  );
  expect(completed.receipt.ownershipComplete).toBe(true);
  expect(completed.receipt.heldProofs).toBe(2);
  expect(completed.receipt.limitations.map((entry) => entry.reason)).toEqual([
    "October replacement shares accepted commits with a merged donor PR",
    "October replacement shares accepted commits with a merged donor PR",
  ]);
  await expect(
    collectImplementationCorrections(
      { ...options, octoberOriginalCredit: false },
      dependencies,
    ),
  ).rejects.toThrow(
    "October original credit policy differs from the frozen campaign",
  );
});

test.each([
  "submitted-head",
  "distinct-squash",
  "mismatched-squash",
  "unavailable-squash",
  "null-merge",
] as const)(
  "Search omissions preserve earlier commit ownership for %s",
  async (acceptance) => {
    const unavailableAccepted = acceptance === "unavailable-squash";
    const missingMergeIdentity = acceptance === "null-merge";
    const earlierHeld = unavailableAccepted || missingMergeIdentity;
    const overlapSha = acceptance === "submitted-head" ? sha : "d".repeat(40);
    const earlier = fixture(missingMergeIdentity ? "" : overlapSha);
    earlier.url = "https://github.com/elizaOS/asi/pull/1";
    earlier.mergedAt = "2026-01-14T00:00:00Z";
    earlier.updatedAt = earlier.mergedAt;
    const laterSha = "c".repeat(40);
    const later = fixture(laterSha);
    later.id = "PR_later";
    later.number = 2;
    later.url = "https://github.com/elizaOS/asi/pull/2";
    later.headRefOid = laterSha;
    const originalCommit = earlier.commits.nodes[0].commit;
    const overlapCommit =
      acceptance === "submitted-head"
        ? originalCommit
        : { ...originalCommit, id: "C_squash", oid: overlapSha };
    const independentAuthor = {
      ...earlier.author,
      id: "MDQ6VXNlcjQz",
      login: "contributor",
      avatarUrl: "https://avatars.githubusercontent.com/u/43",
      url: "https://github.com/contributor",
    };
    const independentCommit = {
      ...originalCommit,
      id: "C_later",
      oid: laterSha,
      author: { user: independentAuthor },
    };
    later.commits.totalCount = 2;
    later.commits.nodes = [
      { commit: overlapCommit },
      { commit: independentCommit },
    ];
    const earlierAward = {
      ...award(),
      occurredAt: new Date(earlier.mergedAt).toISOString(),
      sourceUrl: earlier.url,
    };
    const laterAward = {
      ...award(),
      key: pointKey("asi", actor.id, "merged-pull-request", later.id),
      sourceId: later.id,
      sourceUrl: later.url,
      workUnitId: "history_PR_later",
    };
    const unrelatedSha = "f".repeat(40);
    const unrelatedCommit = {
      ...independentCommit,
      id: "C_unrelated",
      oid: unrelatedSha,
    };
    const other = fixture(unrelatedSha);
    other.id = "PR_other";
    other.number = 3;
    other.url = "https://github.com/elizaOS/asi/pull/3";
    other.headRefOid = unrelatedSha;
    other.commits.nodes = [{ commit: unrelatedCommit }];
    const otherAward = {
      ...award(),
      key: pointKey("asi", actor.id, "merged-pull-request", other.id),
      sourceId: other.id,
      sourceUrl: other.url,
      workUnitId: "history_PR_other",
    };
    const journal = baseline([earlierAward, laterAward, otherAward]);
    const commitShas = new Map(
      [originalCommit, overlapCommit, independentCommit, unrelatedCommit].map(
        ({ id, oid }) => [id, oid],
      ),
    );
    const searchedNodes = earlierHeld ? [later, other] : [later];
    const base = transport();
    const metadataBatches: string[][] = [];
    const acceptedObjectReads: string[] = [];
    const network = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname !== "/graphql") {
          expect(url.pathname).toBe(
            `/repos/SlopDotCash/asi/git/commits/${overlapSha}`,
          );
          acceptedObjectReads.push(url.pathname);
          if (unavailableAccepted)
            return Response.json({ message: "Not Found" }, { status: 404 });
          return Response.json({
            sha:
              acceptance === "mismatched-squash" ? "f".repeat(40) : overlapSha,
            tree: { sha: "e".repeat(40) },
            parents: [{ sha: earlier.baseRefOid }],
          });
        }
        const { query, variables } = JSON.parse(String(init?.body));
        let data: Record<string, unknown>;
        let missingIndex = -1;
        if (query.includes("LeaderboardSearchReferences")) {
          data = {
            search: {
              issueCount: searchedNodes.length,
              nodes: searchedNodes,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          };
        } else if (query.includes("CorrectionMetadata")) {
          const ids: string[] = variables.ids;
          metadataBatches.push([...ids]);
          missingIndex = ids.indexOf(otherAward.sourceId);
          data = {
            nodes: ids.map((id) => {
              if (id === earlier.id) return earlier;
              expect(id).toBe(otherAward.sourceId);
              return null;
            }),
          };
        } else if (query.includes("LeaderboardOutcomeCommitLines")) {
          data = {
            nodes: (variables.ids as string[]).map((id) => ({
              __typename: "Commit",
              id,
              oid: commitShas.get(id),
              additions: 2,
              deletions: 1,
              repository: { id: earlier.repository.id },
            })),
          };
        } else {
          return await base.call(input, init);
        }
        return Response.json({
          ...(acceptance === "submitted-head" && missingIndex >= 0
            ? {
                errors: [
                  {
                    type: "NOT_FOUND",
                    path: ["nodes", missingIndex],
                    message: `Could not resolve to a node with the global id of '${otherAward.sourceId}'.`,
                  },
                ],
              }
            : {}),
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
      directory: await directory(),
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    };
    const dependencies = {
      journal,
      registry: registry(),
      token: "fixture-token",
      transport: network,
      now: new Date("2026-01-31T23:59:59Z"),
    };
    const collection = collectImplementationCorrections(options, dependencies);
    if (acceptance === "mismatched-squash") {
      await expect(collection).rejects.toThrow(
        "Baseline census accepted object differs from the linked merge commit",
      );
      await expect(
        readFile(join(options.directory, "manifest.json")),
      ).rejects.toThrow();
      return;
    }
    const result = await collection;
    const candidates = new Map(
      result.manifest.candidates.map((candidate) => [
        candidate.sourceId,
        candidate,
      ]),
    );
    expect(result.receipt.ownershipComplete).toBe(true);
    if (earlierHeld) {
      expect(candidates.get(earlier.id)?.proof).toEqual({ status: "held" });
      expect(candidates.get(other.id)?.proof).toMatchObject({
        status: "complete",
        sources: [
          {
            commits: [{ sha: unrelatedSha, firstAcceptedSourceId: other.id }],
          },
        ],
      });
    } else {
      expect(candidates.get(earlier.id)?.proof).toMatchObject({
        status: "complete",
        sources: [{ commits: [{ sha, firstAcceptedSourceId: earlier.id }] }],
      });
      expect(candidates.get(other.id)?.proof).toEqual({ status: "held" });
    }
    if (unavailableAccepted) {
      expect(candidates.get(later.id)?.proof).toEqual({ status: "held" });
    } else {
      expect(candidates.get(later.id)?.proof).toMatchObject({
        status: "complete",
        sources: [
          {
            commits: [
              {
                sha: overlapSha,
                firstAcceptedSourceId: missingMergeIdentity
                  ? later.id
                  : earlier.id,
              },
              { sha: laterSha, firstAcceptedSourceId: later.id },
            ],
          },
        ],
      });
    }
    expect(metadataBatches.map((ids) => ids.sort())).toEqual([
      earlierHeld ? [earlier.id] : [earlier.id, other.id].sort(),
    ]);
    expect(acceptedObjectReads).toHaveLength(
      acceptance === "submitted-head" || missingMergeIdentity ? 0 : 1,
    );
    if (missingMergeIdentity) {
      expect(result.receipt.limitations).toContainEqual({
        id: earlier.id,
        reason: "accepted-merge-identity-unavailable",
      });
    }
    const applied = applyPointsImplementationCorrections(
      journal,
      result.manifest,
      result.manifest.candidates.map(({ id }) => ({
        candidateId: id,
        eligible: true,
      })),
      result.manifest.generatedAt,
      new Map(),
    );
    const current = latestPoints(applied.journal);
    const before = latestPoints(journal);
    const reallocatedAward = earlierHeld ? otherAward : laterAward;
    expect(current.get(earlierAward.key)).toEqual(before.get(earlierAward.key));
    if (!missingMergeIdentity) {
      const heldAward = unavailableAccepted ? laterAward : otherAward;
      expect(current.get(heldAward.key)).toEqual(before.get(heldAward.key));
    }
    expect(current.get(reallocatedAward.key)?.award.amount).toBe(0);
    expect(
      current.get(
        pointKey(
          "asi",
          independentAuthor.id,
          "merged-pull-request",
          reallocatedAward.sourceId,
        ),
      )?.award,
    ).toMatchObject({
      amount: reallocatedAward.amount,
      occurredAt: reallocatedAward.occurredAt,
    });
    const replay = await collectImplementationCorrections(options, {
      ...dependencies,
      transport: Object.assign(
        async () => {
          throw new Error("Offline replay attempted a GitHub read");
        },
        { preconnect: fetch.preconnect },
      ),
    });
    expect(replay.receipt.requests).toBe(0);
    expect(replay.receipt.censusDigest).toBe(result.receipt.censusDigest);
    expect(replay.receipt.manifestDigest).toBe(result.receipt.manifestDigest);
  },
);

test("complete census reuse holds mismatched recorded sources", async () => {
  for (const mismatch of ["url", "occurredAt"] as const) {
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

// January's feature PR and February's promotion PR list the same accepted
// commit, so the repository's one commit-line loader carries January's
// statistics into February's request.
function promotionTransport() {
  const january = { ...fixture(), baseRefName: "development" };
  const shared = january.commits.nodes[0];
  const next = {
    commit: { ...shared.commit, id: "C_next", oid: "c".repeat(40) },
  };
  const february = {
    ...fixture("d".repeat(40)),
    id: "PR_promotion",
    number: 2,
    url: "https://github.com/SlopDotCash/asi/pull/2",
    updatedAt: "2026-02-10T00:00:00Z",
    mergedAt: "2026-02-10T00:00:00Z",
    headRefOid: next.commit.oid,
    commits: {
      totalCount: 2,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [shared, next],
    },
  };
  const lines: Record<string, { oid: string; additions: number }> = {
    C_source: { oid: sha, additions: 2 },
    C_next: { oid: next.commit.oid, additions: 5 },
  };
  const searchedMonths: string[] = [];
  const call = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
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
      else if (query.includes("LeaderboardSearchReferences")) {
        const isJanuary = String(body.variables.searchQuery).includes(
          "merged:2026-01-01",
        );
        searchedMonths.push(isJanuary ? "2026-01" : "2026-02");
        data = {
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [isJanuary ? january : february],
          },
        };
      } else if (query.includes("CorrectionMetadata"))
        data = {
          nodes: (body.variables.ids as string[]).map((id) =>
            id === january.id ? january : february,
          ),
        };
      else if (query.includes("LeaderboardOutcomeCommitLines"))
        data = {
          nodes: (body.variables.ids as string[]).map((id) => ({
            __typename: "Commit",
            id,
            oid: lines[id].oid,
            additions: lines[id].additions,
            deletions: 1,
            repository: { id: "R_kgDOT23CXA" },
          })),
        };
      else throw new Error(`Unexpected fixture query: ${query.slice(0, 70)}`);
      return Response.json({
        data: {
          ...data,
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 4900,
            resetAt: "2026-03-01T00:00:00Z",
          },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
  return { call, searchedMonths };
}

test("a bounded run refuses a later census month until the earlier months are collected", async () => {
  const run = (dir: string, network: { call: typeof fetch }, month?: string) =>
    collectImplementationCorrections(
      {
        projects: ["asi"],
        before: "2026-01-31T00:00:00.000Z",
        directory: dir,
        ...(month ? { month } : {}),
      },
      {
        journal: baseline(),
        registry: registry(),
        token: "private-test-token",
        transport: network.call,
        now: new Date("2026-02-20T00:00:00Z"),
      },
    );
  const fresh = await run(await directory(), promotionTransport());
  expect(fresh.receipt.ownershipComplete).toBe(true);
  expect(fresh.receipt.completeProofs).toBe(1);

  // February first would cache a statistics request that a resumed campaign,
  // which loads January's shared commit first, never asks again.
  const dir = await directory(),
    early = promotionTransport();
  await expect(run(dir, early, "2026-02")).rejects.toThrow(
    "Collect earlier census months first",
  );
  expect(early.searchedMonths).toEqual([]);
  const resumed = await run(dir, promotionTransport());
  expect(resumed.receipt.ownershipComplete).toBe(true);
  expect(resumed.receipt.manifestDigest).toBe(fresh.receipt.manifestDigest);

  const ordered = await directory(),
    network = promotionTransport();
  await run(ordered, network, "2026-01");
  await run(ordered, network, "2026-02");
  expect(network.searchedMonths).toEqual(["2026-01", "2026-02"]);
  const complete = await run(ordered, promotionTransport());
  expect(complete.receipt.manifestDigest).toBe(fresh.receipt.manifestDigest);
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
    const waitingSiblings: Array<() => void> = [];
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
          // Start every sibling before a quota response can interrupt cache reads.
          await new Promise<void>((resolve) => {
            waitingSiblings.push(resolve);
            if (waitingSiblings.length === 3) {
              for (const release of waitingSiblings.splice(0)) release();
            }
          });
          if (url.pathname.endsWith("/reviews"))
            return Response.json(
              { message: "Secondary rate limit" },
              { status: 403, headers: { "retry-after": "5" } },
            );
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

function discussionTransport(
  result:
    | "complete"
    | "overflow"
    | "quota"
    | "missing-rate"
    | "recorded-before-cap",
) {
  const base = transport();
  const calls = {
    pull: 0,
    reviews: 0,
    comments: 0,
    inline: 0,
    timeline: 0,
    envelope: 0,
  };
  const rateLimit = {
    cost: 1,
    limit: 5000,
    remaining: 4900,
    resetAt: "2026-02-01T01:00:00Z",
  };
  const page = {
    nodes: [],
    totalCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
  };
  const call = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const { pathname } = new URL(String(input));
      if (pathname.endsWith("/asi/pulls/1")) {
        calls.pull++;
        const node = fixture();
        return Response.json({
          node_id: node.id,
          number: node.number,
          html_url: node.url,
          updated_at: node.updatedAt,
          merged_at: node.mergedAt,
          head: { sha },
          state: "closed",
          body: node.body,
          comments: 0,
          review_comments: 0,
        });
      }
      if (pathname.endsWith("/reviews")) {
        calls.reviews++;
        return Response.json([]);
      }
      if (pathname.endsWith("/issues/1/comments")) {
        calls.comments++;
        return Response.json([]);
      }
      if (pathname.endsWith("/pulls/1/comments")) {
        calls.inline++;
        return Response.json([]);
      }
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      if (query.includes("HistoricalValueDiscussion")) {
        calls.envelope++;
        if (result === "quota")
          return Response.json(
            { message: "Secondary rate limit" },
            { status: 403, headers: { "retry-after": "17" } },
          );
        const node = fixture();
        return Response.json({
          data: {
            rateLimit:
              result === "missing-rate"
                ? undefined
                : result === "recorded-before-cap"
                  ? { ...rateLimit, cost: 4901, remaining: 99 }
                  : rateLimit,
            repository: {
              ...node.repository,
              nameWithOwner: "elizaOS/asi",
              pullRequest: {
                ...node,
                id: node.id,
                state: "MERGED",
                comments:
                  result === "overflow"
                    ? { ...page, pageInfo: { hasNextPage: true } }
                    : page,
                reviewThreads: page,
                timelineItems: { ...page, totalCount: 36 },
              },
            },
          },
        });
      }
      if (query.includes("CROSS_REFERENCED_EVENT")) {
        calls.timeline++;
        return Response.json({
          data: {
            rateLimit,
            repository: {
              pullRequest: { id: "PR_source", timelineItems: page },
            },
          },
        });
      }
      if (query.includes("LeaderboardSearchReferences")) {
        const node = fixture();
        (node.commits.nodes[0].commit.author as { user: unknown }).user = null;
        return Response.json({
          data: {
            rateLimit,
            search: { issueCount: 1, pageInfo: page.pageInfo, nodes: [node] },
          },
        });
      }
      return base.call(input, init);
    },
    { preconnect: fetch.preconnect },
  );
  return { call, calls };
}

async function discussionCampaign(
  which: Parameters<typeof discussionTransport>[0],
) {
  const network = discussionTransport(which);
  const options = {
    projects: ["asi"],
    directory: await directory(),
    before: "2026-01-31T00:00:00.000Z",
    month: "2026-01",
  };
  const dependencies = {
    journal: baseline(),
    registry: registry(),
    token: "fixture-token",
    now: new Date("2026-01-31T23:59:59Z"),
    transport: network.call,
    quotaNow: () => 1_000_000,
  };
  return { options, dependencies, calls: network.calls };
}

test("historical discussion opt-in only fetches new envelopes and replays exact saved evidence in apply mode", async () => {
  const graph = await discussionCampaign("complete");
  const graphFirst = await collectImplementationCorrections(
    { ...graph.options, graphqlDiscussions: true },
    graph.dependencies,
  );
  expect(graphFirst.receipt.completeProofs).toBe(1);
  expect(graph.calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 0,
    inline: 0,
    timeline: 0,
    envelope: 1,
  });
  const replay = await collectImplementationCorrections(
    graph.options,
    graph.dependencies,
  );
  expect(replay.receipt.requests).toBe(0);
  expect(replay.receipt.manifestDigest).toBe(graphFirst.receipt.manifestDigest);
  expect(graph.calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 0,
    inline: 0,
    timeline: 0,
    envelope: 1,
  });

  const rest = await discussionCampaign("complete");
  const restFirst = await collectImplementationCorrections(
    rest.options,
    rest.dependencies,
  );
  expect(restFirst.receipt.manifestDigest).toBe(
    graphFirst.receipt.manifestDigest,
  );
  const covered = await collectImplementationCorrections(
    { ...rest.options, graphqlDiscussions: true },
    rest.dependencies,
  );
  expect(covered.receipt.requests).toBe(0);
  expect(rest.calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 1,
    inline: 1,
    timeline: 1,
    envelope: 0,
  });
});

test("historical discussion falls back once per REST page when a GraphQL connection is partial", async () => {
  const { options, dependencies, calls } = await discussionCampaign("overflow");
  const filled = await collectImplementationCorrections(
    { ...options, graphqlDiscussions: true },
    dependencies,
  );
  expect(filled.receipt.completeProofs).toBe(1);
  expect(calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 1,
    inline: 1,
    timeline: 1,
    envelope: 1,
  });
});

test("historical discussion never replays an envelope missing rate evidence", async () => {
  const { options, dependencies, calls } =
    await discussionCampaign("missing-rate");
  const first = await collectImplementationCorrections(
    { ...options, graphqlDiscussions: true },
    dependencies,
  );
  expect(first.receipt.completeProofs).toBe(1);
  expect(calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 1,
    inline: 1,
    timeline: 1,
    envelope: 1,
  });
  const replay = await collectImplementationCorrections(
    { ...options, graphqlDiscussions: true },
    dependencies,
  );
  expect(replay.receipt.manifestDigest).toBe(first.receipt.manifestDigest);
  expect(replay.receipt.requests).toBe(0);
});

test("a live budget error after recording a complete envelope keeps exact replay semantics", async () => {
  const { options, dependencies, calls } = await discussionCampaign(
    "recorded-before-cap",
  );
  const first = await collectImplementationCorrections(
    { ...options, graphqlDiscussions: true },
    dependencies,
  );
  expect(first.receipt.completeProofs).toBe(1);
  expect(first.receipt.reportedGraphqlCost).toBeGreaterThan(4900);
  expect(calls).toEqual({
    pull: 1,
    reviews: 1,
    comments: 0,
    inline: 0,
    timeline: 0,
    envelope: 1,
  });
  const replay = await collectImplementationCorrections(options, dependencies);
  expect(replay.receipt.manifestDigest).toBe(first.receipt.manifestDigest);
  expect(replay.receipt.requests).toBe(0);
});

test("historical discussion secondary quota remains sticky across the optional fallback", async () => {
  const { options, dependencies, calls } = await discussionCampaign("quota");
  await expect(
    collectImplementationCorrections(
      { ...options, graphqlDiscussions: true },
      dependencies,
    ),
  ).rejects.toMatchObject({ kind: "quota", retryAtMs: 1_019_000 });
  await expect(
    readFile(join(options.directory, "manifest.json"), "utf8"),
  ).rejects.toThrow();
  expect(calls.envelope).toBe(1);
  expect(calls.inline + calls.comments + calls.timeline).toBe(0);
});

test.each([true, false])(
  "historical discussion waits for a late sibling quota stop (GraphQL enabled: %s)",
  async (graphqlDiscussions) => {
    const { options, dependencies } = await discussionCampaign("complete");
    let quotaReads = 0;
    const transport = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const { pathname } = new URL(String(input));
        if (
          pathname.endsWith("/reviews") ||
          (!graphqlDiscussions && pathname.endsWith("/issues/1/comments"))
        )
          return new Response(null, { status: 404 });
        const lateRead = graphqlDiscussions
          ? pathname === "/graphql" &&
            String(init?.body).includes("HistoricalValueDiscussion")
          : pathname.endsWith("/pulls/1/comments");
        if (!lateRead) return dependencies.transport(input, init);
        quotaReads += 1;
        if (graphqlDiscussions && quotaReads === 1)
          return Response.json(
            { message: "Transient gateway failure" },
            { status: 503 },
          );
        await Bun.sleep(30);
        return Response.json(
          { message: "Secondary rate limit" },
          { status: 403, headers: { "retry-after": "17" } },
        );
      },
      { preconnect: fetch.preconnect },
    );
    await expect(
      collectImplementationCorrections(
        { ...options, graphqlDiscussions },
        { ...dependencies, transport },
      ),
    ).rejects.toMatchObject({ kind: "quota", retryAtMs: 1_019_000 });
    expect(quotaReads).toBe(graphqlDiscussions ? 2 : 1);
    for (const filename of ["manifest.json", "collection-receipt.json"])
      await expect(
        readFile(join(options.directory, filename), "utf8"),
      ).rejects.toThrow();
  },
);

function promotedCommitTransport(
  quotaOnFebruarySearch: boolean,
  clock: () => number,
) {
  const user = (id: string, login: string) => ({
    __typename: "User",
    id,
    login,
    avatarUrl: `https://avatars.githubusercontent.com/u/${login}`,
    url: `https://github.com/${login}`,
  });
  const author = user(actor.id, actor.login);
  const bob = user("MDQ6VXNlcjQz", "bob");
  const lines: Record<string, { oid: string; additions: number }> = {
    C_a: { oid: sha, additions: 10 },
    C_b: { oid: "e".repeat(40), additions: 2 },
    C_c: { oid: "c".repeat(40), additions: 5 },
  };
  const commit = (id: string, user: unknown) => ({
    commit: {
      id,
      oid: lines[id].oid,
      parents: { totalCount: 1 },
      author: { user },
    },
  });
  const pull = (
    id: string,
    number: number,
    mergedAt: string,
    nodes: unknown[],
  ) => ({
    ...fixture(),
    id,
    number,
    url: `https://github.com/SlopDotCash/asi/pull/${number}`,
    updatedAt: mergedAt,
    mergedAt,
    additions: 12,
    deletions: 0,
    baseRefName: number === 1 ? "development" : "main",
    headRefOid: lines.C_b.oid,
    mergeCommit: { oid: "d".repeat(40) },
    commits: {
      totalCount: nodes.length,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes,
    },
  });
  // GitHub lists bob's commit without an account link in the January feature
  // PR and with it in the February promotion PR that carries the same commit.
  const january = pull("PR_source", 1, "2026-01-15T00:00:00Z", [
    commit("C_a", null),
    commit("C_b", author),
  ]);
  const february = pull("PR_promotion", 2, "2026-02-10T00:00:00Z", [
    commit("C_a", bob),
    commit("C_b", author),
    commit("C_c", author),
  ]);
  let februarySearches = 0;
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/asi/pulls/1"))
        return Response.json({
          node_id: "PR_source",
          number: 1,
          body: "Fix",
          head: { sha: lines.C_b.oid },
          merged_at: when,
          comments: 0,
          review_comments: 0,
        });
      if (url.pathname !== "/graphql") return Response.json([]);
      const body = JSON.parse(String(init?.body));
      const query: string = body.query;
      let data: Record<string, unknown>;
      if (query.includes("CROSS_REFERENCED_EVENT"))
        data = {
          repository: {
            pullRequest: {
              id: "PR_source",
              timelineItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        };
      else if (query.includes("CorrectionRepository"))
        data = {
          repository: {
            id: "R_kgDOT23CXA",
            nameWithOwner: "SlopDotCash/asi",
            isPrivate: false,
            createdAt: "2026-01-01T00:00:00Z",
          },
        };
      else if (query.includes("LeaderboardSearchReferences")) {
        const isJanuary = String(body.variables.searchQuery).includes(
          "merged:2026-01-01",
        );
        if (!isJanuary && quotaOnFebruarySearch && februarySearches++ === 0)
          return Response.json(
            { message: "API rate limit exceeded" },
            {
              status: 403,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(Math.floor(clock() / 1000) + 5),
              },
            },
          );
        data = {
          search: {
            issueCount: 1,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [isJanuary ? january : february],
          },
        };
      } else if (query.includes("LeaderboardOutcomeCommitLines"))
        data = {
          nodes: (body.variables.ids as string[]).map((id) => ({
            __typename: "Commit",
            id,
            oid: lines[id].oid,
            additions: lines[id].additions,
            deletions: 0,
            repository: { id: "R_kgDOT23CXA" },
          })),
        };
      else throw new Error(`Unexpected fixture query: ${query.slice(0, 70)}`);
      return Response.json({
        data: {
          ...data,
          rateLimit: {
            cost: 1,
            limit: 5000,
            remaining: 4900,
            resetAt: "2026-03-01T00:00:00Z",
          },
        },
      });
    },
    { preconnect: fetch.preconnect },
  );
}

test("resumed months keep a later month's verified author link like an uninterrupted census", async () => {
  const now = new Date("2026-02-20T00:00:00Z");
  let clock = now.getTime();
  const deps = (quota = false) => ({
    journal: baseline([award(12)]),
    registry: registry(),
    token: "private-test-token",
    transport: promotedCommitTransport(quota, () => clock),
    now,
  });
  const options = async () => ({
    projects: ["asi"],
    directory: await directory(),
    before: "2026-01-31T00:00:00.000Z",
  });
  const linkedAuthor = (
    result: Awaited<ReturnType<typeof collectImplementationCorrections>>,
  ) => {
    const proof = result.manifest.candidates[0].proof;
    if (proof.status !== "complete") return `held:${proof.status}`;
    return proof.sources[0].commits.find((commit) => commit.sha === sha)?.author
      ?.login;
  };

  const freshOptions = await options();
  const fresh = await collectImplementationCorrections(freshOptions, deps());
  expect(fresh.receipt.ownershipComplete).toBe(true);
  expect(linkedAuthor(fresh)).toBe("bob");

  // Both months now come from their census parts, as in a resume_run apply.
  const replay = await collectImplementationCorrections(freshOptions, deps());
  expect(linkedAuthor(replay)).toBe("bob");
  expect(replay.receipt.manifestDigest).toBe(fresh.receipt.manifestDigest);

  // A quota stop in February makes the next pass read January from disk.
  const waits: number[] = [];
  const resumed = await collectWithQuotaResume(
    { ...(await options()), resumeForSeconds: 300 },
    deps(true),
    {
      now: () => clock,
      wait: async (milliseconds) => {
        waits.push(milliseconds);
        clock += milliseconds;
      },
    },
  );
  expect(waits).toHaveLength(1);
  expect(resumed.receipt.ownershipComplete).toBe(true);
  expect(linkedAuthor(resumed)).toBe("bob");
  expect(resumed.receipt.manifestDigest).toBe(fresh.receipt.manifestDigest);
});

function relatedHistoricalFixture(
  original:
    | "empty"
    | "bound"
    | "ambiguous"
    | "wrong-head"
    | "disjoint"
    | "incomplete-disjoint"
    | "renamed-overlap",
  mixed?: "linked" | "binding-mismatch" | "linked-mismatch",
) {
  const f = valueFixture({ textOnly: true, direct: true });
  const base = transport();
  const rateLimit = {
    cost: 1,
    limit: 5000,
    remaining: 4900,
    resetAt: "2026-02-01T01:00:00Z",
  };
  const accepted = fixture();
  const repository = "elizaOS/asi";
  const path = `/repos/${repository}`;
  const url = `https://github.com/${repository}/pull/2`;
  const merged = accepted.mergedAt;
  const linkedSha = "d".repeat(40);
  const linkedUser = {
    __typename: "User",
    id: "U_linked",
    login: "linked",
    avatarUrl: "https://avatars.githubusercontent.com/u/43",
    url: "https://github.com/linked",
  };
  const linkedCommit = {
    ...accepted.commits.nodes[0].commit,
    id: "C_linked",
    oid: linkedSha,
    author: { user: null },
  };
  Object.assign(accepted, {
    url,
    number: 2,
    headRefOid: mixed ? linkedSha : f.pull.head.sha,
    additions: mixed ? 3 : 1,
    deletions: 0,
  });
  Object.assign(accepted.commits.nodes[0].commit, {
    oid: f.pull.head.sha,
    author: {
      user:
        mixed === "binding-mismatch"
          ? {
              ...linkedUser,
              __typename: "Bot",
              id: "BOT_GitHub",
              login: "agent",
            }
          : null,
    },
  });
  if (mixed) {
    accepted.commits.totalCount = 2;
    accepted.commits.nodes.push({ commit: linkedCommit });
  }
  const promotion = {
    ...accepted,
    id: "PR_promotion",
    number: 3,
    url: `https://github.com/${repository}/pull/3`,
    mergedAt: "2026-02-10T00:00:00Z",
    updatedAt: "2026-02-10T00:00:00Z",
    commits: {
      ...accepted.commits,
      totalCount: 1,
      nodes: [{ commit: { ...linkedCommit, author: { user: linkedUser } } }],
    },
  };
  const originalId = "PR_original";
  const bound = original === "bound" || original === "wrong-head";
  const originalUrl = `https://github.com/${repository}/pull/1`;
  const pull = (number: number) => ({
    ...f.pull,
    number,
    node_id: number === 2 ? accepted.id : originalId,
    html_url: number === 2 ? url : originalUrl,
    merged_at: number === 2 ? merged : null,
    closed_at: number === 2 ? merged : "2026-01-14T00:00:00Z",
    merge_commit_sha: number === 2 ? f.pull.merge_commit_sha : null,
    merged_by: number === 2 ? f.pull.merged_by : null,
    comments: number === 1 && bound ? 1 : 0,
    user:
      number === 2 && mixed
        ? { node_id: actor.id, login: actor.login, type: "User" }
        : f.pull.user,
    head:
      number === 1 && original === "wrong-head"
        ? { sha }
        : number === 2 && mixed
          ? { sha: linkedSha }
          : f.pull.head,
    changed_files:
      number === 1 && original === "empty"
        ? 0
        : number === 1 && original === "incomplete-disjoint"
          ? 2
          : number === 2 && mixed
            ? 2
            : 1,
    commits:
      number === 1 && original === "empty" ? 0 : number === 2 && mixed ? 2 : 1,
  });
  const linkedFile = {
    filename: "own.ts",
    status: "added",
    additions: 2,
    deletions: 0,
    patch:
      "@@ -0,0 +1,2 @@\n+export const own = true;\n+export const other = true;",
    blob_url: `https://github.com/${repository}/blob/${linkedSha}/own.ts`,
  };
  if (mixed) {
    const files = new Map([
      ["fix.ts", new TextEncoder().encode("export const fixed = true;\n")],
      [
        "own.ts",
        new TextEncoder().encode(
          "export const own = true;\nexport const other = true;\n",
        ),
      ],
    ]);
    f.bind(linkedSha, files, [f.pull.head.sha]);
    f.bind(f.pull.merge_commit_sha, files, [f.pull.base.sha, linkedSha]);
  }
  const reference = (number: number) => ({
    source: {
      __typename: "PullRequest",
      id: number === 2 ? accepted.id : originalId,
      number,
      url: `https://github.com/${repository}/pull/${number}`,
      repository: { nameWithOwner: repository, isPrivate: false },
    },
  });
  const calls = new Set<string>();
  const call = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = new URL(String(input));
      if (endpoint.pathname === "/graphql") {
        const { query, variables } = JSON.parse(String(init?.body));
        if (query.includes("LeaderboardSearchReferences"))
          return Response.json({
            data: {
              search: {
                issueCount: 1,
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  mixed &&
                  String(variables.searchQuery).includes("merged:2026-02-01")
                    ? promotion
                    : accepted,
                ],
              },
              rateLimit,
            },
          });
        if (query.includes("LeaderboardOutcomeCommitLines"))
          return Response.json({
            data: {
              nodes: (variables.ids as string[]).map((id) => ({
                __typename: "Commit",
                id,
                oid: id === "C_linked" ? linkedSha : f.pull.head.sha,
                additions: id === "C_linked" ? 2 : 1,
                deletions: 0,
                repository: { id: accepted.repository.id },
              })),
              rateLimit,
            },
          });
        if (query.includes("CROSS_REFERENCED_EVENT"))
          return Response.json({
            data: {
              repository: {
                pullRequest: {
                  id: variables.number === 2 ? accepted.id : originalId,
                  timelineItems: {
                    nodes: [reference(variables.number === 2 ? 1 : 2)],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
              rateLimit,
            },
          });
        return base.call(input, init);
      }
      const full = endpoint.pathname + endpoint.search;
      calls.add(full);
      if (full === path)
        return Response.json({
          id: 42,
          node_id: accepted.repository.id,
          private: false,
        });
      if (full === `${path}/pulls/1`) return Response.json(pull(1));
      if (full === `${path}/pulls/2`) return Response.json(pull(2));
      if (full.includes("/issues/1/comments?") && bound)
        return Response.json([
          {
            node_id: "IC_retained",
            html_url: `${originalUrl}#issuecomment-1`,
            body: "Retained changes from #2.",
            user: f.pull.merged_by,
            created_at: "2026-01-15T01:00:00Z",
            updated_at: "2026-01-15T01:00:00Z",
          },
        ]);
      if (original === "empty" && /\/pulls\/1\/(commits|files)\?/u.test(full))
        return Response.json([]);
      if (
        ["disjoint", "incomplete-disjoint", "renamed-overlap"].includes(
          original,
        ) &&
        full.includes(`/commits/${"e".repeat(40)}?`)
      )
        return Response.json({
          sha: "e".repeat(40),
          parents: [{ sha: f.pull.base.sha }],
          stats: { additions: 1, deletions: 0, total: 1 },
          files: [{ ...f.files[0], filename: "adjacent.ts" }],
        });
      const remapped = full
        .replace(path, `/repos/${valueRepository.id}`)
        .replace(/\/(pulls|issues)\/2(?=\/|$)/u, "/$1/1");
      const evidence = await f.client.get<unknown>(remapped);
      if (/\/pulls\/[12]\/commits\?/u.test(full) && Array.isArray(evidence)) {
        for (const commit of evidence) commit.author = null;
        if (mixed && full.includes("/pulls/2/"))
          evidence.push({
            ...evidence[0],
            sha: linkedSha,
            parents: [{ sha: f.pull.head.sha }],
            author:
              mixed === "linked-mismatch"
                ? { node_id: "U_other", login: "other", type: "User" }
                : null,
          });
      }
      if (mixed && full.includes("/pulls/2/files?") && Array.isArray(evidence))
        evidence.push(linkedFile);
      if (mixed && full.includes(`/commits/${f.pull.merge_commit_sha}?`))
        return Response.json({
          ...(evidence as Record<string, unknown>),
          parents: [{ sha: f.pull.base.sha }, { sha: linkedSha }],
          stats: { additions: 3, deletions: 0, total: 3 },
          files: [...f.files, linkedFile],
        });
      if (mixed && full.includes(`/commits/${linkedSha}?`))
        return Response.json({
          sha: linkedSha,
          parents: [{ sha: f.pull.head.sha }],
          stats: { additions: 2, deletions: 0, total: 2 },
          files: [linkedFile],
        });
      if (
        ["disjoint", "incomplete-disjoint", "renamed-overlap"].includes(
          original,
        ) &&
        full.includes("/pulls/1/files?") &&
        Array.isArray(evidence)
      )
        evidence.forEach((file) => {
          file.filename = "adjacent.ts";
          if (original === "renamed-overlap") file.previous_filename = "fix.ts";
        });
      if (
        ["disjoint", "incomplete-disjoint", "renamed-overlap"].includes(
          original,
        ) &&
        full.includes("/pulls/1/commits?") &&
        Array.isArray(evidence)
      )
        evidence.forEach((commit) => {
          commit.sha = "e".repeat(40);
        });
      return Response.json(evidence);
    },
    { preconnect: fetch.preconnect },
  );
  return { call, calls, url };
}

async function collectRelatedHistoricalSource(
  original: Parameters<typeof relatedHistoricalFixture>[0],
  mixed?: Parameters<typeof relatedHistoricalFixture>[1],
) {
  const network = relatedHistoricalFixture(original, mixed);
  const journal = baseline([{ ...award(), sourceUrl: network.url }]);
  const result = await collectImplementationCorrections(
    {
      projects: ["asi"],
      directory: await directory(),
      ...(mixed ? { candidateMonth: "2026-01" } : { month: "2026-01" }),
      before: mixed ? "2026-02-20T00:00:00.000Z" : "2026-01-31T00:00:00.000Z",
    },
    {
      journal,
      registry: registry(),
      token: "fixture-token",
      transport: network.call,
      now: new Date(mixed ? "2026-02-21T00:00:00Z" : "2026-01-31T23:59:59Z"),
    },
  );
  return { journal, result, calls: network.calls };
}

test.each(["disjoint", "incomplete-disjoint", "renamed-overlap"] as const)(
  "October reference path completeness and renames remain conservative (%s)",
  async (scenario) => {
    const network = relatedHistoricalFixture(scenario);
    const inOctober = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const translated = init?.body
          ? {
              ...init,
              body: String(init.body).replaceAll("2026-10", "2026-01"),
            }
          : init;
        const response = await network.call(input, translated);
        return new Response(
          (await response.text())
            .replaceAll("2026-01", "2026-10")
            .replaceAll("2026-02", "2026-11"),
          { status: response.status, headers: response.headers },
        );
      },
      { preconnect: fetch.preconnect },
    );
    const journal = baseline([
      {
        ...award(),
        sourceUrl: network.url,
        occurredAt: "2026-10-15T00:00:00.000Z",
      },
    ]);
    const result = await collectImplementationCorrections(
      {
        projects: ["asi"],
        directory: await directory(),
        month: "2026-10",
        before: "2026-10-31T00:00:00.000Z",
        octoberOriginalCredit: true,
      },
      {
        journal,
        registry: registry(),
        token: "fixture-token",
        transport: inOctober,
        now: new Date("2026-10-31T23:59:59Z"),
      },
    );
    if (scenario !== "disjoint") {
      expect(result.receipt.completeProofs).toBe(0);
      expect(result.manifest.candidates[0].proof.status).toBe("held");
      return;
    }
    expect(result.receipt.completeProofs).toBe(1);
    expect(result.manifest.candidates[0].sourceIds).toEqual(["PR_source"]);
    expect(result.manifest.candidates[0].proof).toMatchObject({
      status: "complete",
      sources: [{ sourceId: "PR_source", commits: [{ author: null }] }],
    });
  },
);

test("an unrelated zero-commit reference does not poison the complete historical manifest", async () => {
  const { journal, result, calls } =
    await collectRelatedHistoricalSource("empty");
  expect(
    calls.has("/repos/elizaOS/asi/pulls/1/commits?per_page=100&page=1"),
  ).toBe(true);
  expect(result.receipt.completeProofs).toBe(1);
  const candidate = result.manifest.candidates[0];
  const reconciled = applyPointsImplementationCorrections(
    journal,
    result.manifest,
    [{ candidateId: candidate.id, eligible: false }],
    result.manifest.generatedAt,
    new Map(),
  );
  expect(reconciled.journal).toBe(journal);
  expect(candidate.sourceIds).toEqual(["PR_source"]);
  expect(candidate.proof).toMatchObject({
    status: "complete",
    sources: [{ sourceId: "PR_source", commits: [{ author: null }] }],
  });
});

test("a verified retained original stays in the historical manifest and an ambiguous copy stays held", async () => {
  const { result, journal } = await collectRelatedHistoricalSource("bound");
  expect(result.receipt.completeProofs).toBe(1);
  const candidate = result.manifest.candidates[0];
  expect(candidate.sourceIds).toEqual(["PR_original", "PR_source"]);
  expect(candidate.proof).toMatchObject({
    status: "complete",
    sources: [
      {
        sourceId: "PR_source",
        commits: [{ retainedCopy: { originalSourceId: "PR_original" } }],
      },
      { sourceId: "PR_original" },
    ],
  });
  expect(
    applyPointsImplementationCorrections(
      journal,
      result.manifest,
      [{ candidateId: candidate.id, eligible: false }],
      result.manifest.generatedAt,
      new Map(),
    ).journal,
  ).toBe(journal);
  const ambiguous = await collectRelatedHistoricalSource("ambiguous");
  expect(ambiguous.result.receipt.completeProofs).toBe(0);
  expect(ambiguous.result.manifest.candidates[0].proof).toMatchObject({
    status: "held",
  });
  expect(ambiguous.result.receipt.limitations).toContainEqual({
    id: candidate.id,
    reason: "Retained-copy evidence is incomplete or ambiguous",
  });
  const wrongHead = await collectRelatedHistoricalSource("wrong-head");
  expect(wrongHead.result.receipt.completeProofs).toBe(0);
  expect(wrongHead.result.receipt.limitations).toContainEqual({
    id: candidate.id,
    reason: "Retained original commit census does not reach the source head",
  });
});

test("historical retained bindings preserve a separately linked canonical author", async () => {
  const { result, journal } = await collectRelatedHistoricalSource(
    "bound",
    "linked",
  );
  expect(result.receipt.ownershipComplete).toBe(true);
  expect(result.receipt.completeProofs).toBe(1);
  const candidate = result.manifest.candidates[0];
  if (candidate.proof.status !== "complete")
    throw new Error("Expected complete proof");
  expect(candidate.proof.sources[0].commits).toMatchObject([
    {
      author: null,
      files: [{ path: "fix.ts" }],
      retainedCopy: { originalSourceId: "PR_original" },
    },
    {
      author: { id: "U_linked", kind: "User", login: "linked" },
      additions: 2,
      deletions: 0,
    },
  ]);
  expect(candidate.proof.sources[0].commits[1].files).toBeUndefined();
  const corrected = applyPointsImplementationCorrections(
    journal,
    result.manifest,
    [{ candidateId: candidate.id, eligible: true }],
    result.manifest.generatedAt,
    new Map(),
  );
  const points = [...latestPoints(corrected.journal).values()]
    .map(({ award }) => [award.actor.id, award.amount])
    .sort();
  expect(points).toEqual([
    [actor.id, 0],
    ["U_linked", 9],
    ["U_submitter", 4],
  ]);
});

test("conflicting author evidence holds a historical retained source", async () => {
  for (const mixed of ["binding-mismatch", "linked-mismatch"] as const) {
    const { result } = await collectRelatedHistoricalSource("bound", mixed);
    expect(result.receipt.ownershipComplete).toBe(true);
    expect(result.receipt.completeProofs).toBe(0);
    const candidate = result.manifest.candidates[0];
    expect(candidate.proof).toEqual({ status: "held" });
    expect(result.receipt.limitations).toContainEqual({
      id: candidate.id,
      reason:
        "Retained accepted commit author differs from the canonical census",
    });
  }
});

test("grouped attribution restores cached actor batch halves through the normal loader adapter", async () => {
  const original = makeOriginal();
  const accepted = structuredClone(original);
  const path = "elizaOS/asi";
  for (const source of [original, accepted]) {
    const evidence = source.evidence;
    evidence.repository = path;
    evidence.repositoryNodeId = "R_kgDOT23CXA";
    evidence.repositoryPolicy = {
      id: path,
      projectId: "asi",
      integrationBranch: "main",
      expectedNodeId: "R_kgDOT23CXA",
    };
    evidence.pull.html_url = `https://github.com/${path}/pull/1`;
    evidence.pull.base.ref = "main";
    evidence.commits[0].author = null;
    evidence.commitAttribution[0].actorNodeIds = [];
    evidence.commits[0].sha = sha;
    evidence.commitAttribution[0].sha = sha;
    evidence.pull.head.sha = sha;
  }
  original.evidence.pull.node_id = "PR_original";
  original.evidence.pull.number = 1;
  original.evidence.pull.html_url = `https://github.com/${path}/pull/1`;
  original.evidence.pull.merged_at = null;
  original.evidence.pull.merge_commit_sha = null;
  original.evidence.pull.merged_by = null;
  original.evidence.pull.closed_at = "2026-01-14T00:00:00Z";
  original.evidence.mergeCommitEvidence = null;
  accepted.evidence.pull.node_id = "PR_source";
  accepted.evidence.pull.number = 2;
  accepted.evidence.pull.html_url = `https://github.com/${path}/pull/2`;
  accepted.evidence.pull.user = {
    node_id: actor.id,
    login: actor.login,
    type: "User",
  };
  accepted.evidence.pull.merged_by = accepted.evidence.pull.user;
  accepted.evidence.pull.merged_at = "2026-01-15T00:00:00Z";
  original.evidence.relatedPullRequests = [
    {
      id: "PR_source",
      number: 2,
      url: accepted.evidence.pull.html_url,
      repository: path,
    },
  ];
  original.evidence.comments = [
    {
      node_id: "IC_retained",
      html_url: `${original.evidence.pull.html_url}#issuecomment-1`,
      body: "Your commits are retained in #2.",
      user: accepted.evidence.pull.user,
      created_at: "2026-01-15T01:00:00Z",
      updated_at: "2026-01-15T01:00:00Z",
    },
  ];
  const extra = structuredClone(original.evidence.commits[0]);
  extra.sha = "9".repeat(40);
  extra.parents = [{ sha }];
  original.evidence.commits.push(extra);
  original.evidence.pull.head.sha = extra.sha;
  original.evidence.pull.commits = 2;
  const file = {
    ...original.evidence.files[0],
    filename: "unaccepted-test.ts",
    patch: "@@ -0,0 +1 @@\n+unaccepted",
  };
  original.evidence.files.push(file);
  original.evidence.commitAttribution.push({
    sha: extra.sha,
    actorNodeIds: [],
    changedPaths: [file.filename],
    files: [file],
    limitations: [],
  });
  const evidence = await prepareWorkUnitEvidence(
    [original, accepted],
    [
      {
        ...valueRepository,
        id: path,
        projectId: "asi",
        expectedNodeId: "R_kgDOT23CXA",
      },
    ],
  );
  expect(evidence.limitations).toEqual([]);
  const digest = "d".repeat(64);
  const workUnitId = `wu_${"b".repeat(64)}`;
  const decision = {
    status: "assessed",
    latestDigest: digest,
    evidence,
    record: {
      units: [
        { workUnitId, claimIds: evidence.claims.map((claim) => claim.id) },
      ],
    },
  } as unknown as Awaited<
    ReturnType<typeof valueIngestion.loadValueInputs>
  >["jointValueDecisions"] extends Map<string, infer T>
    ? T
    : never;
  const received: string[][] = [];
  const loader = spyOn(valueIngestion, "loadValueInputs").mockImplementation(
    async (github) => {
      const actors = await github.graphql<{ nodes: { id: string }[] }>(
        "query FixtureValueActors($ids:[ID!]!){nodes(ids:$ids){id}}",
        { ids: ["U_actor_one", "U_actor_two"] },
      );
      expect(actors.nodes.map((actor) => actor.id)).toEqual([
        "U_actor_one",
        "U_actor_two",
      ]);
      return {
        jointValueDecisions: new Map([["PR_source", decision]]),
        heldWorkUnits: [],
      } as unknown as Awaited<
        ReturnType<typeof valueIngestion.loadValueInputs>
      >;
    },
  );
  const baseTransport = transport(sha, {
    ...fixture(),
    number: 2,
    url: accepted.evidence.pull.html_url,
  }).call;
  const actorTransport = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (!String(body.query).includes("FixtureValueActors"))
        return baseTransport(input, init);
      const ids = body.variables.ids as string[];
      received.push(ids);
      if (ids.length > 1)
        return new Response("gateway failure", { status: 502 });
      return Response.json({
        data: {
          nodes: ids.map((id) => ({ id })),
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
  try {
    const source = {
      ...award(30, true),
      sourceUrl: accepted.evidence.pull.html_url,
    };
    const journal = appendPointAwards(
      emptyPointsJournal("2026-01-31T00:00:00.000Z"),
      [source],
      "f".repeat(64),
      "slop-score-v2",
      "2026-01-31T00:00:00.000Z",
      new Map([
        [
          source.key,
          {
            sourceId: `value:${digest}`,
            effectiveAt: when,
            reason: "Retained assessed work unit",
          },
        ],
      ]),
    );
    const dir = await directory();
    const options = {
      projects: ["asi"],
      directory: dir,
      month: "2026-01",
      before: "2026-01-31T00:00:00.000Z",
    };
    const deps = {
      journal,
      registry: registry(),
      token: "fixture-token",
      transport: actorTransport,
      now: new Date("2026-01-31T23:59:59Z"),
    };
    const result = await collectImplementationCorrections(options, deps);
    expect(received.at(0)).toEqual(["U_actor_one", "U_actor_two"]);
    expect(received.slice(-2)).toEqual([["U_actor_one"], ["U_actor_two"]]);
    const liveCalls = received.length;
    const replay = await collectImplementationCorrections(options, {
      ...deps,
      transport: Object.assign(
        async () => {
          throw Error("No replay network reads");
        },
        { preconnect: fetch.preconnect },
      ),
    });
    expect(replay.receipt.manifestDigest).toBe(result.receipt.manifestDigest);
    expect(received).toHaveLength(liveCalls);
    expect(
      result.receipt.limitations.filter(
        (item) => item.reason !== "outside-reviewed-candidate-scope",
      ),
    ).toEqual([]);
    expect(result.receipt.completeProofs).toBe(1);
    expect(result.manifest.candidates[0].proof).toMatchObject({
      status: "complete",
      expectedClaimIds: evidence.claims.map((claim) => claim.id),
      sources: expect.arrayContaining([
        expect.objectContaining({ sourceId: "PR_original", commitCount: 2 }),
      ]),
    });
  } finally {
    loader.mockRestore();
  }
});

for (const linkedAuthor of ["original", "conflicting"] as const) {
  test(`October grouped work preserves verified original credit with ${linkedAuthor} author evidence`, async () => {
    const original = makeOriginal();
    const accepted = structuredClone(original);
    const repo = "elizaOS/asi";
    const originActor = { node_id: "U_origin", login: "origin", type: "User" };
    const carrier = { node_id: actor.id, login: actor.login, type: "User" };
    for (const source of [original, accepted]) {
      Object.assign(source.evidence, {
        repository: repo,
        repositoryNodeId: "R_kgDOT23CXA",
        repositoryPolicy: {
          id: repo,
          projectId: "asi",
          integrationBranch: "main",
          expectedNodeId: "R_kgDOT23CXA",
        },
      });
      source.evidence.pull.user = carrier;
      source.evidence.pull.base.ref = "main";
      source.evidence.commits[0].sha = sha;
      source.evidence.commits[0].author = originActor;
      source.evidence.commitAttribution[0].sha = sha;
      source.evidence.commitAttribution[0].actorNodeIds = [originActor.node_id];
      source.evidence.pull.head.sha = sha;
    }
    original.evidence.pull.node_id = "PR_original";
    original.evidence.pull.number = 1;
    original.evidence.pull.html_url = `https://github.com/${repo}/pull/1`;
    original.evidence.pull.merged_at = null;
    original.evidence.pull.closed_at = "2026-10-14T00:00:00Z";
    original.evidence.pull.merge_commit_sha = null;
    original.evidence.pull.merged_by = null;
    original.evidence.mergeCommitEvidence = null;
    accepted.evidence.pull.node_id = "PR_source";
    accepted.evidence.pull.number = 2;
    accepted.evidence.pull.html_url = `https://github.com/${repo}/pull/2`;
    accepted.evidence.pull.merged_at = "2026-10-15T00:00:00Z";
    accepted.evidence.pull.merged_by = carrier;
    if (linkedAuthor === "conflicting") {
      accepted.evidence.commits[0].author = {
        node_id: "U_other",
        login: "other",
        type: "User",
      };
      accepted.evidence.commitAttribution[0].actorNodeIds = ["U_other"];
    }
    const evidence = await prepareWorkUnitEvidence(
      [original, accepted],
      [
        {
          ...valueRepository,
          id: repo,
          projectId: "asi",
          expectedNodeId: "R_kgDOT23CXA",
        },
      ],
    );
    expect(evidence.limitations).toEqual([]);
    for (const claim of evidence.claims) {
      claim.creditPullRequestId = original.evidence.pull.node_id;
      claim.retainedCopy = {
        acceptancePullRequestId: accepted.evidence.pull.node_id,
        acceptedCommitSha: claim.commitSha,
        preexistingCommitShas: [],
      };
    }

    const digest = "d".repeat(64);
    const workUnitId = `wu_${"b".repeat(64)}`;
    const decision = {
      status: "assessed",
      latestDigest: digest,
      evidence,
      record: {
        units: [{ workUnitId, claimIds: evidence.claims.map((c) => c.id) }],
      },
    };
    const loader = spyOn(valueIngestion, "loadValueInputs").mockResolvedValue({
      jointValueDecisions: new Map([["PR_source", decision]]),
      heldWorkUnits: [],
    } as never);
    const node = fixture(sha);
    node.commits.nodes[0].commit.oid = sha;
    Object.assign(node, {
      number: 2,
      url: accepted.evidence.pull.html_url,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-15T00:00:00Z",
      mergedAt: "2026-10-15T00:00:00Z",
    });
    node.commits.nodes[0].commit.author.user = {
      ...node.author,
      id: linkedAuthor === "original" ? originActor.node_id : "U_other",
      login: linkedAuthor === "original" ? originActor.login : "other",
    };
    const source = {
      ...award(30, true),
      sourceUrl: node.url,
      occurredAt: "2026-10-15T00:00:00.000Z",
    };
    const journal = appendPointAwards(
      emptyPointsJournal("2026-10-31T00:00:00.000Z"),
      [source],
      "f".repeat(64),
      "slop-score-v2",
      "2026-10-31T00:00:00.000Z",
      new Map([
        [
          source.key,
          {
            sourceId: `value:${digest}`,
            effectiveAt: source.occurredAt,
            reason: "Retained assessed work unit",
          },
        ],
      ]),
    );
    try {
      const result = await collectImplementationCorrections(
        {
          projects: ["asi"],
          directory: await directory(),
          candidateMonth: "2026-10",
          before: "2026-11-01T00:00:00.000Z",
          octoberOriginalCredit: true,
        },
        {
          journal,
          registry: registry(),
          token: "fixture-token",
          transport: Object.assign(
            async (input: RequestInfo | URL, init?: RequestInit) => {
              const request = JSON.parse(String(init?.body));

              if (
                request.query.includes("LeaderboardSearchReferences") &&
                !request.variables.searchQuery.includes("merged:2026-10")
              )
                return Response.json({
                  data: {
                    search: {
                      issueCount: 0,
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [],
                    },
                    rateLimit: {
                      cost: 1,
                      limit: 5000,
                      remaining: 4900,
                      resetAt: "2026-11-02T01:00:00Z",
                    },
                  },
                });
              return transport(sha, node).call(input, init);
            },
            { preconnect: fetch.preconnect },
          ),
          now: new Date("2026-11-02T00:00:00Z"),
        },
      );
      const proof = result.manifest.candidates[0].proof;
      if (linkedAuthor === "conflicting") {
        expect(proof.status).toBe("held");
        return;
      }
      expect(result.receipt.completeProofs).toBe(1);
      expect(proof.status).toBe("complete");
      if (proof.status !== "complete") throw Error("Missing proof");
      expect(proof.originalContributor).toBeUndefined();
      const applied = applyPointsImplementationCorrections(
        journal,
        result.manifest,
        [{ candidateId: result.manifest.candidates[0].id, eligible: true }],
        result.manifest.generatedAt,
        new Map(),
      );
      expect(
        [...latestPoints(applied.journal).values()].find(
          (row) => row.award.actor.id === originActor.node_id,
        )?.award.amount,
      ).toBe(30);
    } finally {
      loader.mockRestore();
    }
  });
}

const head = "1".repeat(40),
  later = "4".repeat(40),
  merged = "5".repeat(40);
const hash = (kind: string, bytes: Buffer) =>
  createHash("sha1")
    .update(`${kind} ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
function nativeContextFixture() {
  const source = makeOriginal();
  source.evidence.pull.merge_commit_sha = merged;
  source.evidence.pull.head.sha = head;
  const one = commit(head),
    two = commit(later);
  two.parents = [{ sha: head }];
  two.commit.message = "Follow up the accepted fix";
  const added: FileChange = {
    filename: "fix.ts",
    status: "added",
    additions: 1,
    deletions: 0,
    patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
    blob_url: null,
  };
  const changed: FileChange = {
    ...added,
    status: "modified",
    additions: 1,
    deletions: 1,
    patch:
      "@@ -1 +1 @@\n-export const fixed = true;\n+export const fixed = true; // reviewed",
  };
  source.evidence.files = [added];
  source.evidence.commits = [one];
  source.evidence.commitAttribution = [
    {
      sha: head,
      actorNodeIds: [nativeActor.node_id],
      changedPaths: ["fix.ts"],
      files: [added],
      limitations: [],
    },
  ];
  source.evidence.mergeCommitEvidence = {
    sha: merged,
    html_url: `https://github.com/${repository.id}/commit/${merged}`,
    parents: [{ sha: base }, { sha: later }],
    stats: { additions: 1, deletions: 0, total: 1 },
    files: [
      {
        ...added,
        patch: "@@ -0,0 +1 @@\n+export const fixed = true; // reviewed",
      },
    ],
  };
  const carrier = structuredClone(source);
  carrier.evidence.pull.node_id = "PR_carrier";
  carrier.evidence.pull.number = 2;
  carrier.evidence.pull.html_url = `https://github.com/${repository.id}/pull/2`;
  carrier.evidence.pull.head.sha = later;
  carrier.evidence.pull.commits = 2;
  carrier.evidence.files = structuredClone(
    source.evidence.mergeCommitEvidence.files,
  );
  carrier.evidence.commits = structuredClone([one, two]);
  carrier.evidence.commitAttribution.push({
    sha: later,
    actorNodeIds: [nativeActor.node_id],
    changedPaths: ["fix.ts"],
    files: [changed],
    limitations: [],
  });
  const values = new Map<string, unknown>();
  function bind(ref: string, text: string) {
    const blob = hash("blob", Buffer.from(text));
    const bytes = Buffer.concat([
      Buffer.from("100644 fix.ts\0"),
      Buffer.from(blob, "hex"),
    ]);
    const tree = hash("tree", bytes);
    values.set(`/repos/${repository.id}/git/commits/${ref}`, {
      sha: ref,
      tree: { sha: tree },
    });
    values.set(`/repos/${repository.id}/git/trees/${tree}?recursive=1`, {
      sha: tree,
      truncated: false,
      tree: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blob }],
    });
    values.set(`/repos/${repository.id}/contents/fix.ts?ref=${ref}`, {
      type: "file",
      encoding: "base64",
      size: Buffer.byteLength(text),
      sha: blob,
      content: Buffer.from(text).toString("base64"),
    });
  }
  bind(head, "export const fixed = true;\n");
  bind(merged, "export const fixed = true; // reviewed\n");
  values.set(
    `/repos/${repository.id}/compare/${head}...${later}?per_page=100&page=1`,
    {
      status: "ahead",
      merge_base_commit: { sha: head },
      total_commits: 1,
      commits: [two],
    },
  );
  values.set(`/repos/${repository.id}/compare/${head}...${merged}?per_page=1`, {
    status: "ahead",
    merge_base_commit: { sha: head },
    files: [changed],
  });
  const client = {
    async get<T>(path: string): Promise<T | null> {
      return structuredClone(values.get(path) ?? null) as T | null;
    },
  };
  return { source, carrier, client, values, one, two };
}
async function preparedNativeContext() {
  const f = nativeContextFixture();
  const proof = await collectNativeMergeAcceptance(
    f.client,
    repository.id,
    f.source.evidence,
  );
  if (!proof) throw Error("Missing proof");
  f.source.evidence.nativeMergeAcceptance = proof;
  f.source.evidence.limitations = [NATIVE_MERGE_CONTEXT];
  return { ...f, proof };
}

test("grouped conversion retains a fully verified native ancestor context", async () => {
  const { source, carrier } = await preparedNativeContext();
  const group = await prepareWorkUnitEvidence([source, carrier], [repository]);
  expect(group.limitations).toEqual([]);
  const owners = new Map(
    carrier.evidence.commits.map((c) => [
      `${repository.id.toLowerCase()}\0${c.sha}`,
      carrier.evidence.pull.node_id,
    ]),
  );
  expect(
    (await bindRetained(group.sources, owners, true)).map((s) => s.complete),
  ).toEqual([true, true]);
  expect(source.evidence.limitations).toEqual([NATIVE_MERGE_CONTEXT]);
  expect(bindRetained(group.sources, owners)).rejects.toThrow(
    "Full retained source",
  );
});
for (const fault of [
  "missing-carrier",
  "forged-head",
  "other-limitation",
] as const) {
  test(`grouped native context refuses ${fault}`, async () => {
    const { source, carrier } = await preparedNativeContext();
    if (fault === "forged-head")
      carrier.evidence.pull.head.sha = "9".repeat(40);
    if (fault === "other-limitation")
      source.evidence.limitations.push("Uninspected source");
    expect(
      bindRetained(
        fault === "missing-carrier" ? [source] : [source, carrier],
        new Map(),
        true,
      ),
    ).rejects.toThrow();
  });
}
