import { expect, test } from "bun:test";
import {
  collect,
  fixture,
  policy,
  repository,
} from "../../tests/value-binary-fixture";
import { collectValueGroup } from "./value-group-collection";

const db = {
  prepare: () => ({ bind: () => ({ first: async () => null }) }),
};

/** The seed merges exactly at 18:00 and names PR #2 only through a timeline
 * cross-reference. PR #2 merged two seconds earlier and names PR #3, merged
 * at the same time, the same way. No PR shares an accepted commit: commit
 * associations are empty and the census holds the PRs merged since the start.
 */
async function referencedGroup(startAt: number, foreign = false) {
  const original = fixture({ direct: true, textOnly: true });
  const others = new Map(
    [2, 3].map((number) => {
      const other = fixture({ direct: true, textOnly: true });
      other.pull.node_id = number === 2 ? "PR_referenced" : "PR_third";
      other.pull.number = number;
      other.pull.html_url = `https://github.com/${repository.id}/pull/${number}`;
      other.pull.merged_at = "2026-10-15T17:59:58Z";
      other.pull.closed_at = "2026-10-15T17:59:58Z";
      other.pull.updated_at = "2026-10-15T17:59:58Z";
      return [number, other] as const;
    }),
  );
  const current = `${repository.owner}/${repository.name}`;
  const crossReference = (number: number, owner = current) => ({
    source: {
      __typename: "PullRequest",
      id: owner === current ? others.get(number)?.pull.node_id : "PR_foreign",
      number,
      url: `https://github.com/${owner}/pull/${number}`,
      repository: { nameWithOwner: owner, isPrivate: false },
    },
  });
  const calls: string[] = [];
  const client = {
    async get<T>(path: string): Promise<T | null> {
      calls.push(path);
      if (/\/commits\/[a-f0-9]{40}\/pulls\?/.test(path)) return [] as T;
      const other = path.match(/\/(pulls|issues)\/([23])(?=\/|$)/u);
      const target = other && others.get(Number(other[2]));
      if (other && target)
        return target.client.get<T>(path.replace(other[0], `/${other[1]}/1`));
      return original.client.get<T>(path);
    },
    async graphql<T>(
      query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      if (query.includes("search(query:")) {
        const merged = [original, ...others.values()].filter(
          ({ pull }) => Date.parse(pull.merged_at) >= startAt,
        );
        return {
          search: {
            issueCount: merged.length,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: merged.map(({ pull }) => ({
              id: pull.node_id,
              number: pull.number,
              url: `https://github.com/${current}/pull/${pull.number}`,
              mergedAt: pull.merged_at,
              repository: {
                id: repository.expectedNodeId,
                databaseId: 42,
                nameWithOwner: current,
                isPrivate: false,
              },
              mergeCommit: { oid: "c".repeat(40) },
              commits: {
                totalCount: 1,
                nodes: [{ commit: { oid: "b".repeat(40) } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            })),
          },
        } as T;
      }
      const number = Number(variables.number);
      return {
        repository: {
          pullRequest: {
            id: others.get(number)?.pull.node_id ?? original.pull.node_id,
            timelineItems: {
              nodes:
                number === 1
                  ? foreign
                    ? [crossReference(7, "other/project")]
                    : [crossReference(2)]
                  : number === 2
                    ? [crossReference(3)]
                    : [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
    fileText: original.client.fileText,
  };
  const seed = {
    evidence: await collectValueEvidenceWith(client, original),
    policy,
  };
  const group = await collectValueGroup(
    db as never,
    client,
    seed,
    async () => true,
    startAt,
    [repository],
  );
  return { group, calls };
}

async function collectValueEvidenceWith(
  client: { get: <T>(path: string) => Promise<T | null> } & Record<
    string,
    unknown
  >,
  original: ReturnType<typeof fixture>,
) {
  const evidence = await collect({ ...original, client: client as never });
  expect(evidence.relatedPullRequests.length).toBe(1);
  return evidence;
}

test("a referenced PR accepted before the API start leaves the group instead of holding it", async () => {
  const { group, calls } = await referencedGroup(
    Date.parse("2026-10-15T18:00:00Z"),
  );
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
  ]);
  // The referenced PR was collected once (a collection reads the pull at its
  // start and its end), and its own references were not followed.
  expect(
    calls.filter((path) => path === `/repos/${repository.id}/pulls/2`),
  ).toHaveLength(2);
  expect(calls.some((path) => path.includes("/pulls/3"))).toBe(false);
});

test("a referenced PR accepted at or after the API start still joins the group", async () => {
  const { group } = await referencedGroup(Date.parse("2026-10-15T17:59:58Z"));
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_referenced",
    "PR_third",
  ]);
});

test("a referenced PR outside the project's repositories leaves the group instead of holding it", async () => {
  const { group, calls } = await referencedGroup(
    Date.parse("2026-10-15T18:00:00Z"),
    true,
  );
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
  ]);
  expect(calls.some((path) => path.includes("other/project"))).toBe(false);
});
