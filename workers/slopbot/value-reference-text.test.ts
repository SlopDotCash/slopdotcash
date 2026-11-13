import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { sameRepositoryCommitHints } from "./value-commit-hints";
import { collectValueEvidence } from "./value-evidence";

const repositoryId = "example/binary-proof";
const label = "abc1234";
const foreign = "d".repeat(40);
const local = "e".repeat(40);

test("a titled link keeps the destination commit and drops the label", () => {
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      `merged [${label}](https://github.com/${repositoryId}/commit/${local} "note")`,
    ),
  ).toEqual([local]);
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      `merged [${label}](https://github.com/other/proj/commit/${foreign} "note")`,
    ),
  ).toEqual([]);
});

test("a fenced sample is not a commit hint and a bare digest still is", () => {
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["```", `merged ${label}`, "```", ""].join("\n"),
    ),
  ).toEqual([]);
  expect(sameRepositoryCommitHints(repositoryId, `merged ${label}`)).toEqual([
    label,
  ]);
  expect(
    sameRepositoryCommitHints(repositoryId, `merged \`${label}\``),
  ).toEqual([label]);
});

test("a fence under alternating list and blockquote markers is not a commit hint", () => {
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["- > ```", `merged ${label}`, "> ```", `merged ${local}`].join("\n"),
    ),
  ).toEqual([local]);
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["> - ```", `merged ${label}`, "- ```"].join("\n"),
    ),
  ).toEqual([]);
});

test("a backtick inside a fence info string does not open a fence", () => {
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["``` ``foo``", `merged ${label}`, "```", `merged ${local}`].join("\n"),
    ),
  ).toEqual([label]);
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["```ts", `merged ${label}`, "```"].join("\n"),
    ),
  ).toEqual([]);
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      ["~~~ ``foo``", `merged ${label}`, "~~~"].join("\n"),
    ),
  ).toEqual([]);
});

test("fork and reference-style commit labels keep their destination scope", () => {
  expect(sameRepositoryCommitHints(repositoryId, `other@${label}`)).toEqual([]);
  expect(
    sameRepositoryCommitHints(
      repositoryId,
      `merged [${label}][other]\n\n[other]: https://github.com/other/proj/commit/${foreign}`,
    ),
  ).toEqual([]);
});

async function referencedNumbers(body: string) {
  const source = fixture({ direct: true, textOnly: true });
  source.pull.body = body;
  const queries: { owner: string; name: string; number: number }[] = [];
  const client = {
    ...source.client,
    async graphql<T>(query: string, variables: Record<string, unknown>) {
      if (query.includes("issueOrPullRequest")) {
        queries.push({
          owner: String(variables.owner),
          name: String(variables.name),
          number: Number(variables.number),
        });
        return {
          repository: {
            isPrivate: false,
            nameWithOwner: `${String(variables.owner)}/${String(variables.name)}`,
            issueOrPullRequest: { __typename: "Issue" },
          },
        } as T;
      }
      return source.client.graphql<T>();
    },
  };
  const evidence = await collectValueEvidence(
    client,
    repository.id,
    1,
    repository,
  );
  expect(
    evidence.limitations.filter((item) => item.startsWith("Outgoing")),
  ).toEqual([]);
  expect(evidence.relatedPullRequests).toEqual([]);
  return queries;
}

test("a pull request label does not outrank its GitHub destination", async () => {
  const bodies = [
    'See [#2](https://github.com/other/repo/pull/9 "upstream")',
    "See [#2](<https://github.com/other/repo/pull/9>)",
    "See [#2](https://GitHub.com/other/repo/pull/9)",
    "See [#2](https://www.github.com/other/repo/pull/9)",
    "See [#2](https://example.com/not-a-pull)",
    'See <a href="https://example.com/pull/9">#2</a>',
    "See [#2][upstream]\n\n[upstream]: https://github.com/other/repo/issues/9",
  ];
  for (const body of bodies) {
    const queries = await referencedNumbers(body);
    expect(queries.some((query) => query.number === 2)).toBe(false);
  }
  expect(
    await referencedNumbers(
      'See [#2](https://github.com/other/repo/pull/9 "upstream")',
    ),
  ).toEqual([{ owner: "other", name: "repo", number: 9 }]);
  expect(
    await referencedNumbers(
      "See [#2][upstream]\n\n[upstream]: https://github.com/other/repo/issues/9",
    ),
  ).toEqual([{ owner: "other", name: "repo", number: 9 }]);
  expect(
    await referencedNumbers(
      'See <a href="https://github.com/other/repo/pull/9">#2</a>',
    ),
  ).toEqual([{ owner: "other", name: "repo", number: 9 }]);
});

test("a fenced sample number is not a related pull request", async () => {
  const local = { owner: "example", name: "binary-proof" };
  expect(
    await referencedNumbers(["```", "See #2", "```", "See #4"].join("\n")),
  ).toEqual([{ ...local, number: 4 }]);
  expect(
    await referencedNumbers(
      ["> ```", "> See #2", "> ```", "See #5"].join("\n"),
    ),
  ).toEqual([{ ...local, number: 5 }]);
  expect(
    await referencedNumbers(
      ["- ```", "  See #2", "  ```", "See #6"].join("\n"),
    ),
  ).toEqual([{ ...local, number: 6 }]);
  expect(await referencedNumbers("> See #2")).toEqual([
    { ...local, number: 2 },
  ]);
  expect(await referencedNumbers("See #2")).toEqual([{ ...local, number: 2 }]);
});
