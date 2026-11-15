import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { CorrectionSource } from "../src/lib/points-implementation-corrections";
import { collect, fixture } from "../tests/value-binary-fixture";
import type { GitHubClient } from "../workers/slopbot/github";
import { NATIVE_MERGE_CONTEXT } from "../workers/slopbot/value-native-merge";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import {
  bindRetained,
  firstAcceptedCorrectionClaims,
  groupedOriginalContributorProof,
  isMergedOriginalContributor,
  octoberOriginalContributorPartsProof,
  octoberOriginalContributorProof,
  octoberOriginalContributorUnitProof,
  originalContributorFollowupProof,
  restoreCanonicalMergeCounts,
} from "./collect-implementation-corrections";

const sha = (value: string) => value.repeat(40);
const origin = { node_id: "MDQ6VXNlcjQy", login: "origin", type: "User" };
const carrier = { node_id: "MDQ6VXNlcjQz", login: "carrier", type: "User" };
const repository = "SlopDotCash/asi";
const root = `/repos/${repository}`;
const clone = <T>(value: T): T => structuredClone(value);
const snapshot = async () => {
  const seed = await collect(fixture({ direct: true, textOnly: true }));
  const commit = (oid: string, parent: string, author = origin) => ({
    ...clone(seed.commits[0]),
    sha: oid,
    parents: [{ sha: parent }],
    author,
  });
  const original = clone(seed);
  original.repository = repository;
  original.repositoryNodeId = "R_kgDOT23CXA";
  original.pull = {
    ...original.pull,
    node_id: "PR_original",
    number: 1,
    html_url: `https://github.com/${repository}/pull/1`,
    user: origin,
    merged_by: null,
    state: "closed",
    merged_at: null,
    closed_at: "2026-10-02T00:00:00Z",
    merge_commit_sha: null,
    head: { sha: sha("a") },
    commits: 1,
  };
  original.commits = [commit(sha("a"), sha("0"))];
  const file = {
    filename: "fix.ts",
    blob_url: `https://github.com/${repository}/blob/${sha("a")}/fix.ts`,
    status: "modified" as const,
    additions: 1,
    deletions: 0,
    patch: "@@ -1 +1,2 @@\n export const one = 1;\n+export const two = 2;",
  };
  original.files = [clone(file)];
  original.commitAttribution = [
    {
      sha: sha("a"),
      actorNodeIds: [origin.node_id],
      changedPaths: ["fix.ts"],
      files: [clone(file)],
      limitations: [],
    },
  ];
  original.limitations = [];
  original.relatedPullRequests = [];

  const accepted = clone(original);
  accepted.pull = {
    ...accepted.pull,
    node_id: "PR_carrier",
    number: 2,
    html_url: `https://github.com/${repository}/pull/2`,
    user: carrier,
    merged_by: carrier,
    merged_at: "2026-10-03T00:00:00Z",
    closed_at: "2026-10-03T00:00:00Z",
    merge_commit_sha: sha("c"),
    head: { sha: sha("b") },
    commits: 2,
  };
  accepted.commits = [
    commit(sha("a"), sha("0")),
    commit(sha("b"), sha("a"), carrier),
  ];
  accepted.relatedPullRequests = [
    {
      id: original.pull.node_id,
      number: original.pull.number,
      url: original.pull.html_url,
      repository,
    },
  ];
  accepted.commitAttribution.push({
    sha: sha("b"),
    actorNodeIds: [carrier.node_id],
    changedPaths: ["fix.ts"],
    files: [clone(file)],
    limitations: [],
  });
  accepted.mergeCommitEvidence = {
    sha: sha("c"),
    html_url: "",
    parents: [{ sha: sha("f") }, { sha: sha("b") }],
    stats: { additions: 2, deletions: 0, total: 2 },
    files: [clone(file)],
  };
  const plain: CorrectionSource = {
    repository,
    repositoryNodeId: accepted.repositoryNodeId,
    sourceId: accepted.pull.node_id,
    sourceUrl: accepted.pull.html_url,
    headSha: accepted.pull.head.sha,
    occurredAt: "2026-10-03T00:00:00.000Z",
    author: { id: carrier.node_id, login: carrier.login, kind: "User" },
    complete: true,
    commitCount: 2,
    commits: accepted.commits.map((c) => ({
      sha: c.sha,
      parentCount: 1,
      author: c.author
        ? { id: c.author.node_id, login: c.author.login, kind: "User" }
        : null,
      additions: 1,
      deletions: 0,
      firstAcceptedSourceId: accepted.pull.node_id,
    })),
  };
  const sources: WorkUnitSource[] = [accepted, original].map((evidence) => ({
    evidence,
    policy: { sha: sha("0"), text: "" },
  }));
  const responses = new Map<string, unknown>();
  responses.set(`${root}/pulls/1`, {
    ...original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  responses.set(`${root}/pulls/2`, {
    ...accepted.pull,
    created_at: "2026-10-02T00:00:00Z",
  });
  responses.set(
    `${root}/git/commits/${sha("c")}`,
    clone(accepted.mergeCommitEvidence),
  );
  for (const c of accepted.commits)
    responses.set(`${root}/git/commits/${c.sha}`, clone(c));
  const comparison = (
    start: string,
    end: string,
    status: string,
    base: string,
    ahead: number,
    behind: number,
    commits: unknown[],
  ) => {
    responses.set(`${root}/compare/${start}...${end}?per_page=100&page=1`, {
      status,
      base_commit: { sha: start },
      merge_base_commit: { sha: base },
      ahead_by: ahead,
      behind_by: behind,
      total_commits: ahead,
      commits,
    });
  };
  comparison(sha("a"), sha("f"), "diverged", sha("0"), 1, 1, []);
  comparison(sha("a"), sha("b"), "ahead", sha("a"), 1, 0, [
    clone(accepted.commits[1]),
  ]);
  comparison(sha("f"), sha("c"), "ahead", sha("f"), 3, 0, [
    ...clone(accepted.commits),
    clone(accepted.mergeCommitEvidence),
  ]);
  const readPaths: string[] = [];
  const github: Pick<GitHubClient, "get"> = {
    async get<T>(path: string): Promise<T | null> {
      readPaths.push(path);
      return clone(responses.get(path) ?? null) as T | null;
    },
  };
  const owners = new Map(
    plain.commits.map((c) => [
      `${repository.toLowerCase()}\0${c.sha}`,
      plain.sourceId,
    ]),
  );
  return {
    plain,
    sources,
    responses,
    github,
    owners,
    readPaths,
    accepted,
    original,
  };
};

test("October exact Git objects bind an earlier original without a copied-patch acknowledgement", async () => {
  const input = await snapshot();
  const result = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  expect(result.originalContributor).toMatchObject({
    exactAcceptance: true,
    originalSourceId: "PR_original",
    originalCommitSha: sha("a"),
    acceptedCommitSha: sha("a"),
    boundPaths: ["fix.ts"],
  });
  expect(result.originalContributor?.bindingDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(result.sources[0].commits.map((c) => c.parentShas)).toEqual([
    [sha("0")],
    [sha("a")],
  ]);
  expect(input.readPaths).toHaveLength(8);
  input.accepted.collectedAt = "2026-11-15T00:00:00.000Z";
  input.original.collectedAt = "2026-11-15T00:00:01.000Z";
  const replay = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  expect(replay).toEqual(result);
});

test("grouped collector preserves exact original parent proofs and complete file evidence", async () => {
  const input = await snapshot();
  const ordinary = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const accepted = structuredClone(ordinary.sources[0]);
  for (const commit of accepted.commits) delete commit.parentShas;
  const claims = accepted.commits.flatMap((commit) =>
    (commit.files ?? []).map((file) => ({
      id: `claim_${commit.sha}`,
      sourceId: accepted.sourceId,
      commitSha: commit.sha,
      path: file.path,
    })),
  );
  const grouped = groupedOriginalContributorProof(accepted, ordinary, claims);
  expect(grouped.originalContributor?.exactAcceptance).toBe(true);
  expect(grouped.sources[0].commits.map((commit) => commit.parentShas)).toEqual(
    ordinary.sources[0].commits.map((commit) => commit.parentShas),
  );
  expect(grouped.sources[0].commits.map((commit) => commit.files)).toEqual(
    accepted.commits.map((commit) => commit.files),
  );
  expect(
    groupedOriginalContributorProof(accepted, ordinary, claims.slice(1))
      .sources,
  ).toHaveLength(2);
  expect(() =>
    groupedOriginalContributorProof(
      accepted,
      ordinary,
      claims.map((claim) => ({ ...claim, sourceId: "PR_other" })),
    ),
  ).toThrow("one accepted replacement");
  const changed = structuredClone(accepted);
  changed.commits[0].additions = (changed.commits[0].additions ?? 0) + 1;
  expect(() =>
    groupedOriginalContributorProof(changed, ordinary, claims),
  ).toThrow("canonical census");
});

describe("October exact Git proof refuses incomplete or competing acceptance", () => {
  const cases: [
    string,
    (input: Awaited<ReturnType<typeof snapshot>>) => void,
  ][] = [
    [
      "missing comparison",
      (i) =>
        i.responses.delete(
          `${root}/compare/${sha("a")}...${sha("f")}?per_page=100&page=1`,
        ),
    ],
    [
      "already accepted before this merge",
      (i) => {
        i.responses.set(
          `${root}/compare/${sha("a")}...${sha("f")}?per_page=100&page=1`,
          {
            status: "ahead",
            ahead_by: 1,
            behind_by: 0,
            total_commits: 1,
            base_commit: { sha: sha("a") },
            merge_base_commit: { sha: sha("a") },
            commits: [],
          },
        );
      },
    ],
    [
      "different native second parent",
      (i) => {
        (
          i.responses.get(`${root}/git/commits/${sha("c")}`) as {
            parents: { sha: string }[];
          }
        ).parents[1].sha = sha("d");
      },
    ],
    [
      "range omits a commit",
      (i) => {
        (
          i.responses.get(
            `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
          ) as { commits: unknown[] }
        ).commits.pop();
      },
    ],
    [
      "range duplicates a commit",
      (i) => {
        const r = i.responses.get(
          `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
        ) as { commits: unknown[] };
        r.commits[1] = clone(r.commits[0]);
      },
    ],
    [
      "range introduces an unknown commit",
      (i) => {
        const r = i.responses.get(
          `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
        ) as { commits: { sha: string }[] };
        r.commits[1].sha = sha("e");
      },
    ],
    [
      "missing immutable parent evidence",
      (i) => i.responses.delete(`${root}/git/commits/${sha("b")}`),
    ],
    [
      "parent edge disagrees with the pinned range",
      (i) => {
        (
          i.responses.get(`${root}/git/commits/${sha("b")}`) as {
            parents: { sha: string }[];
          }
        ).parents[0].sha = sha("d");
      },
    ],
    [
      "original was opened after the carrier",
      (i) => {
        (
          i.responses.get(`${root}/pulls/1`) as { created_at: string }
        ).created_at = "2026-10-03T00:00:00Z";
      },
    ],
    [
      "resolved reference missing",
      (i) => {
        i.accepted.relatedPullRequests = [];
      },
    ],
    [
      "source changed while collecting",
      (i) => {
        (
          i.responses.get(`${root}/pulls/1`) as { head: { sha: string } }
        ).head.sha = sha("d");
      },
    ],
    [
      "different repository",
      (i) => {
        i.original.repositoryNodeId = "R_foreign";
      },
    ],
    [
      "ordinary third party",
      (i) => {
        i.accepted.commits[1].author = {
          node_id: "MDQ6VXNlcjQ0",
          login: "third",
          type: "User",
        };
        i.plain.commits[1].author = {
          id: "MDQ6VXNlcjQ0",
          login: "third",
          kind: "User",
        };
      },
    ],
    [
      "unlinked follow-up",
      (i) => {
        i.accepted.commits[1].author = null;
        i.plain.commits[1].author = null;
      },
    ],
    [
      "bot follow-up",
      (i) => {
        i.accepted.commits[1].author = {
          node_id: "BOT_0001",
          login: "robot",
          type: "Bot",
        };
        i.plain.commits[1].author = {
          id: "BOT_0001",
          login: "robot",
          kind: "Bot",
        };
      },
    ],
    [
      "earlier first-acceptance owner",
      (i) => {
        i.owners.set(`${repository.toLowerCase()}\0${sha("a")}`, "PR_other");
        i.plain.commits[0].firstAcceptedSourceId = "PR_other";
      },
    ],
    [
      "outside October",
      (i) => {
        i.plain.occurredAt = "2026-09-03T00:00:00.000Z";
      },
    ],
  ];
  for (const [name, mutate] of cases)
    test(name, async () => {
      const input = await snapshot();
      mutate(input);
      await expect(
        octoberOriginalContributorProof(
          input.github,
          input.plain,
          input.sources,
          input.owners,
        ),
      ).rejects.toThrow();
    });
});

test("merged original collection requires exact first acceptance and explicit grouped scope", async () => {
  const input = await snapshot();
  input.original.pull.merged_at = "2026-10-03T00:00:03Z";
  input.original.pull.closed_at = input.original.pull.merged_at;
  input.original.pull.merge_commit_sha = sha("d");
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  const result = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
    true,
  );
  expect(result.originalContributor?.exactAcceptance).toBe(true);
  expect(result.sources[1].occurredAt).toBe("2026-10-03T00:00:03.000Z");
  await expect(
    octoberOriginalContributorProof(
      input.github,
      input.plain,
      input.sources,
      input.owners,
    ),
  ).rejects.toThrow("sole verified original");
  const wrong = new Map(input.owners);
  wrong.set(`${repository.toLowerCase()}\0${sha("a")}`, "PR_original");
  await expect(
    octoberOriginalContributorProof(
      input.github,
      input.plain,
      input.sources,
      wrong,
      true,
    ),
  ).rejects.toThrow();
});

test("merged donor candidate gate preserves unrelated and same-author group behavior", async () => {
  const input = await snapshot();
  const ordinary = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const accepted = ordinary.sources[0],
    donor = ordinary.sources[1];
  donor.occurredAt = "2026-10-03T00:00:03.000Z";
  donor.commits[0].firstAcceptedSourceId = accepted.sourceId;
  expect(isMergedOriginalContributor(accepted, donor)).toBe(true);
  expect(
    isMergedOriginalContributor(accepted, {
      ...donor,
      author: accepted.author,
    }),
  ).toBe(false);
  expect(
    isMergedOriginalContributor(accepted, {
      ...donor,
      occurredAt: "2026-10-02T00:00:00.000Z",
    }),
  ).toBe(false);
  const other = structuredClone(donor);
  other.commits[0].sha = sha("e");
  expect(isMergedOriginalContributor(accepted, other)).toBe(false);
  donor.commits[0].firstAcceptedSourceId = donor.sourceId;
  expect(isMergedOriginalContributor(accepted, donor)).toBe(false);
});

test("grouped correction resolves origin claims to the unique census acceptance", async () => {
  const input = await snapshot();
  const proof = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const [accepted, original] = proof.sources;
  const commit = original.commits[0];
  commit.firstAcceptedSourceId = accepted.sourceId;
  const file = commit.files?.[0];
  if (!file) throw Error("fixture");
  const claim = {
    id: "claim_origin",
    sourceId: original.sourceId,
    commitSha: commit.sha,
    path: file.path,
  };
  const resolved = firstAcceptedCorrectionClaims([claim], proof.sources);
  expect(resolved).toEqual([{ ...claim, sourceId: accepted.sourceId }]);
  expect(claim.sourceId).toBe(original.sourceId);
  const wrongOwner = clone(proof.sources);
  wrongOwner[1].commits[0].firstAcceptedSourceId = "PR_missing";
  expect(() => firstAcceptedCorrectionClaims([claim], wrongOwner)).toThrow();
  expect(() =>
    firstAcceptedCorrectionClaims(
      [{ ...claim, path: "absent" }],
      proof.sources,
    ),
  ).toThrow();
  const wrongIdentity = clone(proof.sources);
  wrongIdentity[0].repositoryNodeId = "R_other";
  expect(() => firstAcceptedCorrectionClaims([claim], wrongIdentity)).toThrow();
  const ambiguous = clone(accepted);
  expect(() =>
    firstAcceptedCorrectionClaims([claim], [...proof.sources, ambiguous]),
  ).toThrow();
});

test("later accepted follow-up collection authenticates the exact ancestor range", async () => {
  const input = await snapshot();
  const ordinary = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const accepted = ordinary.sources[0];
  const evidence = clone(input.sources[0].evidence);
  const commit = clone(evidence.commits[0]);
  commit.sha = sha("9");
  commit.parents = [{ ...commit.parents[0], sha: accepted.headSha }];
  evidence.commits = [commit];
  const source: CorrectionSource = {
    ...clone(accepted),
    sourceId: "PR_followup",
    headSha: commit.sha,
    occurredAt: "2026-10-30T00:00:00.000Z",
    commitCount: 1,
    commits: [
      {
        sha: commit.sha,
        parentCount: 1,
        author: accepted.author,
        additions: 1,
        deletions: 0,
        files: [{ path: "fix.ts", additions: 1, deletions: 0 }],
        firstAcceptedSourceId: "PR_followup",
      },
    ],
  };
  const response = {
    status: "ahead",
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    merge_base_commit: { sha: accepted.headSha },
    commits: [commit],
  };
  const github = {
    get: async <T>(path: string): Promise<T> =>
      (path.includes("/git/commits/") ? commit : response) as T,
  };
  const proof = await originalContributorFollowupProof(
    github,
    accepted,
    source,
    evidence,
    input.sources[0].policy,
  );
  expect(proof.ancestorSha).toBe(accepted.headSha);
  expect(source.commits[0].parentShas).toEqual([accepted.headSha]);
  response.behind_by = 1;
  await expect(
    originalContributorFollowupProof(
      github,
      accepted,
      source,
      evidence,
      input.sources[0].policy,
    ),
  ).rejects.toThrow("does not descend");
  response.behind_by = 0;
  response.commits.push(commit);
  response.total_commits = 2;
  response.ahead_by = 2;
  await expect(
    originalContributorFollowupProof(
      github,
      accepted,
      source,
      evidence,
      input.sources[0].policy,
    ),
  ).rejects.toThrow("Invalid accepted follow-up");
});

test("accepted follow-up reference is rechecked against current canonical GitHub bytes", async () => {
  const input = await snapshot();
  const original = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const accepted = original.sources[0];
  const evidence = clone(input.sources[0].evidence);
  Object.assign(evidence.pull, {
    node_id: "PR_followup",
    number: 9,
    html_url: `https://github.com/${repository}/pull/9`,
    body: `Promote #${input.sources[0].evidence.pull.number}`,
    merged_at: "2026-10-30T00:00:00Z",
  });
  evidence.pull.user = { ...carrier };
  evidence.pull.merged_by = { ...origin };
  evidence.relatedPullRequests = [
    {
      id: accepted.sourceId,
      number: input.sources[0].evidence.pull.number,
      url: accepted.sourceUrl,
      repository,
    },
  ];
  const source: CorrectionSource = {
    ...clone(accepted),
    sourceId: evidence.pull.node_id,
    sourceUrl: evidence.pull.html_url,
    occurredAt: new Date(String(evidence.pull.merged_at)).toISOString(),
  };
  source.commits.forEach((commit) => {
    commit.author = {
      id: carrier.node_id,
      login: carrier.login,
      kind: carrier.type,
    };
    commit.firstAcceptedSourceId = source.sourceId;
  });
  let current = {
    ...clone(evidence.pull),
    user: { ...evidence.pull.user, url: "https://github.com/carrier" },
    head: { ...evidence.pull.head, ref: "feature" },
  };
  const github = { get: async <T>(): Promise<T> => current as T };
  const result = await originalContributorFollowupProof(
    github,
    accepted,
    source,
    evidence,
    input.sources[0].policy,
  );
  expect(result.reference?.target.id).toBe(accepted.sourceId);
  delete (current.user as { node_id?: string }).node_id;
  await expect(
    originalContributorFollowupProof(
      github,
      accepted,
      source,
      evidence,
      input.sources[0].policy,
    ),
  ).rejects.toThrow("changed during collection");
  current = {
    ...current,
    user: { ...evidence.pull.user, url: "https://github.com/carrier" },
  };
  current.body = "Changed unrelated description";
  await expect(
    originalContributorFollowupProof(
      github,
      accepted,
      source,
      evidence,
      input.sources[0].policy,
    ),
  ).rejects.toThrow("changed during collection");
});

test("native unit proof binds an unlinked original while preserving unrelated carrier work", async () => {
  const input = await snapshot();
  input.original.commits[0].author = null;
  input.accepted.commits[0].author = null;
  input.original.commitAttribution[0].actorNodeIds = [];
  input.accepted.commitAttribution[0].actorNodeIds = [];
  input.plain.commits[0].author = null;
  input.accepted.relatedPullRequests = [];
  const claims = [
    {
      id: "claim_origin",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
    {
      id: "claim_followup",
      sourceId: input.plain.sourceId,
      commitSha: sha("b"),
      path: "fix.ts",
    },
  ];
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.originalContributor?.claimIds).toEqual(
    claims.map((claim) => claim.id),
  );
  expect(proof.sources[0].commits).toHaveLength(2);
  expect(proof.sources[1].commits[0].author).toBeNull();
  input.plain.commits[1].author = {
    id: "MDQ6VXNlcjQ0",
    login: "third",
    kind: "User",
  };
  input.accepted.commits[1].author = {
    node_id: "MDQ6VXNlcjQ0",
    login: "third",
    type: "User",
  };
  const unrelated = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims.slice(0, 1),
  );
  expect(unrelated.sources[0].commits[1].author?.login).toBe("third");
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
    ),
  ).rejects.toThrow("unverified contributor");
});

test("unselected grouped context retains full-census merge counters with strict identity", async () => {
  const input = await snapshot();
  const proof = await octoberOriginalContributorProof(
    input.github,
    input.plain,
    input.sources,
    input.owners,
  );
  const source = proof.sources[0];
  const commit: import("../src/lib/points-implementation-corrections").CorrectionCommit =
    {
      ...source.commits[0],
      parentCount: 2,
      additions: null,
      deletions: null,
    };
  source.commits = [commit];
  source.commitCount = 1;
  const outcome = {
    id: source.sourceId,
    commits: [
      {
        oid: commit.sha,
        parentCount: 2,
        author: commit.author,
        additions: 400,
        deletions: 20,
      },
    ],
  } as unknown as import("../src/lib/leaderboard").MergedPullRequestOutcome;
  restoreCanonicalMergeCounts([source], new Map([[source.sourceId, outcome]]));
  expect([commit.additions, commit.deletions]).toEqual([400, 20]);
  commit.additions = 401;
  expect(() =>
    restoreCanonicalMergeCounts(
      [source],
      new Map([[source.sourceId, outcome]]),
    ),
  ).toThrow("disagree");
  commit.additions = null;
  const canonical = outcome.commits?.[0];
  if (!canonical) throw Error("fixture");
  canonical.parentCount = 1;
  expect(() =>
    restoreCanonicalMergeCounts(
      [source],
      new Map([[source.sourceId, outcome]]),
    ),
  ).toThrow("disagree");
});

test("native reviewed unit accepts a carrier-authored sync head with the original ordinary work", async () => {
  const input = await snapshot();
  const sync = input.accepted.commits[1];
  sync.parents.push({ sha: sha("e") });
  input.original.pull.head.sha = sync.sha;
  input.original.pull.commits = 2;
  input.original.pull.merged_at = "2026-10-03T00:00:02Z";
  input.original.commits.push(clone(sync));
  input.original.commitAttribution.push(
    clone(input.accepted.commitAttribution[1]),
  );
  input.plain.commits[1].parentCount = 2;
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  input.responses.set(`${root}/git/commits/${sync.sha}`, clone(sync));
  const range = input.responses.get(
    `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
  ) as any;
  range.commits[1] = clone(sync);
  for (const [end, status, behind] of [
    [sha("f"), "diverged", 1],
    [sha("b"), "identical", 0],
  ] as const)
    input.responses.set(
      `${root}/compare/${sync.sha}...${end}?per_page=100&page=1`,
      {
        status,
        base_commit: { sha: sync.sha },
        merge_base_commit: {
          sha: status === "identical" ? sync.sha : sha("0"),
        },
        ahead_by: 0,
        behind_by: behind,
        total_commits: 0,
        commits: [],
      },
    );
  const claims = [
    {
      id: "claim_origin",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
  ];
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.originalContributor?.originalCommitSha).toBe(sha("a"));
  expect(proof.originalContributor?.boundPaths).toEqual(["fix.ts"]);
  const { originalContributorClaimScope } = await import(
    "../src/lib/points-implementation-corrections"
  );
  expect(
    originalContributorClaimScope(
      proof.sources[1],
      proof.sources[0],
      claims,
      [],
      proof.originalContributor?.originalCommitSha,
    ),
  ).toBe(true);
  proof.sources[1].commits[1].author = {
    id: "third",
    login: "third",
    kind: "User",
  };
  expect(
    originalContributorClaimScope(proof.sources[1], proof.sources[0], claims),
  ).toBe(false);
  proof.sources[1].commits[1].author = proof.sources[0].author;
  proof.sources[0].commits[0].parentShas = [sync.sha];
  expect(
    originalContributorClaimScope(proof.sources[1], proof.sources[0], claims),
  ).toBe(false);
});

test("native unit retains PR commits already accepted through the base", async () => {
  const input = await snapshot();
  const inherited = clone(input.accepted.commits[0]);
  inherited.sha = sha("d");
  inherited.parents = [{ sha: sha("0") }];
  inherited.author = { node_id: "third", login: "third", type: "User" };
  input.accepted.commits.unshift(inherited);
  input.accepted.pull.commits++;
  input.accepted.commitAttribution.unshift({
    ...clone(input.accepted.commitAttribution[0]),
    sha: inherited.sha,
  });
  input.plain.commits.unshift({
    sha: inherited.sha,
    parentCount: 1,
    author: { id: "third", login: "third", kind: "User" },
    additions: 1,
    deletions: 0,
    firstAcceptedSourceId: "PR_earlier",
  });
  input.plain.commitCount++;
  input.owners.set(
    `${repository.toLowerCase()}\0${inherited.sha}`,
    "PR_earlier",
  );
  input.responses.set(`${root}/pulls/2`, {
    ...input.accepted.pull,
    created_at: "2026-10-02T00:00:00Z",
  });
  input.responses.set(`${root}/git/commits/${inherited.sha}`, clone(inherited));
  const path = `${root}/compare/${inherited.sha}...${sha("f")}?per_page=100&page=1`;
  input.responses.set(path, {
    status: "ahead",
    base_commit: { sha: inherited.sha },
    merge_base_commit: { sha: inherited.sha },
    ahead_by: 1,
    behind_by: 0,
    total_commits: 1,
    commits: [],
  });
  const claims = [
    {
      id: "claim_origin",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
  ];
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.sources[0].commits).toHaveLength(3);
  expect(proof.sources[0].commits[0].firstAcceptedSourceId).toBe("PR_earlier");
  expect(input.readPaths.filter((request) => request === path)).toHaveLength(1);
  const baseRange = input.responses.get(path) as {
    status: string;
    behind_by: number;
  };
  baseRange.status = "diverged";
  baseRange.behind_by = 1;
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
    ),
  ).rejects.toThrow("not in the native accepted base");
  baseRange.status = "ahead";
  baseRange.behind_by = 0;
  const retainedCommit = input.responses.get(
    `${root}/git/commits/${inherited.sha}`,
  ) as { parents: { sha: string }[] };
  retainedCommit.parents = [{ sha: sha("9") }];
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
    ),
  ).rejects.toThrow("parent evidence is unavailable or inconsistent");
  retainedCommit.parents = [{ sha: sha("0") }];
  input.plain.commits[0].firstAcceptedSourceId = input.plain.sourceId;
  input.owners.set(
    `${repository.toLowerCase()}\0${inherited.sha}`,
    input.plain.sourceId,
  );
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
    ),
  ).rejects.toThrow("accepted range is incomplete");
});

test("native omitted ancestry covers several heads and rejects a disconnected cycle", async () => {
  const input = await snapshot();
  const chains = [
    { id: "d", parent: "0" },
    { id: "e", parent: "d" },
    { id: "8", parent: "0" },
  ];
  for (const { id, parent } of chains) {
    const commit = clone(input.accepted.commits[0]);
    commit.sha = sha(id);
    commit.parents = [{ sha: sha(parent) }];
    input.accepted.commits.unshift(commit);
    input.accepted.commitAttribution.unshift({
      ...clone(input.accepted.commitAttribution[0]),
      sha: commit.sha,
    });
    input.plain.commits.unshift({
      sha: commit.sha,
      parentCount: 1,
      author: { id: origin.node_id, login: origin.login, kind: "User" },
      additions: 1,
      deletions: 0,
      firstAcceptedSourceId: "PR_earlier",
    });
    input.owners.set(
      `${repository.toLowerCase()}\0${commit.sha}`,
      "PR_earlier",
    );
    input.responses.set(`${root}/git/commits/${commit.sha}`, clone(commit));
    input.responses.set(
      `${root}/compare/${commit.sha}...${sha("f")}?per_page=100&page=1`,
      {
        status: "ahead",
        base_commit: { sha: commit.sha },
        merge_base_commit: { sha: commit.sha },
        ahead_by: 1,
        behind_by: 0,
        total_commits: 1,
        commits: [],
      },
    );
  }
  input.accepted.pull.commits += chains.length;
  input.plain.commitCount += chains.length;
  input.responses.set(`${root}/pulls/2`, {
    ...input.accepted.pull,
    created_at: "2026-10-02T00:00:00Z",
  });
  const claims = [
    {
      id: "claim_origin",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
  ];
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.sources[0].commits).toHaveLength(5);
  expect(
    input.readPaths.filter((path) =>
      path.includes(`/compare/${sha("d")}...${sha("f")}`),
    ),
  ).toHaveLength(0);
  expect(
    input.readPaths.filter((path) =>
      path.includes(`/compare/${sha("e")}...${sha("f")}`),
    ),
  ).toHaveLength(1);
  expect(
    input.readPaths.filter((path) =>
      path.includes(`/compare/${sha("8")}...${sha("f")}`),
    ),
  ).toHaveLength(1);
  const first = input.accepted.commits.find(
    (commit) => commit.sha === sha("d"),
  );
  if (!first) throw Error("Missing fixture");
  first.parents = [{ sha: sha("e") }];
  input.responses.set(`${root}/git/commits/${first.sha}`, clone(first));
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
    ),
  ).rejects.toThrow("omitted PR ancestry is incomplete");
});

test("native unit selects later follow-up claims while retaining unrelated work", async () => {
  const input = await snapshot();
  const followup = clone(input.sources[0]);
  const later = clone(input.accepted.commits[1]);
  later.sha = sha("d");
  later.parents = [{ sha: sha("b") }];
  const unrelated = clone(input.accepted.commits[0]);
  unrelated.sha = sha("e");
  unrelated.parents = [{ sha: sha("0") }];
  unrelated.author = { node_id: "third", login: "third", type: "User" };
  followup.evidence.pull = {
    ...followup.evidence.pull,
    node_id: "PR_followup",
    number: 3,
    html_url: `https://github.com/${repository}/pull/3`,
    head: { sha: later.sha },
    merged_at: "2026-10-04T00:00:00Z",
    commits: 2,
  };
  followup.evidence.commits = [unrelated, later];
  followup.evidence.commitAttribution = [unrelated, later].map((commit) => ({
    ...clone(input.accepted.commitAttribution[0]),
    sha: commit.sha,
  }));
  input.owners.set(`${repository.toLowerCase()}\0${later.sha}`, "PR_followup");
  input.owners.set(
    `${repository.toLowerCase()}\0${unrelated.sha}`,
    "PR_followup",
  );
  followup.evidence.pull.merge_commit_sha = sha("9");
  const priorMerge = input.accepted.mergeCommitEvidence;
  if (!priorMerge) throw Error("Missing fixture merge");
  followup.evidence.mergeCommitEvidence = {
    ...clone(priorMerge),
    sha: sha("9"),
    parents: [{ sha: sha("f") }, { sha: later.sha }],
  };
  input.responses.set(`${root}/pulls/3`, clone(followup.evidence.pull));
  input.responses.set(
    `${root}/git/commits/${sha("9")}`,
    clone(followup.evidence.mergeCommitEvidence),
  );
  input.responses.set(
    `${root}/compare/${sha("f")}...${sha("9")}?per_page=100&page=1`,
    {
      status: "ahead",
      base_commit: { sha: sha("f") },
      merge_base_commit: { sha: sha("f") },
      ahead_by: 3,
      behind_by: 0,
      total_commits: 3,
      commits: [
        ...clone(followup.evidence.commits),
        clone(followup.evidence.mergeCommitEvidence),
      ],
    },
  );
  for (const commit of followup.evidence.commits)
    input.responses.set(`${root}/git/commits/${commit.sha}`, clone(commit));
  const path = `${root}/compare/${sha("a")}...${later.sha}?per_page=100&page=1`;
  input.responses.set(path, {
    status: "ahead",
    merge_base_commit: { sha: sha("a") },
    ahead_by: 2,
    behind_by: 0,
    total_commits: 2,
    commits: [clone(input.accepted.commits[1]), clone(later)],
  });
  const claims = [
    {
      id: "claim_origin",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
    {
      id: "claim_later",
      sourceId: "PR_followup",
      commitSha: later.sha,
      path: "fix.ts",
    },
  ];
  const prove = () =>
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      claims,
      [followup],
    );
  const proof = await prove();
  expect(proof.originalContributor?.claimIds).toEqual(
    claims.map((claim) => claim.id),
  );
  expect(proof.sources[2].commits).toHaveLength(2);
  expect(proof.sources[2].commits[0].author?.id).toBe("third");
  const binding = proof.originalContributor?.followups?.[0];
  if (!binding) throw Error("Missing follow-up proof");
  const { originalContributorClaimScope } = await import(
    "../src/lib/points-implementation-corrections"
  );
  expect(
    originalContributorClaimScope(proof.sources[1], proof.sources[0], claims, [
      { source: proof.sources[2], binding },
    ]),
  ).toBe(true);
  claims[1].commitSha = unrelated.sha;
  await expect(prove()).rejects.toThrow("Invalid accepted follow-up source");
  claims[1].commitSha = later.sha;
  const current = input.responses.get(`${root}/pulls/3`) as { body: string };
  current.body = "changed after source capture";
  await expect(prove()).rejects.toThrow("changed during collection");
  input.responses.set(`${root}/pulls/3`, clone(followup.evidence.pull));
  const range = input.responses.get(path) as {
    merge_base_commit: { sha: string };
  };
  range.merge_base_commit.sha = sha("0");
  await expect(prove()).rejects.toThrow("does not descend");
});

test("the native collector partitions two original PRs by one contributor", async () => {
  const input = await snapshot();
  const second = clone(input.sources[1]);
  second.evidence.pull = {
    ...second.evidence.pull,
    node_id: "PR_second_original",
    number: 4,
    html_url: `https://github.com/${repository}/pull/4`,
    head: { sha: sha("d") },
  };
  second.evidence.commits[0].sha = sha("d");
  second.evidence.commitAttribution[0].sha = sha("d");
  const accepted = input.sources[0].evidence;
  accepted.commits.push(clone(second.evidence.commits[0]));
  accepted.pull.commits++;
  accepted.commitAttribution.push(clone(second.evidence.commitAttribution[0]));
  input.owners.set(
    `${repository.toLowerCase()}\0${sha("d")}`,
    accepted.pull.node_id,
  );
  input.responses.set(`${root}/pulls/2`, {
    ...clone(accepted.pull),
    created_at: "2026-10-02T00:00:00Z",
  });
  input.responses.set(`${root}/pulls/4`, {
    ...clone(second.evidence.pull),
    created_at: "2026-10-01T00:00:00Z",
  });
  input.responses.set(
    `${root}/git/commits/${sha("d")}`,
    clone(second.evidence.commits[0]),
  );
  for (const [end, status, behind] of [
    [sha("f"), "diverged", 1],
    [sha("b"), "ahead", 0],
  ] as const)
    input.responses.set(
      `${root}/compare/${sha("d")}...${end}?per_page=100&page=1`,
      {
        status,
        base_commit: { sha: sha("d") },
        merge_base_commit: { sha: status === "ahead" ? sha("d") : sha("0") },
        ahead_by: 0,
        behind_by: behind,
        total_commits: 0,
        commits: [],
      },
    );
  const range = input.responses.get(
    `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
  ) as {
    commits: unknown[];
    total_commits: number;
    ahead_by: number;
  };
  range.commits.splice(2, 0, clone(second.evidence.commits[0]));
  range.total_commits++;
  range.ahead_by++;
  const claims = [
    {
      id: "claim_first",
      sourceId: accepted.pull.node_id,
      commitSha: sha("a"),
      path: "fix.ts",
    },
    {
      id: "claim_second",
      sourceId: accepted.pull.node_id,
      commitSha: sha("d"),
      path: "fix.ts",
    },
  ];
  const originals = new Map([
    [input.original.pull.node_id, ["claim_first"]],
    [second.evidence.pull.node_id, ["claim_second"]],
  ]);
  const proof = await octoberOriginalContributorPartsProof(
    input.github,
    [...input.sources, second],
    input.owners,
    claims,
    originals,
    accepted.pull.node_id,
  );
  expect(proof.originalContributorParts).toHaveLength(2);
  expect(proof.originalContributorParts?.map((part) => part.claimIds)).toEqual([
    ["claim_first"],
    ["claim_second"],
  ]);
  const repair = {
    id: "claim_new_file",
    sourceId: accepted.pull.node_id,
    commitSha: sha("b"),
    path: "new-test.ts",
  };
  accepted.commitAttribution[1].files?.push({
    ...clone(accepted.commitAttribution[1].files[0]),
    filename: repair.path,
  });
  accepted.commitAttribution[1].changedPaths?.push(repair.path);
  const withNewFile = await octoberOriginalContributorPartsProof(
    input.github,
    [...input.sources, second],
    input.owners,
    [...claims, repair],
    originals,
    accepted.pull.node_id,
  );
  expect(
    withNewFile.originalContributorParts?.flatMap(
      (part) => part.claimIds ?? [],
    ),
  ).toContain(repair.id);
  second.evidence.pull.user = carrier;
  await expect(
    octoberOriginalContributorPartsProof(
      input.github,
      [...input.sources, second],
      input.owners,
      claims,
      originals,
      accepted.pull.node_id,
    ),
  ).rejects.toThrow("different originating contributors");
});

async function repairSnapshot() {
  const input = await snapshot();
  const repairAuthor = {
    node_id: "MDQ6VXNlcjQ0",
    login: "repairer",
    type: "User",
  };
  input.accepted.commits[1].author = repairAuthor;
  input.plain.commits[1].author = {
    id: repairAuthor.node_id,
    login: repairAuthor.login,
    kind: "User",
  };
  input.original.pull.head.sha = sha("b");
  input.original.pull.commits = 2;
  input.original.pull.updated_at = "2026-10-03T00:00:00Z";
  input.original.commits.push(clone(input.accepted.commits[1]));
  input.original.commitAttribution.push(
    clone(input.accepted.commitAttribution[1]),
  );
  input.original.commitAttribution[1].actorNodeIds = [repairAuthor.node_id];
  input.accepted.commitAttribution[1].actorNodeIds = [repairAuthor.node_id];
  input.original.comments = [
    {
      node_id: "IC_repair",
      body: `Repair pushed at ${sha("b")}`,
      user: carrier,
      created_at: "2026-10-02T12:00:00Z",
      updated_at: "2026-10-02T12:00:00Z",
      html_url: `https://github.com/${repository}/pull/1#issuecomment-1`,
    },
  ];
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  input.responses.set(
    `${root}/git/commits/${sha("b")}`,
    clone(input.accepted.commits[1]),
  );
  const range = input.responses.get(
    `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
  ) as { commits: unknown[] };
  range.commits[1] = clone(input.accepted.commits[1]);
  const claims = ["a", "b"].map((id) => ({
    id: `claim_${id}`,
    sourceId: input.plain.sourceId,
    commitSha: sha(id),
    path: "fix.ts",
  }));
  return { ...input, claims };
}

test("native unit collector binds the merger's original-PR repair acknowledgement and retains the repair author", async () => {
  const input = await repairSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(proof.originalContributor?.repairs).toHaveLength(1);
  expect(proof.originalContributor?.repairs?.[0].authorNodeId).toBe(
    "MDQ6VXNlcjQ0",
  );
  expect(proof.sources[0].commits[1].author?.id).toBe("MDQ6VXNlcjQ0");
});

for (const fault of [
  "wrong-merger",
  "wrong-head",
  "edited",
  "nonancestor",
] as const) {
  test(`native unit collector refuses repair ${fault}`, async () => {
    const input = await repairSnapshot();
    if (fault === "wrong-merger") input.original.comments[0].user = origin;
    if (fault === "wrong-head")
      input.original.comments[0].body = `Repair pushed at ${sha("9")}`;
    if (fault === "edited")
      input.original.comments[0].updated_at = "2026-10-03T00:00:00Z";
    if (fault === "nonancestor") {
      input.accepted.commits[1].parents = [{ sha: sha("9") }];
      input.original.commits[1].parents = [{ sha: sha("9") }];
      input.responses.set(
        `${root}/git/commits/${sha("b")}`,
        clone(input.accepted.commits[1]),
      );
    }
    expect(
      octoberOriginalContributorUnitProof(
        input.github,
        input.plain,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}

async function bodyRepairSnapshot() {
  const input = await repairSnapshot();
  input.original.comments = [];
  input.accepted.pull.body = `Incorporates #1. Accepted head ${sha("b")}`;
  input.accepted.pull.updated_at = "2026-10-03T01:00:00Z";
  input.responses.set(`${root}/pulls/2`, {
    ...input.accepted.pull,
    created_at: "2026-10-02T00:00:00Z",
  });
  const body = {
    id: input.accepted.pull.node_id,
    body: input.accepted.pull.body,
    headRefOid: sha("b"),
    mergedAt: input.accepted.pull.merged_at,
    updatedAt: input.accepted.pull.updated_at,
    lastEditedAt: "2026-10-02T12:00:00Z",
    editor: { id: carrier.node_id, __typename: "User" },
    author: { id: carrier.node_id, __typename: "User" },
  };
  const github = {
    ...input.github,
    async graphql<T>(): Promise<T> {
      return { repository: { pullRequest: clone(body) } } as T;
    },
  };
  return { ...input, github, body };
}

test("native unit collector binds a pre-merge carrier body to its authenticated editor and source head", async () => {
  const input = await bodyRepairSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(proof.originalContributor?.repairs?.[0].sourceId).toBe("PR_carrier");
  expect(
    proof.originalContributor?.repairs?.[0].reference.bodyEdit?.editor?.id,
  ).toBe(carrier.node_id);
});
for (const fault of [
  "editor",
  "changed-body",
  "changed-head",
  "changed-id",
  "changed-merge",
  "future-edit",
  "post-merge-edit",
  "missing-metadata",
] as const) {
  test(`carrier body repair refuses ${fault}`, async () => {
    const input = await bodyRepairSnapshot();
    if (fault === "editor") input.body.editor.id = origin.node_id;
    if (fault === "changed-body") input.body.body = "Other text";
    if (fault === "changed-head") input.body.headRefOid = sha("9");
    if (fault === "changed-id") input.body.id = "PR_other";
    if (fault === "changed-merge") input.body.mergedAt = "2026-10-04T00:00:00Z";
    if (fault === "future-edit")
      input.body.lastEditedAt = "2026-10-04T00:00:00Z";
    if (fault === "post-merge-edit")
      input.body.lastEditedAt = "2026-10-03T00:30:00Z";
    const github = input.github;
    if (fault === "missing-metadata")
      delete (github as Partial<typeof github>).graphql;
    expect(
      octoberOriginalContributorUnitProof(
        github,
        input.plain,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}

async function reviewedRevisionSnapshot() {
  const input = await snapshot();
  const historical = clone(input.original.commits[0]);
  const current = {
    ...clone(historical),
    sha: sha("e"),
    parents: [{ sha: sha("d") }],
  };
  input.original.commits = [current];
  input.original.pull.head.sha = current.sha;
  input.original.commitAttribution[0].sha = current.sha;
  input.original.reviews = [
    {
      id: 23,
      node_id: "PRR_historical",
      html_url: `${input.original.pull.html_url}#pullrequestreview-23`,
      user: carrier,
      body: "Checked the original change.",
      state: "COMMENTED",
      submitted_at: "2026-10-02T00:00:00Z",
      commit_id: historical.sha,
    },
  ];
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  input.responses.set(
    `${root}/pulls/1/reviews/23`,
    clone(input.original.reviews[0]),
  );
  input.responses.set(`${root}/commits/${historical.sha}`, historical);
  input.responses.set(`${root}/git/commits/${current.sha}`, current);
  const claims = [
    {
      id: "claim_historical",
      sourceId: input.plain.sourceId,
      commitSha: historical.sha,
      path: "fix.ts",
    },
  ];
  return { ...input, claims };
}

test("a freshly verified review binds a historical original revision while retaining the current PR", async () => {
  const input = await reviewedRevisionSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(
    proof.originalContributor?.reviewedOriginal?.commits.map(
      (commit) => commit.sha,
    ),
  ).toEqual([sha("a")]);
  expect(
    proof.sources.find((source) => source.sourceId === "PR_original")?.headSha,
  ).toBe(sha("e"));
  expect(input.readPaths).toContain(`${root}/pulls/1/reviews/23`);
  expect(input.readPaths).toContain(`${root}/commits/${sha("a")}`);
});

for (const fault of [
  "review",
  "current-head",
  "author",
  "parents",
  "late-review",
] as const) {
  test(`reviewed original revision refuses ${fault}`, async () => {
    const input = await reviewedRevisionSnapshot();
    if (fault === "review")
      (
        input.responses.get(`${root}/pulls/1/reviews/23`) as { body: string }
      ).body = "Changed";
    if (fault === "current-head")
      (
        input.responses.get(`${root}/pulls/1`) as { head: { sha: string } }
      ).head = { sha: sha("9") };
    if (fault === "author")
      (
        input.responses.get(`${root}/commits/${sha("a")}`) as {
          author: typeof origin;
        }
      ).author = carrier;
    if (fault === "parents")
      (
        input.responses.get(`${root}/commits/${sha("a")}`) as {
          parents: { sha: string }[];
        }
      ).parents = [{ sha: sha("9") }];
    if (fault === "late-review")
      input.original.reviews[0].submitted_at = "2026-10-04T00:00:00Z";
    await expect(
      octoberOriginalContributorUnitProof(
        input.github,
        input.plain,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}

async function copiedUnitSnapshot() {
  const input = await snapshot();
  const acceptedCopy = input.accepted.commits[0];
  const file = input.accepted.commitAttribution[0].files?.[0];
  if (!file) throw new Error("Missing fixture file");
  acceptedCopy.sha = sha("d");
  input.accepted.commitAttribution[0].sha = acceptedCopy.sha;
  input.accepted.commits[1].parents = [{ sha: acceptedCopy.sha }];
  input.accepted.commitAttribution[1].files = [
    {
      ...file,
      patch: "@@ -2 +2,2 @@\n export const two = 2;\n+export const three = 3;",
    },
  ];
  input.original.relatedPullRequests = [
    {
      id: input.accepted.pull.node_id,
      number: 2,
      url: input.accepted.pull.html_url,
      repository,
    },
  ];
  input.original.comments = [
    {
      node_id: "IC_copied",
      html_url: `${input.original.pull.html_url}#issuecomment-2`,
      user: carrier,
      body: "Your commits are carried over unchanged, with authorship, in #2.",
      created_at: "2026-10-03T01:00:00Z",
      updated_at: "2026-10-03T01:00:00Z",
    },
  ];
  const unrelated = clone(acceptedCopy);
  unrelated.sha = sha("e");
  unrelated.author = {
    node_id: "U_unrelated",
    login: "unrelated",
    type: "User",
  };
  unrelated.parents = [{ sha: input.accepted.commits[1].sha }];
  input.accepted.commits.push(unrelated);
  input.accepted.commitAttribution.push({
    sha: unrelated.sha,
    actorNodeIds: [unrelated.author.node_id],
    changedPaths: ["other.ts"],
    files: [
      {
        ...file,
        filename: "other.ts",
      },
    ],
    limitations: [],
  });
  input.accepted.pull.head.sha = unrelated.sha;
  input.accepted.pull.commits = 3;
  const merge = input.accepted.mergeCommitEvidence;
  if (!merge) throw new Error("Missing fixture merge");
  merge.parents[1].sha = unrelated.sha;
  for (const commit of [...input.original.commits, ...input.accepted.commits])
    input.responses.set(`${root}/git/commits/${commit.sha}`, clone(commit));
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  input.responses.set(`${root}/pulls/2`, {
    ...input.accepted.pull,
    created_at: "2026-10-02T00:00:00Z",
  });
  input.responses.set(
    `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
    {
      status: "ahead",
      base_commit: { sha: sha("f") },
      merge_base_commit: { sha: sha("f") },
      ahead_by: 4,
      behind_by: 0,
      total_commits: 4,
      commits: [
        ...clone(input.accepted.commits),
        clone(input.accepted.mergeCommitEvidence),
      ],
    },
  );
  const owners = new Map(
    input.accepted.commits.map((c) => [
      `${repository.toLowerCase()}\0${c.sha}`,
      input.accepted.pull.node_id,
    ]),
  );
  const sources = await bindRetained(input.sources, owners, true);
  const accepted = sources.find(
    (s) => s.sourceId === input.accepted.pull.node_id,
  );
  if (!accepted) throw new Error("Missing accepted source");
  const claims = [sha("d"), sha("b")].map((commitSha, index) => ({
    id: `copied_claim_${index}`,
    sourceId: accepted.sourceId,
    commitSha,
    path: "fix.ts",
  }));
  return { ...input, owners, acceptedSource: accepted, claims };
}

test("a reviewed copied unit retains unrelated carrier work without granting it the original's pool", async () => {
  const input = await copiedUnitSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.acceptedSource,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(proof.originalContributor?.copiedClaims).toHaveLength(1);
  expect(proof.originalContributor?.claimIds).toEqual(
    input.claims.map((c) => c.id),
  );
  expect(proof.sources[0].commits).toHaveLength(3);
});
for (const fault of [
  "foreign-claim",
  "copy-author",
  "first-owner",
  "missing-copy",
  "copy-path",
] as const) {
  test(`copied unit refuses ${fault}`, async () => {
    const input = await copiedUnitSnapshot();
    if (fault === "foreign-claim")
      input.claims.push({
        id: "foreign",
        sourceId: input.acceptedSource.sourceId,
        commitSha: sha("e"),
        path: "other.ts",
      });
    if (fault === "copy-author") input.accepted.commits[0].author = carrier;
    if (fault === "first-owner")
      input.owners.set(
        `${repository.toLowerCase()}\0${sha("d")}`,
        "PR_earlier",
      );
    if (fault === "missing-copy") {
      input.original.comments = [];
      input.original.relatedPullRequests = [];
      input.accepted.relatedPullRequests = [];
    }
    if (fault === "copy-path") input.claims[0].path = "other.ts";
    await expect(
      octoberOriginalContributorUnitProof(
        input.github,
        input.acceptedSource,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}

async function nativeUnitContextSnapshot() {
  const input = await snapshot();
  input.original.pull.merged_at = "2026-10-03T00:00:01Z";
  input.original.pull.closed_at = input.original.pull.merged_at;
  input.original.pull.merge_commit_sha = input.accepted.pull.merge_commit_sha;
  input.original.mergeCommitEvidence = clone(
    input.accepted.mergeCommitEvidence,
  );
  const historicalText = "export const one = 1;\nexport const two = 2;\n";
  const acceptedText = "export const one = 1;\nexport const two = 2;\n";
  const objectHash = (kind: string, bytes: Buffer) =>
    createHash("sha1")
      .update(`${kind} ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
  const tree = (commitSha: string, text: string) => {
    const blobSha = objectHash("blob", Buffer.from(text));
    const bytes = Buffer.concat([
      Buffer.from("100644 fix.ts\0"),
      Buffer.from(blobSha, "hex"),
    ]);
    return {
      commitSha,
      treeSha: objectHash("tree", bytes),
      entries: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blobSha }],
    };
  };
  const trees = [tree(sha("a"), historicalText), tree(sha("c"), acceptedText)];
  input.original.nativeMergeAcceptance = {
    schemaVersion: 1,
    headSha: sha("a"),
    mergeSha: sha("c"),
    parentSha: sha("f"),
    integratedHeadSha: sha("b"),
    ancestry: [clone(input.accepted.commits[1])],
    trees,
    retainedFiles: [
      {
        sourcePath: "fix.ts",
        acceptedPath: "fix.ts",
        historical: {
          blobSha: trees[0].entries[0].sha,
          mode: "100644",
          text: historicalText,
        },
        accepted: {
          blobSha: trees[1].entries[0].sha,
          mode: "100644",
          text: acceptedText,
        },
      },
    ],
  };
  input.original.limitations = [NATIVE_MERGE_CONTEXT];
  input.responses.set(`${root}/pulls/1`, {
    ...input.original.pull,
    created_at: "2026-10-01T00:00:00Z",
  });
  const converted = await bindRetained(input.sources, input.owners, true);
  const accepted = converted.find(
    (source) => source.sourceId === input.accepted.pull.node_id,
  );
  if (!accepted) throw Error("Missing accepted fixture");
  return {
    ...input,
    acceptedSource: accepted,
    claims: [
      {
        id: "native_original",
        sourceId: accepted.sourceId,
        commitSha: sha("a"),
        path: "fix.ts",
      },
      {
        id: "native_followup",
        sourceId: accepted.sourceId,
        commitSha: sha("b"),
        path: "fix.ts",
      },
    ],
  };
}

test("reviewed unit validates native carrier context before building its original proof", async () => {
  const input = await nativeUnitContextSnapshot();
  const result = await octoberOriginalContributorUnitProof(
    input.github,
    input.acceptedSource,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(result.originalContributor?.claimIds).toEqual(
    input.claims.map((claim) => claim.id),
  );
  expect(result.sources.every((source) => source.complete)).toBe(true);
  expect(input.original.limitations).toEqual([NATIVE_MERGE_CONTEXT]);
});

test("reviewed unit keeps an invalid native carrier context held", async () => {
  const input = await nativeUnitContextSnapshot();
  input.accepted.pull.head.sha = sha("9");
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.acceptedSource,
      input.sources[1],
      input.sources[0],
      input.owners,
      input.claims,
    ),
  ).rejects.toThrow();
});

test("native unit collector preserves a maintainer PR creator and binds the sole primary initiator", async () => {
  const input = await snapshot();
  input.original.pull.user = carrier;
  const current = input.responses.get(`${root}/pulls/1`);
  if (!current || typeof current !== "object") throw Error("fixture");
  input.responses.set(`${root}/pulls/1`, { ...current, user: carrier });
  const claims = [sha("a"), sha("b")].map((commitSha, index) => ({
    id: `primary_claim_${index}`,
    sourceId: input.plain.sourceId,
    commitSha,
    path: "fix.ts",
  }));
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.originalContributor?.originatingActor?.id).toBe(origin.node_id);
  expect(
    proof.sources.find((source) => source.sourceId === "PR_original")?.author
      ?.id,
  ).toBe(carrier.node_id);
  expect(input.original.pull.user).toEqual(carrier);
  expect(proof.originalContributor?.claimIds).toEqual(
    claims.map((claim) => claim.id),
  );
});

test("a changed-creator historical revision remains held without complete retained identity", async () => {
  const input = await reviewedRevisionSnapshot();
  input.original.pull.user = carrier;
  const current = input.responses.get(`${root}/pulls/1`);
  if (!current || typeof current !== "object") throw Error("fixture");
  input.responses.set(`${root}/pulls/1`, { ...current, user: carrier });
  await expect(
    octoberOriginalContributorUnitProof(
      input.github,
      input.plain,
      input.sources[1],
      input.sources[0],
      input.owners,
      input.claims,
    ),
  ).rejects.toThrow("Retained-copy evidence");
});

async function historicalBodyRepairSnapshot() {
  const input = await bodyRepairSnapshot();
  input.body.lastEditedAt = "2026-10-03T00:30:00Z";
  const edit = {
    id: "UCE_before_merge",
    createdAt: "2026-10-02T20:00:00Z",
    editedAt: "2026-10-02T20:00:00Z",
    updatedAt: "2026-10-02T20:00:00Z",
    deletedAt: null as string | null,
    diff: input.body.body,
    editor: { id: carrier.node_id, __typename: "User" },
  };
  const current = {
    ...clone(edit),
    id: "UCE_after_merge",
    createdAt: input.body.lastEditedAt,
    editedAt: input.body.lastEditedAt,
    updatedAt: input.body.lastEditedAt,
  };
  const history = {
    totalCount: 2,
    nodes: [current, edit],
    pageInfo: { hasNextPage: false },
  };
  const head = {
    ...clone(input.accepted.commits[1]),
    committer: { date: "2026-10-02T19:00:00Z" },
  };
  input.responses.set(`${root}/git/commits/${sha("b")}`, head);
  const github = {
    ...input.github,
    async graphql<T>(query: string): Promise<T> {
      return {
        repository: {
          id: input.accepted.repositoryNodeId,
          pullRequest: {
            ...clone(input.body),
            ...(query.includes("SlopHistoricalRepairBody")
              ? { userContentEdits: clone(history) }
              : {}),
          },
        },
      } as T;
    },
  };
  return { ...input, github, edit, current, history, head };
}

test("an authenticated pre-merge body edit survives a later current-body edit", async () => {
  const input = await historicalBodyRepairSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  const reference = proof.originalContributor?.repairs?.[0].reference;
  expect(reference?.historicalBodyEdit?.id).toBe(input.edit.id);
  expect(reference?.bodyEdit?.lastEditedAt).toBe(input.body.lastEditedAt);
  expect(reference?.pull.body).toBe(input.accepted.pull.body);
});

for (const fault of [
  "actor",
  "post-merge",
  "head",
  "changed-current",
  "deleted",
  "changed-edit",
  "missing-page",
  "future-head",
] as const) {
  test(`historical body repair refuses ${fault}`, async () => {
    const input = await historicalBodyRepairSnapshot();
    if (fault === "actor") input.edit.editor.id = origin.node_id;
    if (fault === "post-merge")
      input.edit.createdAt =
        input.edit.editedAt =
        input.edit.updatedAt =
          "2026-10-04T00:00:00Z";
    if (fault === "head") input.edit.diff = `Incorporates #1 at ${sha("9")}`;
    if (fault === "changed-current")
      input.current.diff = "Different current body";
    if (fault === "deleted") input.edit.deletedAt = input.edit.editedAt;
    if (fault === "changed-edit") input.edit.updatedAt = "2026-10-02T21:00:00Z";
    if (fault === "missing-page") input.history.pageInfo.hasNextPage = true;
    if (fault === "future-head")
      input.head.committer.date = "2026-10-03T00:10:00Z";
    await expect(
      octoberOriginalContributorUnitProof(
        input.github,
        input.plain,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}

test("native collector uses the existing creator fallback for an excluded agent primary", async () => {
  const input = await snapshot();
  const agent = { node_id: "U_kgDOC972lw", login: "cursoragent", type: "User" };
  input.original.commits[0].author = agent;
  input.accepted.commits[0].author = agent;
  input.plain.commits[0].author = {
    id: agent.node_id,
    login: agent.login,
    kind: "User",
  };
  input.original.commitAttribution[0].actorNodeIds = [agent.node_id];
  input.accepted.commitAttribution[0].actorNodeIds = [agent.node_id];
  input.responses.set(
    `${root}/git/commits/${sha("a")}`,
    clone(input.accepted.commits[0]),
  );
  const claims = [
    {
      id: "claim_agent",
      sourceId: input.plain.sourceId,
      commitSha: sha("a"),
      path: "fix.ts",
    },
  ];
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    claims,
  );
  expect(proof.sources[1].author?.id).toBe(origin.node_id);
  expect(proof.sources[1].commits[0].author?.id).toBe(agent.node_id);
});

async function pairedRepairSnapshot() {
  const input = await snapshot();
  input.accepted.commits[1].author = null as never;
  input.plain.commits[1].author = null;
  input.accepted.commitAttribution[1].actorNodeIds = [];
  input.original.comments = [
    {
      node_id: "IC_original_pair",
      html_url: `${input.original.pull.html_url}#issuecomment-10`,
      body: "Finished the original implementation in integration PR #2.",
      user: carrier,
      created_at: "2026-10-02T12:00:00Z",
      updated_at: "2026-10-02T12:00:00Z",
    },
  ];
  input.accepted.comments = [
    {
      node_id: "IC_accepted_pair",
      html_url: `${input.accepted.pull.html_url}#issuecomment-11`,
      body: `Final source review: ${sha("b")}. Merging this reviewed head.`,
      user: carrier,
      created_at: "2026-10-02T13:00:00Z",
      updated_at: "2026-10-02T13:00:00Z",
    },
  ];
  for (const [id, comment] of [
    [10, input.original.comments[0]],
    [11, input.accepted.comments[0]],
  ] as const)
    input.responses.set(`${root}/issues/comments/${id}`, clone(comment));
  input.responses.set(
    `${root}/git/commits/${sha("b")}`,
    clone(input.accepted.commits[1]),
  );
  const range = input.responses.get(
    `${root}/compare/${sha("f")}...${sha("c")}?per_page=100&page=1`,
  ) as { commits: unknown[] };
  range.commits[1] = clone(input.accepted.commits[1]);
  const claims = ["a", "b"].map((id) => ({
    id: `paired_${id}`,
    sourceId: input.plain.sourceId,
    commitSha: sha(id),
    path: "fix.ts",
  }));
  return { ...input, claims };
}

test("paired accepting-merger comments bind a null-author native repair without assigning an identity", async () => {
  const input = await pairedRepairSnapshot();
  const proof = await octoberOriginalContributorUnitProof(
    input.github,
    input.plain,
    input.sources[1],
    input.sources[0],
    input.owners,
    input.claims,
  );
  expect(proof.originalContributor?.repairs?.[0].authorNodeId).toBeNull();
  expect(
    proof.originalContributor?.repairs?.[0].reference.originalAcknowledgement
      ?.comment.node_id,
  ).toBe("IC_original_pair");
  expect(proof.sources[0].commits[1].author).toBeNull();
  expect(input.readPaths).toContain(`${root}/issues/comments/10`);
  expect(input.readPaths).toContain(`${root}/issues/comments/11`);
});

for (const fault of [
  "original-actor",
  "accepting-actor",
  "original-pr",
  "original-edited",
  "accepting-edited",
  "ordering",
  "late",
  "head",
  "original-ref",
  "current-comment",
  "unrelated-branch",
  "original-before-created",
  "accepted-before-created",
  "negative-original-number",
] as const) {
  test(`paired null-author repair refuses ${fault}`, async () => {
    const input = await pairedRepairSnapshot();
    const first = input.original.comments[0];
    const last = input.accepted.comments[0];
    if (fault === "original-actor") first.user = origin;
    if (fault === "accepting-actor") last.user = origin;
    if (fault === "original-pr")
      first.html_url = `https://github.com/${repository}/pull/9#issuecomment-10`;
    if (fault === "original-edited") first.updated_at = "2026-10-02T12:30:00Z";
    if (fault === "accepting-edited") last.updated_at = "2026-10-02T14:00:00Z";
    if (fault === "ordering")
      first.created_at = first.updated_at = "2026-10-02T14:00:00Z";
    if (fault === "late")
      last.created_at = last.updated_at = "2026-10-04T00:00:00Z";
    if (fault === "head") last.body = `Final source ${sha("9")}`;
    if (fault === "original-ref") first.body = "Finishing #99";
    if (fault === "current-comment")
      (
        input.responses.get(`${root}/issues/comments/10`) as { body: string }
      ).body = "Edited since capture";
    if (fault === "original-before-created")
      (
        input.responses.get(`${root}/pulls/1`) as { created_at: string }
      ).created_at = "2026-10-02T12:01:00Z";
    if (fault === "accepted-before-created")
      (
        input.responses.get(`${root}/pulls/2`) as { created_at: string }
      ).created_at = "2026-10-02T13:01:00Z";
    if (fault === "negative-original-number") input.original.pull.number = -1;
    if (fault === "unrelated-branch") {
      input.accepted.commits[1].parents = [{ sha: sha("9") }];
      input.responses.set(
        `${root}/git/commits/${sha("b")}`,
        clone(input.accepted.commits[1]),
      );
    }
    await expect(
      octoberOriginalContributorUnitProof(
        input.github,
        input.plain,
        input.sources[1],
        input.sources[0],
        input.owners,
        input.claims,
      ),
    ).rejects.toThrow();
  });
}
