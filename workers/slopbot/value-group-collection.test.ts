import { expect, test } from "bun:test";
import {
  accepted,
  commit,
  integrated,
  makeOriginal,
  repository,
  unchangedPromotionTree,
} from "../../tests/value-promotion-fixture";
import { collectValueGroup } from "./value-group-collection";
import {
  collectNoChangePromotion,
  NO_CHANGE_PROMOTION_CONTEXT,
} from "./value-no-change-promotion";
import type { WorkUnitSource } from "./value-work-unit-types";

// Synthetic Git evidence exercises group collection only; no model output
// is supplied. PR #1 is the accepted original and PR #2 is its proven
// unchanged branch promotion, whose evidence carries only the joint deferral
// limitation that collectValueEvidence records for it.

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

  const { responses } = unchangedPromotionTree(promotedBase);
  const client = {
    async graphql<T>(): Promise<T> {
      return {
        search: {
          issueCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            {
              id: promotion.evidence.pull.node_id,
              number: promotion.evidence.pull.number,
              url: promotion.evidence.pull.html_url,
              mergedAt: promotion.evidence.pull.merged_at,
              repository: {
                id: "R_promotion",
                databaseId: 42,
                nameWithOwner: repository.id,
                isPrivate: false,
              },
              mergeCommit: { oid: integrated },
              commits: {
                totalCount: 1,
                nodes: [{ commit: { oid: accepted } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          ],
        },
      } as T;
    },
    async get<T>(path: string): Promise<T | null> {
      if (path === `/repos/${repository.id}`)
        return { id: 42, node_id: "R_promotion", private: false } as T;
      if (/\/commits\/[a-f0-9]{40}\/pulls\?/.test(path)) return [] as T;
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
