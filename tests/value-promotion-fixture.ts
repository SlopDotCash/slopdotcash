import { createHash } from "node:crypto";
import type { TargetRepository } from "../src/lib/repositories.mjs";
import type { ValueEvidence } from "../workers/slopbot/value-evidence-types";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit-types";

// Synthetic Git evidence shared by the Slopbot promotion tests: PR #1 is the
// accepted original of a one-file fix. No model output is supplied.
export const base = "0".repeat(40);
export const implemented = "1".repeat(40);
export const accepted = "2".repeat(40);
export const integrated = "3".repeat(40);
export const repository: TargetRepository = {
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
export const actor = { node_id: "U_author", login: "author", type: "User" };
export const file = {
  filename: "fix.ts",
  status: "added",
  additions: 1,
  deletions: 0,
  patch: "@@ -0,0 +1 @@\n+export const fixed = true;",
  blob_url: `https://github.com/${repository.id}/blob/${implemented}/fix.ts`,
};
export function commit(sha: string): ValueEvidence["commits"][number] {
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
export function makeOriginal(): WorkUnitSource {
  return structuredClone({
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
  }) as WorkUnitSource;
}

// The unchanged-tree Git responses that prove a no-change promotion of the
// accepted fix.ts blob onto promotedBase.
export function unchangedPromotionTree(promotedBase: string) {
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
  return { blob, treeSha, responses };
}
