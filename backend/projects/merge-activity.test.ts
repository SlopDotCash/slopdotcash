import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import {
  type Fetch,
  handleMergeActivityApi,
  refreshMergeActivity,
  summarizeMergeActivity,
} from "./merge-activity";

const NOW = new Date("2026-11-15T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

function d1() {
  const sqlite = new Database(":memory:");
  sqlite.exec(
    readFileSync("migrations/0125_repository_merge_activity.sql", "utf8"),
  );
  const prepare = (sql: string) => {
    let values: unknown[] = [];
    const statement = {
      bind(...next: unknown[]) {
        values = next;
        return statement;
      },
      async all() {
        return { results: sqlite.query(sql).all(...(values as never[])) };
      },
      async run() {
        sqlite.query(sql).run(...(values as never[]));
        return { success: true, meta: { changes: 1 } };
      },
      async first() {
        return sqlite.query(sql).get(...(values as never[]));
      },
    };
    return statement;
  };
  return { db: { prepare } as never, sqlite };
}

function project(status: "active" | "paused") {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({ ...original, status });
}

/** A fake GitHub GraphQL endpoint answering the two queries. */
function github(options: { fail?: boolean } = {}): Fetch {
  return async (_url, init) => {
    if (options.fail) return new Response("{}", { status: 502 });
    const body = JSON.parse(String(init.body)) as { query: string };
    if (body.query.includes("search("))
      return Response.json({
        data: {
          search: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                createdAt: daysAgo(3),
                mergedAt: daysAgo(2),
                authorAssociation: "CONTRIBUTOR",
                author: { __typename: "User" },
              },
              {
                createdAt: daysAgo(5),
                mergedAt: daysAgo(1),
                authorAssociation: "NONE",
                author: { __typename: "User" },
              },
              {
                createdAt: daysAgo(1),
                mergedAt: daysAgo(1),
                authorAssociation: "OWNER",
                author: { __typename: "User" },
              },
            ],
          },
        },
      });
    const respondedBy = (association: string, type = "User") => ({
      nodes: [{ authorAssociation: association, author: { __typename: type } }],
    });
    const none = { nodes: [] };
    return Response.json({
      data: {
        repository: {
          latest: { nodes: [{ mergedAt: daysAgo(1) }] },
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              // waiting: outside, 10 days, no maintainer response
              {
                createdAt: daysAgo(10),
                isDraft: false,
                authorAssociation: "CONTRIBUTOR",
                author: { __typename: "User" },
                reviews: respondedBy("NONE"),
                comments: respondedBy("MEMBER", "Bot"),
              },
              // answered by a maintainer
              {
                createdAt: daysAgo(9),
                isDraft: false,
                authorAssociation: "NONE",
                author: { __typename: "User" },
                reviews: respondedBy("COLLABORATOR"),
                comments: none,
              },
              // draft
              {
                createdAt: daysAgo(9),
                isDraft: true,
                authorAssociation: "NONE",
                author: { __typename: "User" },
                reviews: none,
                comments: none,
              },
              // maintainer's own
              {
                createdAt: daysAgo(8),
                isDraft: false,
                authorAssociation: "OWNER",
                author: { __typename: "User" },
                reviews: none,
                comments: none,
              },
              // too recent
              {
                createdAt: daysAgo(2),
                isDraft: false,
                authorAssociation: "NONE",
                author: { __typename: "User" },
                reviews: none,
                comments: none,
              },
            ],
          },
        },
      },
    });
  };
}

describe("merge activity", () => {
  test("counts only outside, non-draft pull requests 7+ days old with no maintainer response", () => {
    const activity = summarizeMergeActivity(
      [
        {
          createdAt: daysAgo(10),
          isDraft: false,
          outside: true,
          maintainerResponded: false,
        },
        {
          createdAt: daysAgo(10),
          isDraft: false,
          outside: true,
          maintainerResponded: true,
        },
        {
          createdAt: daysAgo(10),
          isDraft: true,
          outside: true,
          maintainerResponded: false,
        },
        {
          createdAt: daysAgo(10),
          isDraft: false,
          outside: false,
          maintainerResponded: false,
        },
        {
          createdAt: daysAgo(6),
          isDraft: false,
          outside: true,
          maintainerResponded: false,
        },
      ],
      false,
      [
        { createdAt: daysAgo(40), mergedAt: daysAgo(35), outside: true },
        { createdAt: daysAgo(4), mergedAt: daysAgo(3), outside: true },
        { createdAt: daysAgo(4), mergedAt: daysAgo(1), outside: true },
        { createdAt: daysAgo(1), mergedAt: daysAgo(1), outside: false },
      ],
      null,
      NOW,
    );
    expect(activity.waitingOutside).toBe(1);
    expect(activity.mergedOutside30d).toBe(2);
    expect(activity.medianMergeHours).toBe(48);
    expect(activity.lastMergedAt).toBe(daysAgo(1));
  });

  test("a scheduled read stores the active project's repository and the API serves it", async () => {
    const { db } = d1();
    const result = await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      github(),
      NOW,
    );
    expect(result).toEqual({ read: 1, failed: 0 });
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    const body = (await response?.json()) as {
      projects: Array<{
        projectId: string;
        repositories: Array<Record<string, unknown>>;
      }>;
    };
    const rows = body.projects.find((p) => p.projectId === "asi")?.repositories;
    expect(rows?.[0]).toMatchObject({
      waitingOutside: 1,
      waitingCapped: false,
      mergedOutsideLast30Days: 2,
      medianHoursToMerge: 60,
      lastMergedAt: daysAgo(1),
      lastAttemptFailed: false,
    });
  });

  test("a fresh repository is not read again; a paused project is not read", async () => {
    const { db } = d1();
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "t",
      github(),
      NOW,
    );
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    expect(
      await refreshMergeActivity(
        db,
        [project("active")],
        async () => "t",
        github(),
        later,
      ),
    ).toEqual({ read: 0, failed: 0 });
    const { db: other } = d1();
    expect(
      await refreshMergeActivity(
        other,
        [project("paused")],
        async () => "t",
        github(),
        NOW,
      ),
    ).toEqual({ read: 0, failed: 0 });
  });

  test("a failed read keeps the last values and never publishes zeros", async () => {
    const { db } = d1();
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "t",
      github(),
      NOW,
    );
    const nextDay = new Date(NOW.getTime() + 21 * 3_600_000);
    expect(
      await refreshMergeActivity(
        db,
        [project("active")],
        async () => "t",
        github({ fail: true }),
        nextDay,
      ),
    ).toEqual({ read: 0, failed: 1 });
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    const body = (await response?.json()) as {
      projects: Array<{ repositories: Array<Record<string, unknown>> }>;
    };
    expect(body.projects[0].repositories[0]).toMatchObject({
      waitingOutside: 1,
      observedAt: NOW.toISOString(),
      lastAttemptFailed: true,
    });
  });

  test("a repository that was never read successfully is not listed", async () => {
    const { db } = d1();
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => null,
      github(),
      NOW,
    );
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    expect(
      ((await (response as Response).json()) as { projects: unknown[] })
        .projects,
    ).toEqual([]);
  });
});
