import { expect, test } from "bun:test";
import type { TargetRepository } from "../../src/lib/repositories.mjs";
import type { ValueEvidence } from "./value-evidence";
import { retainedCopyBindings } from "./value-retained-copy";
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
