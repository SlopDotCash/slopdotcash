import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { TargetRepository } from "../../src/lib/repositories.mjs";
import type { ValueEvidence } from "./value-evidence";
import { collectValueGroup } from "./value-group-collection";
import {
  collectNoChangePromotion,
  NO_CHANGE_PROMOTION_CONTEXT,
} from "./value-no-change-promotion";
import type { WorkUnitSource } from "./value-work-unit";

// Synthetic Git evidence exercises group collection only; no model output
// is supplied. The fixture mirrors accepted-promotion.test.ts: PR #1 is the
// accepted original and PR #2 is its proven unchanged branch promotion,
// whose evidence carries only the joint deferral limitation that
// collectValueEvidence records for it.
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
function makeOriginal(): WorkUnitSource {
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

async function provenPromotion() {
  const promotion = structuredClone(makeOriginal());
  const promotedBase = "5".repeat(40);
  promotion.policy.sha = promotedBase;
  Object.assign(promotion.evidence.pull, {
    node_id: "PR_promotion",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    base: { sha: promotedBase, ref: "staging" },
    head: { sha: accepted },
    merged_at: "2026-10-02T10:00:00Z",
    closed_at: "2026-10-02T10:00:00Z",
    updated_at: "2026-10-02T10:00:00Z",
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
  promotion.evidence.commits = [commit(accepted)];
  promotion.evidence.commitAttribution[0].sha = accepted;
  // Exactly what collectValueEvidence sets when the proof exists.
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
      if (path === `/repos/${repository.id}`)
        return { id: 42, node_id: "R_promotion", private: false } as T;
      return (responses.get(path) as T | undefined) ?? null;
    },
  };
  const proof = await collectNoChangePromotion(
    client,
    repository.id,
    promotion.evidence,
  );
  if (!proof) throw new Error("Missing promotion proof");
  promotion.evidence.noChangePromotion = proof;
  return { promotion, client };
}

const fakeDb = {
  prepare: () => ({
    bind: () => ({ first: async () => null }),
  }),
};

async function collectGroup(seed: WorkUnitSource, client: unknown) {
  return collectValueGroup(
    fakeDb as never,
    client as never,
    seed,
    async () => true,
    Date.parse("2026-09-01T00:00:00Z"),
    [repository],
  );
}

test("group collection retains a proven no-change promotion seed", async () => {
  const { promotion, client } = await provenPromotion();
  const group = await collectGroup(promotion, client);
  expect(group).not.toBeNull();
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_promotion",
  ]);
});

test("group collection still refuses a promotion with another limitation", async () => {
  const { promotion, client } = await provenPromotion();
  promotion.evidence.limitations.push("Missing source evidence");
  expect(await collectGroup(promotion, client)).toBeNull();
});

test("group collection still refuses a promotion whose proof does not match", async () => {
  const { promotion, client } = await provenPromotion();
  const proof = promotion.evidence.noChangePromotion;
  if (!proof) throw new Error("Missing promotion proof");
  promotion.evidence.noChangePromotion = { ...proof, mergeSha: "9".repeat(40) };
  expect(await collectGroup(promotion, client)).toBeNull();
});

test("group collection still refuses an ordinary source with a limitation", async () => {
  const original = makeOriginal();
  original.evidence.limitations = ["Missing source evidence"];
  const { client } = await provenPromotion();
  expect(await collectGroup(original, client)).toBeNull();
});
