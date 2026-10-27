import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { collectValueEvidence } from "./value-evidence";
import { loadValuePolicy, verifyCurrentValueSource } from "./value-publication";
import { valueSourceDigest } from "./value-review";
import { prepareWorkUnitEvidence } from "./value-work-unit";
import { verifyCurrentWorkUnitSource } from "./value-work-unit-publication";

function publicationFixture() {
  const original = fixture({ textOnly: true });
  const base = original.pull.base.sha;
  const accepted = original.pull.merge_commit_sha;
  const promotionBase = "d".repeat(40);
  const promotionMerge = "e".repeat(40);
  const content = new Map([
    ["fix.ts", new TextEncoder().encode("export const fixed = true;\n")],
  ]);
  original.bind(promotionBase, content, [base]);
  original.bind(promotionMerge, content, [promotionBase, accepted]);
  const promotion = {
    ...structuredClone(original.pull),
    node_id: "PR_promotion",
    number: 2,
    html_url: `https://github.com/${repository.id}/pull/2`,
    title: "Promote the already accepted tree",
    user: { node_id: "U_promoter", login: "promoter", type: "User" },
    merged_at: "2026-10-16T18:00:00Z",
    closed_at: "2026-10-16T18:00:00Z",
    updated_at: "2026-10-16T18:00:00Z",
    merge_commit_sha: promotionMerge,
    base: { sha: promotionBase, ref: "staging" },
    head: { sha: accepted },
    changed_files: 0,
  };
  const root = `/repos/${repository.id}`;
  const client = {
    async get<T>(path: string): Promise<T | null> {
      if (path === `${root}/pulls/2`) return structuredClone(promotion) as T;
      if (path === `${root}/pulls/2/commits?per_page=100&page=1`) {
        const commits = await original.client.get<
          { sha: string; html_url: string }[]
        >(`${root}/pulls/1/commits?per_page=100&page=1`);
        return commits?.map((commit) => ({
          ...commit,
          sha: accepted,
          html_url: `https://github.com/${repository.id}/commit/${accepted}`,
        })) as T;
      }
      if (
        [
          `${root}/pulls/2/files?per_page=100&page=1`,
          `${root}/pulls/2/reviews?per_page=100&page=1`,
          `${root}/pulls/2/comments?per_page=100&page=1`,
          `${root}/issues/2/comments?per_page=100&page=1`,
        ].includes(path)
      )
        return [] as T;
      if (path === `${root}/compare/${promotionBase}...${accepted}`)
        return { merge_base_commit: { sha: base } } as T;
      if (path.startsWith(`${root}/commits/${promotionMerge}?`))
        return {
          sha: promotionMerge,
          html_url: `https://github.com/${repository.id}/commit/${promotionMerge}`,
          parents: [{ sha: promotionBase }, { sha: accepted }],
          stats: { additions: 0, deletions: 0, total: 0 },
          files: [],
        } as T;
      return original.client.get<T>(path);
    },
    async graphql<T>(_query: string, variables: Record<string, unknown>) {
      return {
        repository: {
          pullRequest: {
            id:
              variables.number === 2
                ? promotion.node_id
                : original.pull.node_id,
            timelineItems: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    fileText: original.client.fileText,
  };
  const sources = async () =>
    Promise.all(
      [1, 2].map(async (number) => {
        const evidence = await collectValueEvidence(
          client,
          repository.id,
          number,
          repository,
        );
        return {
          evidence,
          policy: await loadValuePolicy(
            client,
            repository.owner,
            repository.name,
            evidence.pull.base.sha,
          ),
        };
      }),
    );
  return { original, promotion, client, sources, promotionMerge };
}

test("the normal joint verifier re-collects an unchanged promotion and its original", async () => {
  const f = publicationFixture();
  const sources = await f.sources();
  const prepared = await prepareWorkUnitEvidence(sources, [repository]);
  expect(prepared.limitations).toEqual([]);
  expect(prepared.claims).toHaveLength(1);
  const verified = await verifyCurrentWorkUnitSource(
    f.client,
    prepared,
    { sourceDigest: prepared.sourceDigest },
    [repository],
  );
  expect(verified.sourceDigest).toBe(prepared.sourceDigest);
  expect(verified.claims).toEqual(prepared.claims);
});

test("standalone source verification still refuses the deferred promotion", async () => {
  const f = publicationFixture();
  const source = (await f.sources())[1];
  await expect(
    verifyCurrentValueSource(
      f.client,
      source.evidence,
      {
        policySha: source.policy.sha,
        sourceDigest: await valueSourceDigest(source.evidence, source.policy),
      },
      [repository],
    ),
  ).rejects.toThrow("complete closed-pull-request evidence");
});

test("joint verification refuses an omitted original source", async () => {
  const f = publicationFixture();
  const sources = await f.sources();
  const prepared = await prepareWorkUnitEvidence([sources[1]], [repository]);
  expect(prepared.limitations.length).toBeGreaterThan(0);
  await expect(
    verifyCurrentWorkUnitSource(
      f.client,
      prepared,
      { sourceDigest: prepared.sourceDigest },
      [repository],
    ),
  ).rejects.toThrow("supplied source group");
});

test("joint verification refuses a changed original after preparation", async () => {
  const f = publicationFixture();
  const prepared = await prepareWorkUnitEvidence(await f.sources(), [
    repository,
  ]);
  f.original.pull.title = "Changed original source";
  await expect(
    verifyCurrentWorkUnitSource(
      f.client,
      prepared,
      { sourceDigest: prepared.sourceDigest },
      [repository],
    ),
  ).rejects.toThrow("Value source changed after assessment");
});

test("joint verification refuses a no-longer-matching promotion tree", async () => {
  const f = publicationFixture();
  const prepared = await prepareWorkUnitEvidence(await f.sources(), [
    repository,
  ]);
  f.original.bind(
    f.promotionMerge,
    new Map([["fix.ts", new TextEncoder().encode("changed source\n")]]),
    [f.promotion.base.sha, f.promotion.head.sha],
  );
  await expect(
    verifyCurrentWorkUnitSource(
      f.client,
      prepared,
      { sourceDigest: prepared.sourceDigest },
      [repository],
    ),
  ).rejects.toThrow("complete closed-pull-request evidence");
});

test("joint verification retains unrelated recollection limitations", async () => {
  const f = publicationFixture();
  const prepared = await prepareWorkUnitEvidence(await f.sources(), [
    repository,
  ]);
  f.promotion.comments = 1;
  await expect(
    verifyCurrentWorkUnitSource(
      f.client,
      prepared,
      { sourceDigest: prepared.sourceDigest },
      [repository],
    ),
  ).rejects.toThrow("complete closed-pull-request evidence");
});
