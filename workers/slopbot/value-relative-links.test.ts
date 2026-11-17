import { expect, test } from "bun:test";
import { fixture, repository } from "../../tests/value-binary-fixture";
import { GitHubClient } from "./github";
import { githubLinkDestinations } from "./value-commit-hints";
import { collectValueReferenceEvidence } from "./value-evidence";

for (const text of [
  "[PRD section 6](docs/slop-product-requirements.md#6-funds-and-payments)",
  '[#44](../arbitrary/path/guide.MD#44-heading "Local guide")',
  "[owner/repo#44](./guide.md#44 'Local guide')",
  '[#44](<docs/a guide.md#44> "Local guide")',
  String.raw`[#44](docs/a\(b\).md#44)`,
  "[#44](docs/guide.md?view=1#44)",
  String.raw`\\[#44](docs/guide.md#44)`,
]) {
  test(`local documentation link does not discover a GitHub reference: ${text}`, async () => {
    const source = fixture({ direct: true, textOnly: true });
    source.pull.body = text;
    const queries: unknown[] = [];
    const client = GitHubClient.forToken(
      "synthetic-read-token",
      Object.assign(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          const { query, variables } = JSON.parse(String(init?.body));
          if (query.includes("timelineItems"))
            return Response.json({
              data: {
                repository: {
                  pullRequest: {
                    id: source.pull.node_id,
                    timelineItems: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            });
          queries.push(variables);
          throw new Error("Unexpected reference query");
        },
        { preconnect: fetch.preconnect },
      ),
    );
    const result = await collectValueReferenceEvidence(
      {
        ...source.client,
        graphql: client.graphql.bind(client),
      },
      repository.id,
      1,
    );
    expect(queries).toEqual([]);
    expect(result.references).toEqual([]);
    expect(result.limitations).toEqual([]);
  });
}

test("GitHub destinations and plain repository references retain their scope", () => {
  expect(
    githubLinkDestinations(
      "[#44](https://github.com/owner/repo/pull/45) owner/repo#46",
    ),
  ).toBe("https://github.com/owner/repo/pull/45 owner/repo#46");
});

test("malformed and escaped Markdown is preserved for conservative discovery", () => {
  const text = String.raw`\[#44](docs/guide.md#45) [#46](docs/guide.md#47`;
  expect(githubLinkDestinations(text)).toBe(text);
});

test("external and protocol-relative document destinations remain visible", () => {
  const text =
    "[#44](https://example.com/guide.md#45) [#46](//example.com/guide.md#47)";
  expect(githubLinkDestinations(text)).toBe(text);
});
