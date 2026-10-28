/** #1466: real collection, scoring, atomic output and Points replay over HTTP. */
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  appendPointAwards,
  applyPointsSnapshot,
  awardForScore,
  latestPoints,
  type PointsJournal,
} from "../src/lib/points";
import { findProject } from "../src/lib/projects.mjs";
import {
  REGISTERED_REPOSITORIES,
  TARGET_REPOSITORIES,
} from "../src/lib/repositories.mjs";
import {
  GENERATED_AT,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import {
  GitHubGraphqlClient,
  generateLeaderboardFromGitHub,
  MAX_GRAPHQL_REQUEST_ATTEMPTS,
  runGenerator,
  writeLeaderboardAtomically,
} from "./generate-leaderboard";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  setSystemTime();
});
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const connection = (nodes: unknown[]) => ({
  totalCount: nodes.length,
  nodes,
  pageInfo: { hasNextPage: false, endCursor: null as string | null },
});
function required<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error("Missing source-recovery fixture");
  return value;
}
const project = required(findProject("asi"));
const repository = required(
  TARGET_REPOSITORIES.find((row) => row.projectId === "asi"),
);
const template = penaltyScoreInput([]).mergedPullRequests;
const retained = required(template.find((pull) => pull.id === "PR_november"));
const unaffected = required(template.find((pull) => pull.id === "PR_owner"));
const removed = {
  ...retained,
  id: "PR_removed",
  number: 77,
  headRefOid: "f".repeat(40),
  url: `${repository.githubUrl}/pull/77`,
};
const pulls = [retained, unaffected, removed];
const nodeFor = (pull: (typeof pulls)[number]) => ({
  ...pull,
  __typename: "PullRequest",
  state: "MERGED",
  baseRefName: "main",
  baseRefOid: "a".repeat(40),
  author: { ...pull.author, __typename: "User" },
  reviewRequests: { totalCount: 0 },
  comments: connection([]),
  reviews: connection([]),
  files: connection(pull.files ?? []),
  assignees: connection([]),
  labels: connection([]),
  closingIssuesReferences: connection([]),
  commits: connection([
    {
      commit: {
        oid: pull.headRefOid,
        author: { user: { ...pull.author, __typename: "User" } },
      },
    },
  ]),
});
// Open work listed before detail hydration. One PR and one issue close
// between the open listing and their detail reads.
const openPull = (id: string, number: number) => ({
  ...unaffected,
  id,
  number,
  headRefOid: String(number % 10).repeat(40),
  url: `${repository.githubUrl}/pull/${number}`,
  mergedAt: null,
  closedAt: null,
});
const stillOpenPull = openPull("PR_still_open", 81);
const mergedAfterListing = openPull("PR_merged_after_listing", 82);
const openIssueNode = (id: string, number: number, open: boolean) => ({
  __typename: "Issue",
  id,
  state: open ? "OPEN" : "CLOSED",
  number,
  title: "Open work item",
  url: `${repository.githubUrl}/issues/${number}`,
  body: "Describe the defect.",
  createdAt: unaffected.createdAt,
  updatedAt: unaffected.updatedAt,
  closedAt: open ? null : GENERATED_AT,
  stateReason: open ? null : "COMPLETED",
  author: { ...unaffected.author, __typename: "User" },
  labels: connection([]),
  assignees: connection([]),
  comments: connection([]),
  timelineItems: connection([]),
  closedByPullRequestsReferences: connection([]),
});
const record = {
  schemaVersion: "slop-work-unit-record:v1",
  projectId: project.id,
  sourceDigest: "d".repeat(64),
  producerRevision: "a".repeat(40),
  assessedAt: retained.updatedAt,
  sources: [retained, removed].map((pull) => ({
    repository: repository.id,
    repositoryNodeId: project.authority.repositoryNodeId,
    repositoryDatabaseId: 123,
    pullRequestNodeId: pull.id,
    pullRequestNumber: pull.number,
    headSha: pull.headRefOid,
    mergeSha: null,
    policySha: "a".repeat(40),
    sourceDigest: "b".repeat(64),
    occurredAt: pull.mergedAt,
  })),
  claims: [],
  units: [],
  supersedes: [],
  legacyPredecessors: [],
  revisionReason: null,
};
const recordJson = JSON.stringify(record);
const recordDigest = sha256(recordJson);
/** A registered project that only the staging registry lists. */
const STAGING_ONLY = "canonry";
type Failure =
  | "forbidden"
  | "mixed"
  | "partial"
  | "transport"
  | "unmatched-null";
type Comparison =
  | "complete"
  | "missing"
  | "duplicate"
  | "wrong-base"
  | "changed-count"
  | "unavailable"
  | "invalid-range";

async function fixture(
  mode: "removed" | "persistent" | "joint" | "healthy" | "open-closure",
  failure?: Failure,
  productionProjects?: readonly string[],
  comparison?: Comparison,
) {
  let missingSeen = false;
  let requests = 0;
  let attempts = 0;
  let repositoryReads = 0;
  let forbiddenSourceReads = 0;
  const comparisonPages: number[] = [];
  const range = Array.from({ length: 251 }, (_, index) => ({
    commit: {
      oid:
        index === 250
          ? retained.headRefOid
          : (index + 1).toString(16).padStart(40, "0"),
      author: { user: { ...retained.author, __typename: "User" } },
    },
  }));
  const sourceNodeFor = (pull: (typeof pulls)[number]) => {
    const node = nodeFor(pull);
    if (comparison && pull.id === retained.id)
      node.commits = {
        totalCount: range.length,
        // Large PR connections can expose a later window than comparison
        // page one. The complete comparison must retain both sets of commits.
        nodes: range.slice(-100),
        pageInfo: { hasNextPage: true, endCursor: "known-late-window" },
      };
    return node;
  };
  const nodeId = (owner: string, name: string) => {
    const row = required(
      TARGET_REPOSITORIES.find(
        (item) => item.owner === owner && item.name === name,
      ),
    );
    return row.expectedNodeId ?? `R_${row.name}`;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/graphql") {
        const { query, variables: v } = (await request.json()) as {
          query: string;
          variables: {
            owner: string;
            name: string;
            searchQuery: string;
            ids: string[];
          };
        };
        requests++;
        const data: Record<string, unknown> = {};
        let errors: unknown[] | undefined;
        if (query.includes("query LeaderboardPreflight")) {
          if (
            v.owner === TARGET_REPOSITORIES[0].owner &&
            v.name === TARGET_REPOSITORIES[0].name
          )
            attempts++;
          data.repository = {
            id: nodeId(v.owner, v.name),
            isPrivate: false,
            updatedAt: retained.updatedAt,
          };
        } else if (query.includes("query LeaderboardSearchReferences")) {
          const isOurs = v.searchQuery.startsWith(
            `repo:${repository.owner}/${repository.name} `,
          );
          const merged = isOurs && v.searchQuery.includes("is:merged");
          const current =
            mode === "persistent" || (mode === "removed" && !missingSeen)
              ? pulls
              : [retained, unaffected];
          const nodes = merged ? current.map(sourceNodeFor) : [];
          data.search = {
            issueCount: nodes.length,
            nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          };
        } else if (query.includes("query LeaderboardOpen")) {
          const field = query.includes("query LeaderboardOpenIssue")
            ? "issues"
            : "pullRequests";
          const listed =
            mode === "open-closure" &&
            v.owner === repository.owner &&
            v.name === repository.name;
          data.repository = {
            id: nodeId(v.owner, v.name),
            [field]: connection(
              !listed
                ? []
                : field === "issues"
                  ? ["I_still_open", "I_closed_after_listing"].map((id) => ({
                      id,
                      updatedAt: unaffected.updatedAt,
                    }))
                  : [stillOpenPull, mergedAfterListing].map((pull) => ({
                      id: pull.id,
                      updatedAt: pull.updatedAt,
                      headRefOid: pull.headRefOid,
                    })),
            ),
          };
        } else if (query.includes("query LeaderboardIssueDetails")) {
          data.nodes = v.ids.map((id: string, index: number) =>
            openIssueNode(id, 90 + index, id === "I_still_open"),
          );
        } else if (
          query.includes("query LeaderboardReviewedPullRequestReferences")
        ) {
          data.nodes = v.ids.map((id: string) => ({
            __typename: "PullRequest",
            id,
            updatedAt: required(pulls.find((p) => p.id === id)).updatedAt,
            reviews: { totalCount: 0 },
          }));
          const index =
            mode === "persistent" || (mode === "removed" && !missingSeen)
              ? v.ids.indexOf(removed.id)
              : -1;
          if (index >= 0 || (failure && mode !== "joint")) {
            const position = Math.max(index, 0);
            (data.nodes as unknown[])[position] = null;
            errors = [
              {
                type: "NOT_FOUND",
                path: ["nodes", position],
                message: "Could not resolve requested node",
              },
            ];
            if (failure === "forbidden")
              errors = [{ type: "FORBIDDEN", path: ["nodes", position] }];
            if (failure === "mixed")
              errors.push({ type: "INTERNAL", path: ["nodes", position] });
            if (failure === "partial") data.nodes = [];
            if (failure === "unmatched-null")
              (data.nodes as unknown[])[(position + 1) % v.ids.length] = null;
            missingSeen = true;
          }
        } else if (query.includes("query LeaderboardSourceAvailability")) {
          data.nodes = v.ids.map((id: string) =>
            id === removed.id ? null : { __typename: "PullRequest", id },
          );
          errors = v.ids.flatMap((id: string, index: number) =>
            id === removed.id
              ? [
                  {
                    type: "NOT_FOUND",
                    path: ["nodes", index],
                    message: "Could not resolve requested node",
                  },
                ]
              : [],
          );
          if (failure === "forbidden")
            errors = [{ type: "FORBIDDEN", path: ["nodes", 0] }];
          if (failure === "mixed")
            errors.push({ type: "INTERNAL", path: ["nodes", 0] });
          if (failure === "partial") data.nodes = [];
        } else if (
          query.includes("query LeaderboardPullRequestDetails") ||
          query.includes("query LeaderboardMergedPullRequestReviews")
        ) {
          data.nodes = v.ids.map((id: string) =>
            id === stillOpenPull.id
              ? { ...nodeFor(stillOpenPull), state: "OPEN" }
              : id === mergedAfterListing.id
                ? {
                    ...nodeFor(mergedAfterListing),
                    mergedAt: GENERATED_AT,
                    closedAt: GENERATED_AT,
                  }
                : sourceNodeFor(required(pulls.find((p) => p.id === id))),
          );
        } else
          throw new Error(
            `Unexpected GraphQL operation ${query.slice(0, 100)}`,
          );
        data.rateLimit = {
          cost: 1,
          limit: 5000,
          remaining: 5000 - requests,
          resetAt: "2026-11-20T01:00:00.000Z",
        };
        return Response.json({ data, ...(errors ? { errors } : {}) });
      }
      if (comparison && url.pathname.includes("/compare/")) {
        const page = Number(url.searchParams.get("page"));
        comparisonPages.push(page);
        if (
          comparison === "invalid-range" ||
          comparison === "unavailable" ||
          (page === 1 && comparisonPages.length === 1)
        )
          return Response.json(
            {
              message:
                comparison === "invalid-range"
                  ? "Validation Failed"
                  : "Server Error: Sorry, this diff is taking too long to generate.",
            },
            { status: 422 },
          );
        let slice = range.slice((page - 1) * 100, page * 100);
        if (comparison === "missing" && page === 3) slice = slice.slice(1);
        if (comparison === "duplicate" && page === 3)
          slice = [range[0], ...slice.slice(1)];
        return Response.json({
          total_commits: comparison === "changed-count" ? 252 : 251,
          base_commit: {
            sha: comparison === "wrong-base" ? "b".repeat(40) : "a".repeat(40),
          },
          commits: slice.map(({ commit }) => ({
            sha: commit.oid,
            author: {
              node_id: commit.author.user.id,
              type: "User",
              login: commit.author.user.login,
              avatar_url: commit.author.user.avatarUrl,
              html_url: commit.author.user.url,
            },
          })),
        });
      }
      if (url.pathname === "/api/v1/project-account-bans")
        return Response.json({
          schemaVersion: "slop-account-bans:v1",
          bans: [],
        });
      if (productionProjects && url.pathname === "/api/v1/projects")
        return Response.json({
          schemaVersion: "1",
          projects: productionProjects.map((id) => ({ id })),
          restrictions: [],
        });
      if (productionProjects && url.pathname === "/api/v1/project-revisions")
        return Response.json({ schemaVersion: "1", revisions: [] });
      if (url.pathname === "/v1/penalties") {
        // The production feed rejects a project it does not know.
        if (
          productionProjects &&
          url.searchParams.get("project") === STAGING_ONLY
        )
          return Response.json(
            { error: "Invalid penalty query" },
            { status: 400 },
          );
        return Response.json({
          schemaVersion: "slop-penalty-history:v1",
          project: url.searchParams.get("project"),
          records: [],
          nextAfter: null,
        });
      }
      if (url.pathname === `/repos/${repository.owner}/${repository.name}`) {
        repositoryReads++;
        return Response.json({
          id: 123,
          node_id: project.authority.repositoryNodeId,
          private: false,
        });
      }
      if (url.pathname === "/v1/work-unit-assessments") {
        const joint =
          mode === "joint" &&
          Number(url.searchParams.get("pull")) === retained.number;
        return Response.json({
          schemaVersion: "slop-work-unit-history:v1",
          repository: repository.id,
          repositoryNodeId: project.authority.repositoryNodeId,
          pullRequestNumber: Number(url.searchParams.get("pull")),
          throughSequence: joint ? 1 : 0,
          totalRecords: joint ? 1 : 0,
          nextAfter: null,
          records: joint
            ? [
                {
                  sequence: 1,
                  record_digest: recordDigest,
                  record_json: recordJson,
                  recorded_at: retained.updatedAt,
                },
              ]
            : [],
        });
      }
      if (url.pathname === "/v1/value-assessments")
        return Response.json({
          schemaVersion: "slop-value-history:v1",
          repository: repository.id,
          repositoryNodeId: project.authority.repositoryNodeId,
          pullRequestNumber: Number(url.searchParams.get("pull")),
          records: [],
          nextAfter: null,
        });
      forbiddenSourceReads++;
      throw new Error(`Unexpected source request ${url.pathname}`);
    },
  });
  const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (
      failure === "transport" &&
      url.pathname === "/graphql" &&
      String(init?.body).includes("LeaderboardReviewedPullRequestReferences")
    )
      throw new TypeError("fixture connection reset");
    return originalFetch(new URL(url.pathname + url.search, server.url), init);
  }) as typeof fetch;
  globalThis.fetch = transport;
  const client = new GitHubGraphqlClient("fixture-token", transport, {
    retryBaseDelayMs: 0,
  });
  const directory = await mkdtemp(join(tmpdir(), "slop-source-recovery-"));
  const output = join(directory, "leaderboard.json");
  await writeFile(output, "last published bytes\n");
  return {
    client,
    output,
    stats: () => ({
      requests,
      attempts,
      repositoryReads,
      forbiddenSourceReads,
      comparisonPages,
    }),
    generate: () =>
      runGenerator(
        output,
        {
          getToken: async () => "fixture-token",
          createClient: () => client,
          generate: generateLeaderboardFromGitHub,
          write: writeLeaderboardAtomically,
        },
        {
          now: new Date(GENERATED_AT),
          actualNow: new Date(GENERATED_AT),
          ...(productionProjects ? { deploymentTier: "staging" as const } : {}),
        },
      ),
    close: async () => {
      server.stop(true);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function journalFor(
  snapshot: LeaderboardSnapshot,
  joint = false,
  source = retained,
): PointsJournal {
  const journal: PointsJournal = {
    schemaVersion: "1",
    ruleVersion: "slop-points-v1",
    generatedAt: GENERATED_AT,
    coverage: [],
    revisions: [],
  };
  const event = required(
    snapshot.ledger.find(
      (event) =>
        event.source.id === retained.id &&
        event.category === "merged-pull-request",
    ),
  );
  const bound = {
    ...event,
    id: `${source.id}:merged`,
    source: {
      ...event.source,
      id: source.id,
      number: source.number,
      url: source.url,
    },
    workUnitId: `wu_asi_pr_${source.number}`,
  };
  return appendPointAwards(
    journal,
    [
      awardForScore(
        joint
          ? {
              ...bound,
              id: `${source.id}:joint:fixture`,
              workUnitId: `wu_${"c".repeat(64)}`,
              scoreDecisionSourceId: `value:${recordDigest}`,
            }
          : bound,
      ),
    ],
    "a".repeat(64),
    snapshot.ruleVersion,
    GENERATED_AT,
  );
}

test("removed node is recorded after a complete recollection and both valid outcomes reach atomic output", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("removed");
  try {
    const snapshot = await f.generate();
    const published = JSON.parse(await readFile(f.output, "utf8"));
    assertLeaderboardSnapshot(published);
    expect(published.source.unavailableSources).toEqual([
      { nodeId: removed.id, reason: "NOT_FOUND" },
    ]);
    expect(published.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      heldWorkUnits: 0,
    });
    expect(
      snapshot.ledger
        .filter((event) => event.category === "merged-pull-request")
        .map((event) => event.source.id)
        .sort(),
    ).toEqual([retained.id, unaffected.id].sort());
    expect(f.stats().attempts).toBe(2);
    expect(snapshot.source.rateLimit.consumedDuringRun).toBe(
      f.stats().requests,
    );
    expect(f.stats().forbiddenSourceReads).toBe(0);
    const previous = journalFor(snapshot, false, removed);
    const updated = applyPointsSnapshot(
      previous,
      snapshot,
      "b".repeat(64),
      GENERATED_AT,
    );
    expect(updated.revisions.slice(0, previous.revisions.length)).toEqual(
      previous.revisions,
    );
    expect(
      latestPoints(updated).get(previous.revisions[0].award.key)?.award,
    ).toEqual(previous.revisions[0].award);
    const corrupt = structuredClone(published);
    corrupt.source.counts.unavailableSources = 0;
    expect(() => assertLeaderboardSnapshot(corrupt)).toThrow(
      "Unavailable source count",
    );
  } finally {
    await f.close();
  }
});

test("unavailable joint context keeps the verified merge minimum without replacing prior Points", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const healthy = await fixture("healthy");
  let before: LeaderboardSnapshot;
  try {
    before = await healthy.generate();
  } finally {
    await healthy.close();
  }
  const journal = journalFor(before, true);
  const f = await fixture("joint");
  try {
    const snapshot = await f.generate();
    expect(snapshot.source.unavailableSources).toEqual([
      { nodeId: removed.id, reason: "NOT_FOUND" },
    ]);
    expect(snapshot.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      heldWorkUnits: 1,
    });
    expect(snapshot.source.heldWorkUnits).toEqual([
      {
        recordDigest,
        sourceNodeIds: [retained.id, removed.id].sort(),
        unavailableNodeIds: [removed.id],
      },
    ]);
    expect(
      snapshot.valueAssessmentCoverage?.find(
        (row) => row.pullRequestId === retained.id,
      ),
    ).toMatchObject({ status: "unresolved", recordDigest });
    const minimum = required(
      snapshot.ledger.find(
        (event) =>
          event.source.id === retained.id &&
          event.category === "merged-pull-request",
      ),
    );
    expect(minimum.scoreThirds).toBe(1);
    expect(minimum.scoreDecisionSourceId).toBeUndefined();
    expect(
      snapshot.ledger.some((event) => event.source.id === removed.id),
    ).toBe(false);
    expect(
      snapshot.ledger.some((event) => event.source.id === unaffected.id),
    ).toBe(true);
    const after = applyPointsSnapshot(
      journal,
      snapshot,
      "b".repeat(64),
      GENERATED_AT,
    );
    expect(after.revisions.slice(0, journal.revisions.length)).toEqual(
      journal.revisions,
    );
    const original = journal.revisions[0].award;
    expect(latestPoints(after).get(original.key)?.award).toEqual(original);
    expect(
      [...latestPoints(after).values()].filter(
        (row) => row.award.sourceId === retained.id && row.award.amount > 0,
      ),
    ).toHaveLength(1);

    const fresh = applyPointsSnapshot(
      { ...journal, revisions: [] },
      snapshot,
      "c".repeat(64),
      GENERATED_AT,
    );
    expect(
      [...latestPoints(fresh).values()].find(
        (row) => row.award.sourceId === retained.id,
      )?.award.amount,
    ).toBe(10);
    const repeated = applyPointsSnapshot(
      fresh,
      snapshot,
      "d".repeat(64),
      GENERATED_AT,
    );
    expect(repeated.revisions).toEqual(fresh.revisions);

    // A later complete joint decision uses a different award key. Exercise
    // the canonical projector's replacement and replay, not model quality.
    const jointEvent = {
      ...required(
        before.ledger.find(
          (event) =>
            event.source.id === retained.id &&
            event.category === "merged-pull-request",
        ),
      ),
      id: `${retained.id}:joint:restored`,
      workUnitId: `wu_${"c".repeat(64)}`,
      scoreThirds: 3,
      points: 1,
      scoreDecisionSourceId: `value:${recordDigest}`,
      scoreDecisionAt: GENERATED_AT,
    };
    const restored = {
      ...before,
      ledger: [
        ...before.ledger.filter((event) => event.source.id !== retained.id),
        jointEvent,
      ],
      valueAssessmentCoverage: before.valueAssessmentCoverage?.map((row) =>
        row.pullRequestId === retained.id
          ? { ...row, status: "assessed" as const, recordDigest }
          : row,
      ),
    };
    const completed = applyPointsSnapshot(
      fresh,
      restored,
      "e".repeat(64),
      GENERATED_AT,
    );
    expect(
      [...latestPoints(completed).values()]
        .filter((row) => row.award.sourceId === retained.id)
        .map((row) => row.award.amount)
        .sort((a, b) => a - b),
    ).toEqual([0, 30]);
    expect(
      applyPointsSnapshot(completed, restored, "f".repeat(64), GENERATED_AT)
        .revisions,
    ).toEqual(completed.revisions);
    expect(
      applyPointsSnapshot(completed, snapshot, "f".repeat(64), GENERATED_AT)
        .revisions,
    ).toEqual(completed.revisions);

    const own = journalFor(before);
    const prior = appendPointAwards(
      own,
      [{ ...own.revisions[0].award, amount: 90 }],
      "e".repeat(64),
      before.ruleVersion,
      GENERATED_AT,
    );
    const preserved = applyPointsSnapshot(
      prior,
      snapshot,
      "f".repeat(64),
      GENERATED_AT,
    );
    expect(
      latestPoints(preserved).get(own.revisions[0].award.key)?.award.amount,
    ).toBe(90);
    // A prior per-PR assessment can credit an implementation actor who is
    // different from the actor selected by the unassessed merge minimum.
    // Unavailability cannot add that fallback award or overturn a prior zero.
    for (const amount of [90, 0]) {
      const previousActorAward = {
        ...awardForScore({
          ...minimum,
          actor: required(unaffected.author),
          scoreThirds: 9,
          scoreDecisionSourceId: `value:${recordDigest}`,
        }),
        amount,
      };
      const previousActorJournal = appendPointAwards(
        { ...journal, revisions: [] },
        [previousActorAward],
        "a".repeat(64),
        before.ruleVersion,
        GENERATED_AT,
      );
      const actorChanged = applyPointsSnapshot(
        previousActorJournal,
        snapshot,
        "b".repeat(64),
        GENERATED_AT,
      );
      expect(
        [...latestPoints(actorChanged).values()]
          .filter((row) => row.award.sourceId === retained.id)
          .map((row) => row.award),
      ).toEqual([previousActorAward]);
    }
    expect(f.stats().attempts).toBe(2);
    expect(f.stats().forbiddenSourceReads).toBe(0);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

for (const failure of [
  "forbidden",
  "mixed",
  "partial",
  "transport",
  "unmatched-null",
] as const) {
  test(`${failure} still fails closed and preserves the previous published bytes`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("removed", failure);
    try {
      await expect(f.generate()).rejects.toThrow();
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
      expect(f.stats().attempts).toBe(1);
    } finally {
      await f.close();
    }
  });
}

for (const failure of ["forbidden", "mixed", "partial", "transport"] as const) {
  test(`joint ${failure} never becomes a successful hold`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("joint", failure);
    try {
      await expect(f.generate()).rejects.toThrow();
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
      expect(f.stats().attempts).toBe(1);
    } finally {
      await f.close();
    }
  });
}

// A staging build syncs its registry from staging but reads the production
// penalty feed, which answers HTTP 400 for a project only staging lists.
test("staging skips only the penalty feed of a project production does not list", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const registered = [
    ...new Set(REGISTERED_REPOSITORIES.map((row) => row.projectId)),
  ];
  const staging = await fixture(
    "healthy",
    undefined,
    registered.filter((id) => id !== STAGING_ONLY),
  );
  try {
    await staging.generate();
    assertLeaderboardSnapshot(
      JSON.parse(await readFile(staging.output, "utf8")),
    );
  } finally {
    await staging.close();
  }
  const listed = await fixture("healthy", undefined, registered);
  try {
    await expect(listed.generate()).rejects.toThrow(
      "Authoritative penalty feed is unavailable",
    );
    expect(await readFile(listed.output, "utf8")).toBe(
      "last published bytes\n",
    );
  } finally {
    await listed.close();
  }
});

test("a persistently enumerated unavailable merge is counted explicitly and receives no fresh credit", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("persistent");
  try {
    const snapshot = await f.generate();
    expect(snapshot.source.unavailableSources).toEqual([
      {
        nodeId: removed.id,
        reason: "NOT_FOUND",
        unavailableInMergedCensus: true,
      },
    ]);
    expect(snapshot.source.counts).toMatchObject({
      mergedPullRequests: 2,
      unavailableSources: 1,
      unavailableMergedPullRequests: 1,
    });
    expect(
      snapshot.ledger.some((event) => event.source.id === removed.id),
    ).toBe(false);
    expect(
      snapshot.ledger.filter(
        (event) => event.category === "merged-pull-request",
      ),
    ).toHaveLength(2);
    expect(f.stats().attempts).toBe(2);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

test("a server-side comparison timeout retries without losing complete merged attribution", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const baseline = await fixture("healthy");
  let before: LeaderboardSnapshot;
  try {
    before = await baseline.generate();
  } finally {
    await baseline.close();
  }
  const f = await fixture("healthy", undefined, undefined, "complete");
  try {
    const snapshot = await f.generate();
    expect(snapshot.ledger).toEqual(before.ledger);
    expect(snapshot.source.counts.mergedPullRequests).toBe(2);
    expect(f.stats().comparisonPages).toEqual([1, 1, 2, 3]);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});

for (const comparison of ["unavailable", "invalid-range"] as const) {
  test(`an ${comparison} comparison fails closed within its request bound`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      await expect(f.generate()).rejects.toThrow("GitHub comparison HTTP 422");
      expect(f.stats().comparisonPages).toHaveLength(
        comparison === "unavailable" ? MAX_GRAPHQL_REQUEST_ATTEMPTS : 1,
      );
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

for (const comparison of [
  "missing",
  "duplicate",
  "wrong-base",
  "changed-count",
] as const) {
  test(`an invalid ${comparison} comparison preserves the last published snapshot`, async () => {
    setSystemTime(new Date(GENERATED_AT));
    const f = await fixture("healthy", undefined, undefined, comparison);
    try {
      await expect(f.generate()).rejects.toThrow(
        comparison === "wrong-base" || comparison === "changed-count"
          ? "comparison does not match its commit range"
          : "comparison omitted known commits",
      );
      expect(await readFile(f.output, "utf8")).toBe("last published bytes\n");
    } finally {
      await f.close();
    }
  });
}

test("open work that closes after the listing leaves the queue instead of stopping the release", async () => {
  setSystemTime(new Date(GENERATED_AT));
  const f = await fixture("open-closure");
  try {
    const snapshot = await f.generate();
    expect(snapshot.workQueue.pullRequests.map((item) => item.id)).toEqual([
      stillOpenPull.id,
    ]);
    expect(snapshot.workQueue.issues.map((item) => item.id)).toEqual([
      "I_still_open",
    ]);
    expect(snapshot.source.counts).toMatchObject({
      openPullRequests: 1,
      openIssues: 1,
      mergedPullRequests: 2,
    });
    expect(f.stats().attempts).toBe(1);
    assertLeaderboardSnapshot(JSON.parse(await readFile(f.output, "utf8")));
  } finally {
    await f.close();
  }
});
