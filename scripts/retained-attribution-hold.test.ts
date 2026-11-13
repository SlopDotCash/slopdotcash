import { expect, test } from "bun:test";
import { findRegisteredRepositoryById } from "../src/lib/repositories.mjs";
import { fixture, repository } from "../tests/value-binary-fixture";
import { loadValueInputs } from "./value-ingestion";

function candidate(failure: "proof" | "transport" | "identity") {
  const f = fixture({ textOnly: true, direct: true });
  const target = findRegisteredRepositoryById("SlopDotCash/asi");
  if (!target?.expectedNodeId) throw new Error("Missing registered fixture");
  const originalId = "PR_original";
  const acceptedId = "PR_accepted";
  const remap = <T>(value: T): T =>
    JSON.parse(
      JSON.stringify(value)
        .replaceAll(repository.id, target.id)
        .replaceAll('"R_binary"', JSON.stringify(target.expectedNodeId)),
    );
  const github = {
    ...f.client,
    async get<T>(path: string): Promise<T | null> {
      if (failure === "transport" && path.endsWith("/pulls/2"))
        throw new Error("Fixture transport unavailable");
      const rawPath = path
        .replaceAll(`${target.owner}/${target.name}`, repository.id)
        .replaceAll(target.id, repository.id)
        .replace(/\/(pulls|issues)\/2(?=\/|$)/gu, "/$1/1");
      const result = await f.client.get<unknown>(rawPath);
      if (
        failure === "identity" &&
        path === `/repos/${target.owner}/${target.name}`
      )
        (result as { node_id: string }).node_id = "R_wrong";
      const pullNumber = /\/pulls\/([12])$/u.exec(path)?.[1];
      if (pullNumber) {
        const pull = result as typeof f.pull;
        pull.number = Number(pullNumber);
        pull.node_id = pullNumber === "1" ? originalId : acceptedId;
        pull.html_url = `${repository.githubUrl}/pull/${pullNumber}`;
        if (pullNumber === "1") {
          Object.assign(pull, {
            merged_at: null,
            merge_commit_sha: null,
            merged_by: null,
          });
        }
      }
      if (/\/pulls\/[12]\/commits\?/u.test(path))
        for (const commit of result as { author: unknown }[])
          commit.author = null;
      return remap(result) as T | null;
    },
    async graphql<T>(
      _query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      const number = Number(variables.number);
      return {
        repository: {
          pullRequest: {
            id: number === 1 ? originalId : acceptedId,
            timelineItems: {
              nodes:
                number === 2
                  ? [
                      {
                        source: {
                          __typename: "PullRequest",
                          id: originalId,
                          number: 1,
                          url: `https://github.com/${target.id}/pull/1`,
                          repository: {
                            nameWithOwner: target.id,
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
  const run = () =>
    loadValueInputs(github, [], transport, undefined, [
      {
        id: acceptedId,
        number: 2,
        url: `https://github.com/${target.id}/pull/2`,
        headRefOid: f.pull.head.sha,
        mergedAt: f.pull.merged_at,
        updatedAt: f.pull.updated_at,
        commits: [{ oid: f.pull.head.sha, author: null, parentCount: 1 }],
      },
    ]);
  return { run, acceptedId };
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

test("transport failures do not become successful attribution holds", async () => {
  await expect(candidate("transport").run()).rejects.toThrow(
    "Fixture transport unavailable",
  );
});

test("repository identity failures do not become successful attribution holds", async () => {
  await expect(candidate("identity").run()).rejects.toThrow(
    "Value ingestion requires the registered public repository",
  );
});
