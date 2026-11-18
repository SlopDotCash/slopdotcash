import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import {
  withoutClosedCodeFences,
  withoutClosedCodeSpans,
} from "./value-commit-hints";
import { collectValueReferenceEvidence } from "./value-evidence";

test("closed fences preserve prose, indentation and matching fence lengths", () => {
  for (const fence of ["```", "````", "~~~", "~~~~"])
    for (const indent of ["", " ", "  ", "   "]) {
      const text = `before #1\n${indent}${fence}js\n#2\n${indent}${fence}${fence[0]}\nafter #3`;
      const result = withoutClosedCodeFences(text);
      expect(result).toContain("before #1");
      expect(result).toContain("after #3");
      expect(result).not.toContain("#2");
    }
});

test("unmatched, shorter, wrong-kind and inline fences keep references", () => {
  for (const text of [
    "````\n#2\n```\n#3",
    "```\n#2\n~~~\n#3",
    "```js\n#2",
    "inline `#2` and ``#3``",
    "    ```\n#2\n    ```",
    "```bad`info\n#2\n~~~",
  ])
    expect(withoutClosedCodeFences(text)).toContain("#2");
});

test("textual reference discovery keeps real links and repeated prose references", async () => {
  const source = fixture({ direct: true, textOnly: true });
  source.pull.body =
    "Before #11\n```text\n#2 #3\n```\nAfter [real](https://github.com/example/binary-proof/pull/3) and `#4`";
  const calls: number[] = [];
  const result = await collectValueReferenceEvidence(
    {
      ...source.client,
      async graphql<T>(
        query: string,
        variables: Record<string, unknown>,
      ): Promise<T> {
        if (query.includes("timelineItems"))
          return {
            repository: {
              pullRequest: {
                id: source.pull.node_id,
                timelineItems: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          } as T;
        const number = Number(variables.number);
        calls.push(number);
        return {
          repository: {
            id: "R_fixture",
            isPrivate: false,
            nameWithOwner: repository.id,
            issueOrPullRequest: {
              __typename: "PullRequest",
              id: `PR_${number}`,
              number,
              url: `https://github.com/${repository.id}/pull/${number}`,
            },
          },
        } as T;
      },
    },
    repository.id,
    1,
  );
  expect(calls).toEqual([11, 3]);
  expect(result.references.map((reference) => reference.number)).toEqual([
    11, 3,
  ]);
  expect(source.pull.body).toContain("#2 #3");
});

test("inline code requires equal delimiters and preserves malformed or escaped prose", () => {
  expect(withoutClosedCodeSpans("before #1 `#2` after #3")).toBe(
    "before #1   after #3",
  );
  expect(withoutClosedCodeSpans("`` #2 ` #3 `` #4")).toBe("  #4");
  expect(withoutClosedCodeSpans("`#2`` #3")).toBe("`#2`` #3");
  expect(withoutClosedCodeSpans("\\`#2\\` #3")).toBe("\\`#2\\` #3");
  expect(withoutClosedCodeSpans("`#2\\` #3")).toBe("  #3");
  expect(
    withoutClosedCodeSpans("`#2` #2 [real](https://github.com/a/b/pull/2)"),
  ).toContain("#2 [real](https://github.com/a/b/pull/2)");
});

test("incoming timeline identity remains authoritative when its text is code", async () => {
  const source = fixture({ direct: true, textOnly: true });
  source.pull.body = "```text\n#23\n```";
  let outgoingReads = 0;
  const result = await collectValueReferenceEvidence(
    {
      ...source.client,
      async graphql<T>(query: string): Promise<T> {
        if (query.includes("timelineItems"))
          return {
            repository: {
              pullRequest: {
                id: source.pull.node_id,
                timelineItems: {
                  nodes: [
                    {
                      source: {
                        __typename: "PullRequest",
                        id: "PR_incoming",
                        number: 23,
                        url: `https://github.com/${repository.id}/pull/23`,
                        repository: {
                          nameWithOwner: repository.id,
                          isPrivate: false,
                        },
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          } as T;
        outgoingReads++;
        throw Error("Code example must not generate a textual read");
      },
    },
    repository.id,
    1,
  );
  expect(outgoingReads).toBe(0);
  expect(result.references.map((reference) => reference.id)).toEqual([
    "PR_incoming",
  ]);
  expect(source.pull.body).toBe("```text\n#23\n```");
});

test("inline spans allow newlines and count backslash escaping at the opener", () => {
  expect(withoutClosedCodeSpans("before ``#2\n`#3`\n`` after #4")).toBe(
    "before   after #4",
  );
  expect(withoutClosedCodeSpans("\\\\`#2` #3")).toBe("\\\\  #3");
  expect(withoutClosedCodeSpans("\\`#2\\` #3")).toContain("#2");
});
