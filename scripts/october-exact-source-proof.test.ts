import { describe, expect, test } from "bun:test";
import type { CorrectionSource } from "../src/lib/points-implementation-corrections";
import { collect, fixture } from "../tests/value-binary-fixture";
import type { GitHubClient } from "../workers/slopbot/github";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";
import {
  firstAcceptedCorrectionClaims,
  groupedOriginalContributorProof,
  isMergedOriginalContributor,
  octoberOriginalContributorProof,
  originalContributorFollowupProof,
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
  const current = clone(evidence.pull);
  const github = { get: async <T>(): Promise<T> => current as T };
  const result = await originalContributorFollowupProof(
    github,
    accepted,
    source,
    evidence,
    input.sources[0].policy,
  );
  expect(result.reference?.target.id).toBe(accepted.sourceId);
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
