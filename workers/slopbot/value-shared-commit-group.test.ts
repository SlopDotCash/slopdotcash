import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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

async function sharedCommitGroup(
  association:
    | "merged"
    | "open"
    | "unmerged"
    | "missing"
    | "wrong-repository"
    | "introducer-only"
    | "paged-census"
    | "unqualified-merge"
    | "qualified-merge"
    | "truncated-search" = "merged",
  paginate = false,
  startAt = Date.parse("2026-09-01T00:00:00Z"),
) {
  const original = fixture({ direct: true, textOnly: true });
  const carrier = fixture({ direct: true, textOnly: true });
  const secondOriginal = fixture({ direct: true, textOnly: true });
  carrier.pull.node_id = "PR_carrier";
  carrier.pull.number = 2;
  carrier.pull.html_url = `https://github.com/${repository.id}/pull/2`;
  // The carrier merges first, as in issue #1992. Neither PR names the other.
  carrier.pull.merged_at = "2026-10-15T17:59:58Z";
  secondOriginal.pull.node_id = "PR_second_original";
  secondOriginal.pull.number = 3;
  secondOriginal.pull.html_url = `https://github.com/${repository.id}/pull/3`;
  const seed = { evidence: await collect(original), policy };
  const mergeOnly =
    association === "unqualified-merge" || association === "qualified-merge";
  if (mergeOnly) {
    seed.evidence.commits.push({
      ...structuredClone(seed.evidence.commits[0]),
      sha: "d".repeat(40),
      parents: [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }],
    });
    if (association === "qualified-merge") {
      const patch =
        "diff --git a/resolved.ts b/resolved.ts\n--- a/resolved.ts\n+++ b/resolved.ts\n@@ -1 +1 @@\n-old\n+resolved\n";
      seed.evidence.mergeResolutions = [
        {
          commitSha: "d".repeat(40),
          parents: ["a".repeat(40), "b".repeat(40)],
          gitVersion: "git version 2.45.0",
          automaticTree: "e".repeat(40),
          resolvedTree: "f".repeat(40),
          hadConflicts: true,
          patch,
          patchSha256: createHash("sha256").update(patch).digest("hex"),
          paths: ["resolved.ts"],
        },
      ];
    }
  }
  const calls: string[] = [];
  const client = {
    async get<T>(path: string): Promise<T | null> {
      calls.push(path);
      if (/\/commits\/[a-f0-9]{40}\/pulls\?/.test(path)) {
        if (association === "missing") return null;
        if (path.includes(`/${"d".repeat(40)}/pulls?`))
          return [
            {
              node_id: secondOriginal.pull.node_id,
              number: 3,
              html_url: secondOriginal.pull.html_url,
              state: "closed",
              merged_at: secondOriginal.pull.merged_at,
              base: {
                repo: {
                  id: 42,
                  node_id: repository.expectedNodeId,
                  full_name: repository.id,
                  private: false,
                },
              },
            },
          ] as T;
        if (paginate && path.endsWith("page=1"))
          return Array.from({ length: 100 }, (_, index) => ({
            state: "open",
            merged_at: null,
            node_id: `PR_open_${index}`,
          })) as T;
        return [
          {
            node_id: carrier.pull.node_id,
            number: carrier.pull.number,
            html_url: carrier.pull.html_url,
            state: association === "open" ? "open" : "closed",
            merged_at:
              association === "unmerged" || association === "open"
                ? null
                : carrier.pull.merged_at,
            base: {
              repo: {
                id: association === "wrong-repository" ? 99 : 42,
                node_id: repository.expectedNodeId,
                full_name: repository.id,
                private: false,
              },
            },
          },
        ] as T;
      }
      if (path.includes("/pulls/2"))
        return carrier.client.get<T>(path.replace("/pulls/2", "/pulls/1"));
      if (path.includes("/issues/2/"))
        return carrier.client.get<T>(path.replace("/issues/2/", "/issues/1/"));
      if (path.includes("/pulls/3"))
        return secondOriginal.client.get<T>(
          path.replace("/pulls/3", "/pulls/1"),
        );
      if (path.includes("/issues/3/"))
        return secondOriginal.client.get<T>(
          path.replace("/issues/3/", "/issues/1/"),
        );
      return original.client.get<T>(path);
    },
    async graphql<T>(
      query: string,
      variables: Record<string, unknown>,
    ): Promise<T> {
      if (query.includes("search(query:")) {
        expect(variables.q).toBe(
          `repo:${repository.id} is:pr is:merged merged:>=${new Date(startAt).toISOString().slice(0, 10)}`,
        );
        const sources = [original];
        if (!["open", "unmerged"].includes(association)) sources.push(carrier);
        if (
          association === "introducer-only" ||
          association === "paged-census" ||
          mergeOnly
        )
          sources.push(secondOriginal);
        const page =
          association === "paged-census"
            ? variables.cursor === "next-search"
              ? sources.slice(2)
              : sources.slice(0, 2)
            : sources;
        return {
          search: {
            issueCount:
              association === "truncated-search" ? 1001 : sources.length,
            pageInfo: {
              hasNextPage:
                association === "paged-census" && variables.cursor === null,
              endCursor: variables.cursor === null ? "next-search" : null,
            },
            nodes: page.map(({ pull }) => ({
              id: pull.node_id,
              number: pull.number,
              url: pull.html_url,
              mergedAt: pull.merged_at,
              repository: {
                id: repository.expectedNodeId,
                databaseId: 42,
                nameWithOwner: repository.id,
                isPrivate: false,
              },
              mergeCommit: {
                oid:
                  mergeOnly && pull.number === 3
                    ? "d".repeat(40)
                    : "c".repeat(40),
              },
              commits: {
                totalCount:
                  association === "paged-census" && pull.number === 3 ? 101 : 1,
                nodes:
                  association === "paged-census" && pull.number === 3
                    ? Array.from({ length: 100 }, (_, i) => ({
                        commit: { oid: (i + 1).toString(16).padStart(40, "0") },
                      }))
                    : [
                        {
                          commit: {
                            oid:
                              mergeOnly && pull.number === 3
                                ? "d".repeat(40)
                                : "b".repeat(40),
                          },
                        },
                      ],
                pageInfo: {
                  hasNextPage:
                    association === "paged-census" && pull.number === 3,
                  endCursor:
                    association === "paged-census" && pull.number === 3
                      ? "next-commits"
                      : null,
                },
              },
            })),
          },
        } as T;
      }
      if (query.includes("commits(first:100,after:")) {
        expect(variables.number).toBe(3);
        expect(variables.after).toBe("next-commits");
        return {
          repository: {
            id: repository.expectedNodeId,
            pullRequest: {
              id: secondOriginal.pull.node_id,
              commits: {
                totalCount: 101,
                nodes: [{ commit: { oid: "b".repeat(40) } }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        } as T;
      }
      if (variables.number === 3) return secondOriginal.client.graphql<T>();
      return variables.number === 2
        ? carrier.client.graphql<T>()
        : original.client.graphql<T>();
    },
    fileText: original.client.fileText,
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

test("collects accepted shared-commit carriers without body or timeline references", async () => {
  const { group } = await sharedCommitGroup();
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
  ]);
  expect(
    group?.every((source) => source.evidence.relatedPullRequests.length === 0),
  ).toBe(true);
});

test("collects other originals when commit/pulls returns only the introducing carrier", async () => {
  const { group } = await sharedCommitGroup("introducer-only");
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
    "PR_second_original",
  ]);
});

test("does not value an incomplete GitHub search census", async () => {
  expect((await sharedCommitGroup("truncated-search")).group).toBeNull();
});

test("a shared unqualified imported merge does not expand the source group", async () => {
  const { group, calls } = await sharedCommitGroup("unqualified-merge");
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
  ]);
  expect(calls.some((path) => path.includes(`/${"d".repeat(40)}/pulls?`))).toBe(
    false,
  );
  expect(calls.some((path) => path.includes("/pulls/3"))).toBe(false);
});

test("a declared merge resolution discovers its carrier and follows full source collection", async () => {
  const { group, calls } = await sharedCommitGroup("qualified-merge");
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
    "PR_second_original",
  ]);
  expect(calls.some((path) => path.includes(`/${"d".repeat(40)}/pulls?`))).toBe(
    true,
  );
  expect(calls).toContain(`/repos/${repository.id}/pulls/3`);
});

test("retains the exact API start boundary when an older shared carrier is discovered", async () => {
  // The seed merges exactly at 18:00. The carrier merged two seconds earlier.
  // Calendar-day search must not turn that protected earlier source into a
  // new independently valued API-era result or silently drop it from a group.
  expect(
    (
      await sharedCommitGroup(
        "merged",
        false,
        Date.parse("2026-10-15T18:00:00Z"),
      )
    ).group,
  ).toBeNull();
  expect(
    (
      await sharedCommitGroup(
        "merged",
        false,
        Date.parse("2026-10-15T17:59:58Z"),
      )
    ).group?.length,
  ).toBe(2);
});

test("finds shared commits beyond both search and per-PR commit pages", async () => {
  const { group } = await sharedCommitGroup("paged-census");
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
    "PR_second_original",
  ]);
});

test("follows commit-association pages and reuses shared commit reads", async () => {
  const { group, calls } = await sharedCommitGroup("merged", true);
  expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
    "PR_binary",
    "PR_carrier",
  ]);
  const associations = calls.filter((path) =>
    /\/commits\/.+\/pulls\?/.test(path),
  );
  // One submitted commit and one accepted merge, each with two pages. The
  // second carrier has the same pair, so it requires no duplicate requests.
  expect(associations).toHaveLength(4);
  expect(new Set(associations).size).toBe(4);
});

for (const association of ["open", "unmerged"] as const) {
  test(`does not group a ${association} association as accepted work`, async () => {
    const { group } = await sharedCommitGroup(association);
    expect(group?.map((source) => source.evidence.pull.node_id)).toEqual([
      "PR_binary",
    ]);
  });
}

for (const association of ["missing", "wrong-repository"] as const) {
  test(`keeps ${association} shared-commit discovery pending`, async () => {
    expect((await sharedCommitGroup(association)).group).toBeNull();
  });
}
