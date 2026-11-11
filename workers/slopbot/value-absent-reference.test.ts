import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { GitHubGraphQLError } from "./github";
import { collectValueEvidence } from "./value-evidence";

/** The PR body names #2, which the repository does not have. */
async function evidenceWithReference(
  outgoing: (variables: Record<string, unknown>) => unknown,
) {
  const f = fixture({ direct: true, textOnly: true });
  f.pull.body = "Follows #2 and keeps the recording.";
  const queries: Record<string, unknown>[] = [];
  const client = {
    ...f.client,
    async graphql<T>(
      query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      if (!query.includes("issueOrPullRequest")) return f.client.graphql<T>();
      queries.push(variables);
      return outgoing(variables) as T;
    },
  };
  const evidence = await collectValueEvidence(
    client,
    repository.id,
    1,
    repository,
  );
  return { evidence, queries };
}
const resolved = {
  repository: {
    isPrivate: false,
    nameWithOwner: repository.id,
    issueOrPullRequest: null,
  },
};
const notFound = [
  { type: "NOT_FOUND", path: ["repository", "issueOrPullRequest"] },
];

test("a number GitHub reports absent in the public repository is not a related source", async () => {
  const { evidence, queries } = await evidenceWithReference(() => {
    throw new GitHubGraphQLError(notFound, resolved);
  });
  expect(queries).toEqual([
    { owner: "example", name: "binary-proof", number: 2 },
  ]);
  expect(evidence.limitations).toEqual([]);
  expect(evidence.relatedPullRequests).toEqual([]);
});

test("a resolved repository without the item is not a related source", async () => {
  const { evidence } = await evidenceWithReference(() => resolved);
  expect(evidence.limitations).toEqual([]);
  expect(evidence.relatedPullRequests).toEqual([]);
});

test("any other GraphQL failure keeps the outgoing reference as a limitation", async () => {
  for (const failure of [
    () => {
      throw new Error("GitHub GraphQL evidence is incomplete");
    },
    () => {
      throw new GitHubGraphQLError(
        [{ type: "NOT_FOUND", path: ["repository"] }],
        { repository: null },
      );
    },
    () => {
      throw new GitHubGraphQLError(
        [{ type: "RATE_LIMITED", path: ["repository", "issueOrPullRequest"] }],
        resolved,
      );
    },
    () => {
      throw new GitHubGraphQLError(notFound, {
        repository: { ...resolved.repository, isPrivate: true },
      });
    },
  ]) {
    const { evidence } = await evidenceWithReference(failure);
    expect(evidence.limitations).toEqual([
      "Outgoing reference is unavailable or private",
    ]);
  }
});

test("a private repository keeps the outgoing reference as a limitation", async () => {
  const { evidence } = await evidenceWithReference(() => ({
    repository: { ...resolved.repository, isPrivate: true },
  }));
  expect(evidence.limitations).toEqual([
    "Outgoing reference is unavailable or private",
  ]);
});
