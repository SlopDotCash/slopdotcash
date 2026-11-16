import { expect, test } from "bun:test";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import { fixture, repository } from "../tests/value-binary-fixture";
import { loadValueInputs, type ValueInputProgress } from "./value-ingestion";

function candidate(
  failure: "proof" | "transport" | "identity" | "pull-number",
  baseRefName = "main",
  related = true,
  useRepositoryAlias = false,
) {
  const f = fixture({ textOnly: true, direct: true });
  const target = findRegisteredRepositoryById("SlopDotCash/asi");
  if (!target?.expectedNodeId) throw new Error("Missing registered fixture");
  const originalId = "PR_original";
  const route = useRepositoryAlias
    ? `${target.owner}/${target.name}`
    : target.id;
  const isOriginalPull = (number: number) =>
    number === 1 || (number === 3 && failure === "pull-number");
  const pullId = (number: number) =>
    isOriginalPull(number) ? originalId : `PR_accepted_${number}`;
  const carrierNumbers = useRepositoryAlias ? [2, 4] : [2];
  const reads: string[] = [];
  const remap = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(repository.id, target.id)
        .replaceAll('"R_binary"', JSON.stringify(target.expectedNodeId)),
    );
  const github = {
    ...f.client,
    async get<T>(path: string): Promise<T | null> {
      reads.push(path);
      if (failure === "transport" && path.endsWith("/pulls/2"))
        throw new Error("Fixture transport unavailable");
      const rawPath = path
        .replaceAll(`${target.owner}/${target.name}`, repository.id)
        .replaceAll(target.id, repository.id)
        .replace(/\/(pulls|issues)\/[234](?=\/|$)/gu, "/$1/1");
      const result = await f.client.get<unknown>(rawPath);
      if (
        failure === "identity" &&
        path === `/repos/${target.owner}/${target.name}`
      )
        (result as { node_id: string }).node_id = "R_wrong";
      const pullNumber = /\/pulls\/([1234])$/u.exec(path)?.[1];
      if (pullNumber) {
        const pull = result as typeof f.pull;
        pull.number = Number(pullNumber);
        pull.node_id = pullId(pull.number);
        pull.html_url = `https://github.com/${route}/pull/${pullNumber}`;
        if (isOriginalPull(pull.number)) {
          Object.assign(pull, {
            merged_at: null,
            merge_commit_sha: null,
            merged_by: null,
          });
        }
      }
      if (/\/pulls\/[1234]\/commits\?/u.test(path))
        for (const commit of result as { author: unknown }[])
          commit.author = null;
      return remap(result) as T | null;
    },
    async graphql<T>(
      _query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      const number = Number(variables.number);
      const referenceNumber = failure === "pull-number" && number === 4 ? 3 : 1;
      return {
        repository: {
          pullRequest: {
            id: pullId(number),
            timelineItems: {
              nodes:
                !isOriginalPull(number) && related
                  ? [
                      {
                        source: {
                          __typename: "PullRequest",
                          id: originalId,
                          number: referenceNumber,
                          url: `https://github.com/${route}/pull/${referenceNumber}`,
                          repository: {
                            nameWithOwner: route,
                            isPrivate: false,
                          },
                        },
                      },
                    ]
                  : [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      } as T;
    },
  };
  const transport = Object.assign(
    async () => {
      throw new Error("Historical attribution must not request value history");
    },
    { preconnect: fetch.preconnect },
  );
  const run = (onProgress?: (progress: ValueInputProgress) => void) =>
    loadValueInputs(
      github,
      [],
      transport,
      undefined,
      carrierNumbers.map((number) => ({
        id: pullId(number),
        number,
        baseRefName,
        url: `https://github.com/${route}/pull/${number}`,
        headRefOid: f.pull.head.sha,
        mergedAt: f.pull.merged_at,
        updatedAt: f.pull.updated_at,
        commits: [
          {
            oid: number === 2 ? f.pull.head.sha : "d".repeat(40),
            author: null,
            parentCount: 1,
          },
        ],
      })),
      onProgress,
    );
  return { run, acceptedId: pullId(2), reads, route, canonical: target.id };
}

test("unproven retained work becomes a source-specific attribution hold", async () => {
  const { run, acceptedId } = candidate("proof");
  const result = await run();
  expect([...result.implementationAttributionHolds.keys()]).toEqual([
    acceptedId,
  ]);
  expect(
    result.implementationAttributionHolds.get(acceptedId)?.length,
  ).toBeGreaterThan(0);
  expect(result.retainedCommitAuthors.size).toBe(0);
  expect(result.valueDecisions.size).toBe(0);
});

test("two merged PRs can resolve the same retained original through a registered alias", async () => {
  const { run, route, canonical, reads } = candidate(
    "proof",
    "main",
    true,
    true,
  );
  expect(route.toLowerCase()).not.toBe(canonical.toLowerCase());
  const progress: ValueInputProgress[] = [];
  const result = await run((entry) => progress.push(entry));
  expect(progress).toContainEqual({
    phase: "commit-attributions",
    completed: 2,
    total: 2,
  });
  expect(
    reads.filter((path) =>
      path.startsWith(`/repos/${canonical}/pulls/1/commits?`),
    ),
  ).toHaveLength(1);
  expect(result.retainedCommitAuthors.size).toBe(0);
});

test("a registered alias cannot give a cached source a different PR number", async () => {
  const { run } = candidate("pull-number", "main", true, true);
  const progress: ValueInputProgress[] = [];
  await expect(run((entry) => progress.push(entry))).rejects.toThrow(
    "Joint source identity changed between records",
  );
  expect(progress).toContainEqual({
    phase: "commit-attributions",
    completed: 1,
    total: 2,
  });
});

test("transport failures do not become successful attribution holds", async () => {
  const progress: ValueInputProgress[] = [];
  await expect(
    candidate("transport").run((entry) => progress.push(entry)),
  ).rejects.toThrow("Fixture transport unavailable");
  expect(progress).toEqual([
    { phase: "commit-attributions", completed: 0, total: 1 },
  ]);
});

test("repository identity failures do not become successful attribution holds", async () => {
  await expect(candidate("identity").run()).rejects.toThrow(
    "Value ingestion requires the registered public repository",
  );
});

test("first-owned unlinked work on another branch still reads original attribution", async () => {
  const { run, acceptedId, reads } = candidate("proof", "production-promotion");
  const result = await run();
  expect(reads.some((path) => path.endsWith("/pulls/1"))).toBe(true);
  expect([...result.implementationAttributionHolds.keys()]).toEqual([
    acceptedId,
  ]);
});

test("an unreferenced unlinked commit needs no full commit or file evidence", async () => {
  const { run, reads } = candidate("proof", "main", false);
  const result = await run();
  expect(result.retainedCommitAuthors.size).toBe(0);
  expect(result.implementationAttributionHolds.size).toBe(0);
  expect(reads.some((path) => /\/(?:files|commits)(?:\/|\?)/u.test(path))).toBe(
    false,
  );
  expect(reads.some((path) => path.endsWith("/pulls/1"))).toBe(false);
  expect(reads.some((path) => path.includes("/issues/2/comments?"))).toBe(true);
});

test("a later promotion of already accepted SHAs does not hydrate attribution again", async () => {
  const github = {
    async get<T>(): Promise<T | null> {
      throw new Error("Promotion attribution must not read GitHub");
    },
    async graphql<T>(): Promise<T> {
      throw new Error("Promotion attribution must not read GitHub");
    },
    async fileText(): Promise<{ text: string; truncated: boolean } | null> {
      throw new Error("Promotion attribution must not read GitHub");
    },
  };
  const result = await loadValueInputs(github, [], undefined, undefined, [
    {
      id: "PR_earlier_acceptance",
      number: 122,
      url: "https://github.com/SlopDotCash/asi/pull/122",
      baseRefName: "main",
      headRefOid: "a".repeat(40),
      mergedAt: "2026-10-10T00:00:00Z",
      updatedAt: "2026-10-10T00:00:00Z",
      commits: [
        {
          oid: "a".repeat(40),
          author: {
            id: "MDQ6VXNlcjQy",
            login: "author",
            avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
            url: "https://github.com/author",
            kind: "User",
          },
          parentCount: 1,
        },
      ],
    },
    {
      id: "PR_promotion",
      number: 123,
      url: "https://github.com/SlopDotCash/asi/pull/123",
      baseRefName: "production-promotion",
      headRefOid: "a".repeat(40),
      mergedAt: "2026-10-11T00:00:00Z",
      updatedAt: "2026-10-11T00:00:00Z",
      commits: [{ oid: "a".repeat(40), author: null, parentCount: 1 }],
    },
  ]);
  expect(result.retainedCommitAuthors.size).toBe(0);
  expect(result.implementationAttributionHolds.size).toBe(0);
});
