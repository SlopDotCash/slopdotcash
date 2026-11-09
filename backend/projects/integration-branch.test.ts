import { expect, test } from "bun:test";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { renderProjectSkill } from "../../src/lib/project-skill.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { lookupGitHubRepository, readBranchHead } from "./github-lookup";

const COMMIT = "a".repeat(40);

for (const branch of [
  "release/2026+10",
  "개발/다음",
  "release/🚀",
  "release/(next)!",
  "release/{{SLOP_PROJECT_ID}}",
  `${"가".repeat(80)}/${"나".repeat(80)}`,
]) {
  test(`a selectable integration branch survives lookup, validation and skill rendering: ${branch}`, async () => {
    const calls: string[] = [];
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push(url);
      const parsed = new URL(url);
      if (parsed.pathname === "/graphql") {
        expect(init.method).toBe("POST");
        const body = JSON.parse(String(init.body));
        expect(body.variables.id).toBe("R_example");
        const node = {
          __typename: "Repository",
          id: "R_example",
          fullDatabaseId: "123456789",
          isPrivate: false,
        };
        if (body.query.includes("ProjectRepositoryBranches"))
          return Response.json({
            data: {
              node: {
                ...node,
                refs: {
                  nodes: [
                    {
                      name: branch,
                      prefix: "refs/heads/",
                      target: { __typename: "Commit", oid: COMMIT },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          });
        expect(body.variables.qualifiedName).toBe(`refs/heads/${branch}`);
        return Response.json({ data: { node: { ...node, ref: null } } });
      }
      const path = new URL(url).pathname;
      if (path === "/repos/example/branch-fixture")
        return Response.json({
          id: 123456789,
          node_id: "R_example",
          full_name: "example/branch-fixture",
          private: false,
          default_branch: branch,
          owner: {
            id: 987654321,
            node_id: "O_example",
            login: "example",
            type: "Organization",
          },
        });
      if (path.startsWith("/repos/example/branch-fixture/branches/"))
        return Response.json({ name: branch, commit: { sha: COMMIT } });
      return Response.json({ message: "Not Found" }, { status: 404 });
    };
    const lookup = await lookupGitHubRepository(
      fetcher,
      "public-read-token-fixture",
      "example/branch-fixture",
    );
    expect(lookup.branches).toContain(branch);
    const input = applicationManifest("branch-fixture", lookup.repository);
    Object.assign((input.repositories as Record<string, unknown>[])[0], {
      integrationBranch: branch,
    });
    input.rewardAsset = {
      ...(input.rewardAsset as Record<string, unknown>),
      decimals: 6,
      chainId: "1",
      cluster: null,
      verifiedAt: "2026-10-18T00:00:00.000Z",
    };
    const manifest = assertProjectDefinition(input);
    expect(
      await readBranchHead(fetcher, undefined, lookup.repository, branch),
    ).toBe(COMMIT);
    expect(calls.at(-1)).toBe(
      `https://api.github.com/repos/example/branch-fixture/branches/${encodeURIComponent(branch).replace(/[!'()]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    );
    for (const role of ["contributor", "reviewer"] as const) {
      const rendered = renderProjectSkill({
        role,
        manifest,
        templateFiles: {
          "SKILL.md": "Branch from `{{SLOP_INTEGRATION_BRANCH}}`.",
        },
        registry: { revision: 1, manifestSha256: "b".repeat(64) },
      });
      expect(
        JSON.parse(new TextDecoder().decode(rendered["project.json"])),
      ).toHaveProperty("repositoryId", "example/branch-fixture");
      expect(new TextDecoder().decode(rendered["SKILL.md"])).toBe(
        `Branch from \`${branch}\`.`,
      );
    }
  });
}

test("invalid Git branch names still fail before requesting a head", async () => {
  for (const branch of [
    "",
    "HEAD",
    "@",
    "-main",
    "main.",
    "a..b",
    "a@{b",
    "a b",
    "a\nb",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "/a",
    "a/",
    "a//b",
    ".a/b",
    "a/.b",
    "a.lock",
    "a.lock/b",
    "a\x7fb",
    "a".repeat(256),
    "a\ud800",
  ]) {
    let requested = false;
    await expect(
      readBranchHead(
        async () => {
          requested = true;
          return Response.json({ commit: { sha: COMMIT } });
        },
        undefined,
        "example/branch-fixture",
        branch,
      ),
    ).rejects.toThrow();
    expect(requested).toBe(false);
  }
});
