import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { TargetRepository } from "../../src/lib/repositories.mjs";
import type { ValueEvidence } from "./value-evidence";
import {
  collectNoChangePromotion,
  NO_CHANGE_PROMOTION_CONTEXT,
} from "./value-no-change-promotion";
import { retainedCopyBindings } from "./value-retained-copy";
import { validateEvidenceAssessment } from "./value-review";
import {
  prepareWorkUnitEvidence,
  type WorkUnitSource,
} from "./value-work-unit";

// Synthetic Git evidence exercises grouping only; no model output is supplied.
const base = "0".repeat(40);
const implemented = "1".repeat(40);
const accepted = "2".repeat(40);
const integrated = "3".repeat(40);
const repository: TargetRepository = {
  id: "example/promotion",
  owner: "example",
  name: "promotion",
  aliases: [],
  expectedNodeId: "R_promotion",
  displayName: "Promotion regression",
  githubUrl: "https://github.com/example/promotion",
  description: "Already accepted promotion",
  integrationBranch: "main",
  projectId: "fixture",
  role: "primary",
};
const actor = { node_id: "U_author", login: "author", type: "User" };
const file = {
  filename: "fix.ts",
  status: "added",
  additions: 1,
  deletions: 0,
  patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
  blob_url: `https://github.com/${repository.id}/blob/${implemented}/fix.ts`,
};
function commit(sha: string): ValueEvidence["commits"][number] {
  return {
    sha,
    html_url: `https://github.com/${repository.id}/commit/${sha}`,
    author: actor,
    committer: actor,
    parents: [{ sha: base }],
    commit: {
      message: "Repair the accepted path",
      author: { date: "2026-10-01T09:00:00Z" },
      committer: { date: "2026-10-01T09:00:00Z" },
    },
  };
}
function fixture() {
  const original: WorkUnitSource = structuredClone({
    policy: { sha: base, text: "CONTRIBUTING.md\nScore accepted work once." },
    evidence: {
      repository: repository.id,
      repositoryPolicy: {
        id: repository.id,
        projectId: repository.projectId,
        integrationBranch: repository.integrationBranch,
        expectedNodeId: repository.expectedNodeId,
      },
      repositoryNodeId: "R_promotion",
      repositoryDatabaseId: 42,
      collectedAt: "2026-10-04T00:00:00Z",
      pull: {
        node_id: "PR_original",
        number: 1,
        html_url: `https://github.com/${repository.id}/pull/1`,
        title: "Repair the accepted path",
        body: null,
        user: actor,
        merged_by: actor,
        state: "closed",
        merged_at: "2026-10-01T10:00:00Z",
        closed_at: "2026-10-01T10:00:00Z",
        merge_commit_sha: accepted,
        updated_at: "2026-10-01T10:00:00Z",
        head: { sha: implemented },
        base: { sha: base, ref: "main" },
        changed_files: 1,
        comments: 0,
        review_comments: 0,
        commits: 1,
      },
      files: [file],
      mergeCommitEvidence: {
        sha: accepted,
        html_url: `https://github.com/${repository.id}/commit/${accepted}`,
        parents: [{ sha: base }],
        stats: { additions: 1, deletions: 0, total: 1 },
        files: [file],
      },
      commits: [commit(implemented)],
      reviews: [],
      comments: [],
      reviewComments: [],
      limitations: [],
      evidenceUrls: [`https://github.com/${repository.id}/pull/1`],
      eligibleReviewIds: [],
      implementationActorNodeIds: [actor.node_id],
      commitAttribution: [
        {
          sha: implemented,
          actorNodeIds: [actor.node_id],
          changedPaths: [file.filename],
          files: [file],
          limitations: [],
        },
      ],
      relatedPullRequests: [],
    },
  });
  const promotion = structuredClone(original);
  Object.assign(promotion.evidence.pull, {
    node_id: "PR_closed_promotion",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    merged_by: null,
    merged_at: null,
    merge_commit_sha: null,
    closed_at: "2026-10-02T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
    head: { sha: accepted },
  });
  promotion.evidence.mergeCommitEvidence = null;
  promotion.evidence.commits = [commit(accepted)];
  promotion.evidence.commitAttribution[0].sha = accepted;
  promotion.evidence.relatedPullRequests = [
    {
      id: "PR_integration",
      number: 3,
      url: `https://github.com/${repository.id}/pull/3`,
      repository: repository.id,
    },
  ];
  const integration = structuredClone(promotion);
  const extra = commit("4".repeat(40));
  extra.parents = [{ sha: accepted }];
  const extraFile = { ...file, filename: "later.ts" };
  Object.assign(integration.evidence.pull, {
    node_id: "PR_integration",
    number: 3,
    html_url: `https://github.com/${repository.id}/pull/3`,
    merged_by: actor,
    merged_at: "2026-10-03T10:00:00Z",
    closed_at: "2026-10-03T10:00:00Z",
    updated_at: "2026-10-03T10:00:00Z",
    merge_commit_sha: integrated,
    head: { sha: extra.sha },
    changed_files: 2,
    commits: 2,
  });
  integration.evidence.files.push(extraFile);
  integration.evidence.commits.push(extra);
  integration.evidence.commitAttribution.push({
    sha: extra.sha,
    actorNodeIds: [actor.node_id],
    changedPaths: [extraFile.filename],
    files: [extraFile],
    limitations: [],
  });
  const originalMerge = original.evidence.mergeCommitEvidence;
  if (!originalMerge) throw new Error("Missing accepted fixture commit");
  integration.evidence.mergeCommitEvidence = {
    ...structuredClone(originalMerge),
    sha: integrated,
    parents: [{ sha: base }, { sha: extra.sha }],
    files: [file, extraFile],
    stats: { additions: 2, deletions: 0, total: 2 },
  };
  integration.evidence.relatedPullRequests = [];
  return { original, promotion, integration };
}

function unchangedPromotion() {
  const { original, promotion } = fixture();
  const promotedBase = "5".repeat(40);
  promotion.policy.sha = promotedBase;
  Object.assign(promotion.evidence.pull, {
    base: { sha: promotedBase, ref: "staging" },
    merged_at: "2026-10-02T10:00:00Z",
    merge_commit_sha: integrated,
    user: { node_id: "U_promoter", login: "promoter", type: "User" },
  });
  promotion.evidence.mergeCommitEvidence = {
    sha: integrated,
    html_url: `https://github.com/${repository.id}/commit/${integrated}`,
    parents: [{ sha: promotedBase }, { sha: accepted }],
    stats: { additions: 0, deletions: 0, total: 0 },
    files: [],
  };
  promotion.evidence.limitations = [NO_CHANGE_PROMOTION_CONTEXT];
  promotion.evidence.implementationActorNodeIds = ["U_promoter"];
  const blob = createHash("sha1").update("blob 1\0x").digest("hex");
  const bytes = Buffer.concat([
    Buffer.from("100644 fix.ts\0"),
    Buffer.from(blob, "hex"),
  ]);
  const treeSha = createHash("sha1")
    .update(`tree ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  const responses = new Map<string, unknown>(
    [promotedBase, accepted, integrated].map((sha) => [
      `/repos/${repository.id}/git/commits/${sha}`,
      { sha, tree: { sha: treeSha } },
    ]),
  );
  responses.set(`/repos/${repository.id}/git/trees/${treeSha}`, {
    sha: treeSha,
    truncated: false,
    tree: [{ path: "fix.ts", mode: "100644", type: "blob", sha: blob }],
  });
  const client = {
    async get<T>(path: string): Promise<T | null> {
      return (responses.get(path) as T | undefined) ?? null;
    },
  };
  return { original, promotion, client, responses, treeSha };
}

test("an unchanged branch promotion preserves original credit only after complete joint source verification", async () => {
  const f = unchangedPromotion();
  const proof = await collectNoChangePromotion(
    f.client,
    repository.id,
    f.promotion.evidence,
  );
  expect(proof).not.toBeNull();
  if (!proof) throw new Error("Missing promotion proof");
  f.promotion.evidence.noChangePromotion = proof;
  const standalone = {
    status: "assessed",
    tier: "small",
    rationale: "The original repair is accepted.",
    dimensions: Object.fromEntries(
      [
        "alignment",
        "impact",
        "complexity",
        "verification",
        "maintenance",
        "overlap",
      ].map((name) => [
        name,
        "The complete original source supports this repair.",
      ]),
    ),
    evidenceUrls: f.original.evidence.evidenceUrls,
    relatedPullRequests: [],
    limitations: [],
    reviews: [],
  };
  expect(
    validateEvidenceAssessment(standalone, f.original.evidence),
  ).not.toBeNull();
  expect(
    validateEvidenceAssessment(standalone, f.promotion.evidence),
  ).toBeNull();
  const alone = await prepareWorkUnitEvidence([f.promotion], [repository]);
  expect(alone.limitations.join("\n")).toContain(
    "unchanged promotion needs one complete original PR",
  );
  const joint = await prepareWorkUnitEvidence(
    [f.promotion, f.original],
    [repository],
  );
  expect(joint.limitations).toEqual([]);
  expect(joint.claims).toHaveLength(1);
  expect(joint.claims[0]).toMatchObject({
    commitSha: implemented,
    creditPullRequestId: "PR_original",
    implementationActorNodeIds: [actor.node_id],
  });
  expect(joint.claims[0].carrierPullRequestIds).not.toContain(
    "PR_closed_promotion",
  );
  expect(f.promotion.evidence.limitations).toEqual([
    NO_CHANGE_PROMOTION_CONTEXT,
  ]);
});

for (const change of [
  "changed-tree",
  "truncated-tree",
  "corrupt-tree",
] as const) {
  test(`an empty reported merge cannot prove an unchanged promotion with ${change}`, async () => {
    const f = unchangedPromotion();
    if (change === "changed-tree")
      f.responses.set(`/repos/${repository.id}/git/commits/${accepted}`, {
        sha: accepted,
        tree: { sha: "a".repeat(40) },
      });
    else {
      const path = `/repos/${repository.id}/git/trees/${f.treeSha}`;
      const tree = f.responses.get(path) as {
        truncated: boolean;
        tree: { sha: string }[];
      };
      if (change === "truncated-tree") tree.truncated = true;
      else tree.tree[0].sha = "a".repeat(40);
    }
    expect(
      await collectNoChangePromotion(
        f.client,
        repository.id,
        f.promotion.evidence,
      ),
    ).toBeNull();
  });
}

test("a promotion cannot use an incomplete or later original, or apply its proof to changed accepted files", async () => {
  for (const change of ["incomplete", "later", "changed"] as const) {
    const f = unchangedPromotion();
    const proof = await collectNoChangePromotion(
      f.client,
      repository.id,
      f.promotion.evidence,
    );
    if (!proof) throw new Error("Missing promotion proof");
    f.promotion.evidence.noChangePromotion = proof;
    if (change === "incomplete")
      f.original.evidence.limitations.push("Missing source");
    if (change === "later")
      f.original.evidence.pull.merged_at = "2026-10-03T10:00:00Z";
    if (change === "changed") {
      const merge = f.promotion.evidence.mergeCommitEvidence;
      if (!merge) throw new Error("Missing accepted merge");
      merge.files.push(file);
    }
    const result = await prepareWorkUnitEvidence(
      [f.promotion, f.original],
      [repository],
    );
    expect(result.limitations.length).toBeGreaterThan(0);
  }
});

test("a closed promotion of previously accepted same-author commits adds no attribution hold or credit", async () => {
  const { original, promotion, integration } = fixture();
  const before = structuredClone([original, promotion, integration]);
  const result = await prepareWorkUnitEvidence(before, [repository]);
  expect(result.limitations).toEqual([]);
  expect(result.claims).toHaveLength(2);
  expect(
    result.claims.find((claim) => claim.path === file.filename),
  ).toMatchObject({
    commitSha: implemented,
    creditPullRequestId: "PR_original",
    implementationActorNodeIds: [actor.node_id],
  });
  expect(
    result.claims.map((claim) => claim.creditPullRequestId).sort(),
  ).toEqual(["PR_integration", "PR_original"]);
  for (const claim of result.claims)
    expect(claim.carrierPullRequestIds).not.toContain("PR_closed_promotion");
  expect(before).toEqual([original, promotion, integration]);
});

test("an existing authenticated retention acknowledgement keeps its binding", async () => {
  const { original, promotion, integration } = fixture();
  promotion.evidence.comments = [
    {
      node_id: "IC_retained",
      html_url: `https://github.com/${repository.id}/pull/2#issuecomment-1`,
      body: `Merged in ${integrated}.`,
      user: actor,
      created_at: "2026-10-04T10:00:00Z",
      updated_at: "2026-10-04T10:00:00Z",
    },
  ];
  promotion.evidence.pull.comments = 1;
  const result = await retainedCopyBindings([original, promotion, integration]);
  expect(result.limitations).toEqual([]);
  expect([...result.bindings.values()]).toMatchObject([
    {
      originalCommitSha: accepted,
      acceptedCommitSha: accepted,
      path: file.filename,
      original: { evidence: { pull: { node_id: "PR_closed_promotion" } } },
    },
  ]);
});

for (const change of [
  "no-prior-acceptance",
  "different-author",
  "different-repository",
  "late-acceptance",
  "incomplete-acceptance",
  "changed-accepted-edit",
  "unaccepted-extra-commit",
] as const) {
  test(`retained-copy acknowledgement is still required with ${change}`, async () => {
    const { original, promotion, integration } = fixture();
    const sources = [original, promotion, integration];
    if (change === "no-prior-acceptance") sources.shift();
    if (change === "different-author")
      original.evidence.pull.user.node_id = "U_other_author";
    if (change === "different-repository")
      original.evidence.repositoryNodeId = "R_other";
    if (change === "late-acceptance")
      original.evidence.pull.merged_at = "2026-10-04T10:00:00Z";
    if (change === "incomplete-acceptance")
      original.evidence.limitations.push("Accepted source is incomplete");
    if (change === "changed-accepted-edit") {
      const merge = original.evidence.mergeCommitEvidence;
      if (!merge) throw new Error("Missing accepted fixture commit");
      merge.files[0].patch = "@@ -0,0 +1 @@\n+export const different = true;";
    }
    if (change === "unaccepted-extra-commit") {
      const extra = commit("4".repeat(40));
      promotion.evidence.commits.push(extra);
      promotion.evidence.pull.head.sha = extra.sha;
      promotion.evidence.commitAttribution.push({
        ...structuredClone(promotion.evidence.commitAttribution[0]),
        sha: extra.sha,
      });
    }
    const result = await retainedCopyBindings(sources);
    expect(result.limitations).toContain(
      "PR_closed_promotion: matching copied edits require authenticated retention acknowledgement",
    );
  });
}
