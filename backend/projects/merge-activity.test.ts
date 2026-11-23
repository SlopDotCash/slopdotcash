import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { assertProjectPolicyTransition } from "../../src/lib/project-policy.mjs";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import {
  type Fetch,
  handleMergeActivityApi,
  readIntakeCounts,
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
  sqlite.exec(
    readFileSync("migrations/0134_merge_activity_open_outside.sql", "utf8"),
  );
  sqlite.exec(
    readFileSync("migrations/0144_merge_activity_wanted_issues.sql", "utf8"),
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

function project(status: "active" | "paused", intakeCap?: number) {
  const original = findProject("asi");
  if (!original) throw new Error("Missing registry fixture");
  return assertProjectDefinition({
    ...original,
    status,
    ...(intakeCap === undefined
      ? {}
      : { slopbot: { automaticClosure: false, intakeCap } }),
  });
}

/** The same project after a reviewed transfer of its repository to `path`. */
function transferred(
  before: ReturnType<typeof project>,
  path: string,
): ReturnType<typeof project> {
  const [repository, ...rest] = before.repositories;
  return assertProjectDefinition({
    ...before,
    repositories: [
      {
        ...repository,
        aliases: [...(repository.aliases ?? []), path],
        displayName: path,
        githubUrl: `https://github.com/${path}`,
      },
      ...rest,
    ],
  });
}

async function served(db: never) {
  const response = await handleMergeActivityApi(
    new Request("https://slop.cash/api/v1/merge-activity"),
    { db },
  );
  const body = (await response?.json()) as {
    projects: Array<{
      projectId: string;
      repositories: Array<{
        repository: string;
        observedAt: string;
        waitingOutside: number;
      }>;
    }>;
  };
  return body.projects.find((p) => p.projectId === "asi")?.repositories ?? [];
}

/**
 * A fake GitHub GraphQL endpoint answering the queries. `more` lists the
 * count-only pages that follow the first open page, as draft flags of
 * outside pull requests; `calls` records which query each request made.
 */
function github(
  options: { fail?: boolean; more?: boolean[][]; calls?: string[] } = {},
): Fetch {
  return async (_url, init) => {
    if (options.fail) return new Response("{}", { status: 502 });
    const body = JSON.parse(String(init.body)) as {
      query: string;
      variables: { after: string | null };
    };
    const counting =
      !body.query.includes("search(") && !body.query.includes("reviews(");
    options.calls?.push(
      body.query.includes("search(") ? "merged" : counting ? "count" : "open",
    );
    if (counting) {
      const page = Number(String(body.variables.after).replace("count-", ""));
      const drafts = options.more?.[page] ?? [];
      return Response.json({
        data: {
          repository: {
            pullRequests: {
              pageInfo: {
                hasNextPage: page + 1 < (options.more?.length ?? 0),
                endCursor: `count-${page + 1}`,
              },
              nodes: drafts.map((isDraft) => ({
                isDraft,
                authorAssociation: "NONE",
                author: { __typename: "User" },
              })),
            },
          },
        },
      });
    }
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
            pageInfo: options.more?.length
              ? { hasNextPage: true, endCursor: "count-0" }
              : { hasNextPage: false, endCursor: null },
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
    // Open outside pull requests count whether or not a maintainer answered
    // and whatever their age; drafts and a maintainer's own do not.
    expect(activity.openOutside).toBe(3);
    expect(activity.openOutsideCapped).toBe(false);
  });

  test("the same read stores every open outside pull request, answered or not", async () => {
    const { db, sqlite } = d1();
    const calls: string[] = [];
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      github({ calls }),
      NOW,
    );
    // Waiting, answered and recent count; the draft and the owner's do not.
    expect(
      sqlite
        .query(
          "SELECT open_outside, open_outside_capped FROM repository_merge_activity",
        )
        .get(),
    ).toEqual({ open_outside: 3, open_outside_capped: 0 });
    // A short open list needs no count-only page.
    expect(calls).toEqual(["open", "merged"]);
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    const body = (await response?.json()) as {
      projects: Array<{ repositories: Array<Record<string, unknown>> }>;
    };
    expect(body.projects[0].repositories[0]).toMatchObject({
      openOutside: 3,
      openOutsideCapped: false,
    });
    // The backlog rule reads the waiting count and the last merge too.
    expect((await readIntakeCounts(db)).get("asi")).toEqual([
      {
        openOutside: 3,
        waitingOutside: 1,
        lastMergedAt: daysAgo(1),
        observedAt: NOW.toISOString(),
      },
    ]);
  });

  test("open pull requests past the waiting pages are counted in lighter pages", async () => {
    const { db, sqlite } = d1();
    const calls: string[] = [];
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      // Two more pages: two ready and one draft, then one ready.
      github({ calls, more: [[false, false, true], [false]] }),
      NOW,
    );
    expect(
      sqlite
        .query(
          "SELECT open_outside, open_outside_capped, waiting_outside FROM repository_merge_activity",
        )
        .get(),
    ).toEqual({ open_outside: 6, open_outside_capped: 0, waiting_outside: 1 });
    expect(calls).toEqual(["open", "count", "count", "merged"]);
  });

  test("a count that runs out of pages is stored as a floor", async () => {
    const { db, sqlite } = d1();
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      github({ more: Array.from({ length: 9 }, () => [false]) }),
      NOW,
    );
    expect(
      sqlite
        .query(
          "SELECT open_outside, open_outside_capped FROM repository_merge_activity",
        )
        .get(),
    ).toEqual({ open_outside: 10, open_outside_capped: 1 });
  });

  test("a row read before the count was added serves no open count", async () => {
    const { db, sqlite } = d1();
    sqlite
      .query(
        `INSERT INTO repository_merge_activity
           (project_id, repository, observed_at, attempted_at, waiting_outside,
            waiting_capped, merged_outside_30d)
         VALUES ('asi', 'SlopDotCash/asi', ?, ?, 0, 0, 0)`,
      )
      .run(NOW.toISOString(), NOW.toISOString());
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    const body = (await response?.json()) as {
      projects: Array<{ repositories: Array<Record<string, unknown>> }>;
    };
    expect(body.projects[0].repositories[0]).toMatchObject({
      openOutside: null,
      openOutsideCapped: false,
    });
    // No open count pauses nothing by the intake cap; the waiting count
    // still serves the backlog rule.
    expect((await readIntakeCounts(db)).get("asi")).toEqual([
      {
        openOutside: null,
        waitingOutside: 0,
        lastMergedAt: null,
        observedAt: NOW.toISOString(),
      },
    ]);
  });

  test("a project with an intake cap is read again at the next hourly run", async () => {
    const { db } = d1();
    const capped = project("active", 20);
    await refreshMergeActivity(db, [capped], async () => "t", github(), NOW);
    const soon = new Date(NOW.getTime() + 30 * 60_000);
    expect(
      await refreshMergeActivity(db, [capped], async () => "t", github(), soon),
    ).toEqual({ read: 0, failed: 0 });
    const nextHour = new Date(NOW.getTime() + 60 * 60_000);
    expect(
      await refreshMergeActivity(
        db,
        [capped],
        async () => "t",
        github(),
        nextHour,
      ),
    ).toEqual({ read: 1, failed: 0 });
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

  test("a transferred repository is shown at its new path only", async () => {
    const { db } = d1();
    const before = project("active");
    await refreshMergeActivity(db, [before], async () => "t", github(), NOW);
    expect((await served(db)).map((row) => row.repository)).toEqual([
      "SlopDotCash/asi",
    ]);
    // The registry accepts this revision: the repository keeps its identity
    // and publishes the transfer as an appended alias.
    const after = transferred(before, "asi-research/asi");
    assertProjectPolicyTransition(before, after);
    const nextDay = new Date(NOW.getTime() + 21 * 3_600_000);
    expect(
      await refreshMergeActivity(
        db,
        [after],
        async () => "t",
        github(),
        nextDay,
      ),
    ).toEqual({ read: 1, failed: 0 });
    // The project pages sum these rows and date the line from the oldest
    // read, so the old path's frozen row must not remain.
    expect(await served(db)).toMatchObject([
      {
        repository: "asi-research/asi",
        observedAt: nextDay.toISOString(),
        waitingOutside: 1,
      },
    ]);
  });

  test("a paused project keeps the last values of the repositories it lists", async () => {
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
        [project("paused")],
        async () => "t",
        github(),
        nextDay,
      ),
    ).toEqual({ read: 0, failed: 0 });
    expect(await served(db)).toMatchObject([
      { repository: "SlopDotCash/asi", observedAt: NOW.toISOString() },
    ]);
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

/** The fixture project with wanted issues turned on (PRD section 5). */
function wantedProject() {
  const original = project("active");
  return assertProjectDefinition({
    ...original,
    slopbot: { automaticClosure: false, wantedIssues: true },
  });
}

/**
 * The ordinary fake GitHub plus the wanted-issue query: issue 7 is free, 9
 * already has an open closing pull request. `labels` records each label read.
 */
function githubWithWanted(labels: string[]): Fetch {
  const base = github();
  return async (url, init) => {
    const body = JSON.parse(String(init.body)) as {
      query: string;
      variables: { label?: string };
    };
    if (!body.query.includes("labels:[$label]")) return base(url, init);
    labels.push(String(body.variables.label));
    return Response.json({
      data: {
        repository: {
          issues: {
            nodes: [
              {
                number: 7,
                title: "Port the baseline to JAX 0.6",
                url: "https://github.com/SlopDotCash/asi/issues/7",
                closedByPullRequestsReferences: { totalCount: 0 },
              },
              {
                number: 9,
                title: "Seed-controlled comparison for PPO",
                url: "https://github.com/SlopDotCash/asi/issues/9",
                closedByPullRequestsReferences: { totalCount: 1 },
              },
            ],
          },
        },
      },
    });
  };
}

describe("wanted issues", () => {
  test("a project without wanted issues reads no label and creates none", async () => {
    const { db, sqlite } = d1();
    const labels: string[] = [];
    const ensured: string[] = [];
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      githubWithWanted(labels),
      NOW,
      async (repository) => {
        ensured.push(repository);
        return true;
      },
    );
    expect(labels).toEqual([]);
    expect(ensured).toEqual([]);
    expect(
      sqlite
        .query(
          "SELECT wanted_label, wanted_issues, wanted_label_ready FROM repository_merge_activity",
        )
        .get(),
    ).toEqual({
      wanted_label: null,
      wanted_issues: null,
      wanted_label_ready: null,
    });
  });

  test("the read lists labelled issues, creates the label once and serves the list", async () => {
    const { db, sqlite } = d1();
    const labels: string[] = [];
    const ensured: string[] = [];
    const ensure = async (repository: string, label: string) => {
      ensured.push(`${repository}:${label}`);
      return true;
    };
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      githubWithWanted(labels),
      NOW,
      ensure,
    );
    expect(labels).toEqual(["slop-wanted"]);
    expect(ensured).toEqual(["SlopDotCash/asi:slop-wanted"]);
    const response = await handleMergeActivityApi(
      new Request("https://slop.cash/api/v1/merge-activity"),
      { db },
    );
    const body = (await response?.json()) as {
      projects: Array<{ repositories: Array<Record<string, unknown>> }>;
    };
    expect(body.projects[0].repositories[0]).toMatchObject({
      wantedLabel: "slop-wanted",
      wantedIssues: [
        {
          number: 7,
          title: "Port the baseline to JAX 0.6",
          url: "https://github.com/SlopDotCash/asi/issues/7",
          openPullRequests: 0,
        },
        {
          number: 9,
          title: "Seed-controlled comparison for PPO",
          url: "https://github.com/SlopDotCash/asi/issues/9",
          openPullRequests: 1,
        },
      ],
    });
    // Six hours later the list is read again; the label is not checked again.
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      githubWithWanted(labels),
      new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
      ensure,
    );
    expect(labels).toEqual(["slop-wanted", "slop-wanted"]);
    expect(ensured).toEqual(["SlopDotCash/asi:slop-wanted"]);
    expect(
      sqlite
        .query("SELECT wanted_label_ready FROM repository_merge_activity")
        .get(),
    ).toEqual({ wanted_label_ready: "slop-wanted" });
  });

  test("a label that cannot be created keeps the list and is tried at the next read", async () => {
    const { db, sqlite } = d1();
    const labels: string[] = [];
    let attempts = 0;
    const failing = async () => {
      attempts += 1;
      throw new Error("github-500");
    };
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      githubWithWanted(labels),
      NOW,
      failing,
    );
    expect(
      sqlite
        .query(
          "SELECT failure, wanted_label, wanted_label_ready FROM repository_merge_activity",
        )
        .get(),
    ).toEqual({
      failure: null,
      wanted_label: "slop-wanted",
      wanted_label_ready: null,
    });
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      githubWithWanted(labels),
      new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
      failing,
    );
    expect(attempts).toBe(2);
  });

  test("turning wanted issues on reads the repository at the next run", async () => {
    const { db } = d1();
    const labels: string[] = [];
    await refreshMergeActivity(
      db,
      [project("active")],
      async () => "token",
      githubWithWanted(labels),
      NOW,
    );
    // An hour later an ordinary repository is not due for 20 hours, but the
    // owner just turned wanted issues on.
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      githubWithWanted(labels),
      new Date(NOW.getTime() + 60 * 60 * 1000),
    );
    expect(labels).toEqual(["slop-wanted"]);
  });

  test("an issue URL outside the repository fails the read instead of being stored", async () => {
    const { db, sqlite } = d1();
    const base = githubWithWanted([]);
    const foreign: Fetch = async (url, init) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      if (!body.query.includes("labels:[$label]")) return base(url, init);
      return Response.json({
        data: {
          repository: {
            issues: {
              nodes: [
                {
                  number: 7,
                  title: "Elsewhere",
                  url: "https://github.com/someone/else/issues/7",
                  closedByPullRequestsReferences: { totalCount: 0 },
                },
              ],
            },
          },
        },
      });
    };
    await refreshMergeActivity(
      db,
      [wantedProject()],
      async () => "token",
      foreign,
      NOW,
    );
    expect(
      sqlite
        .query("SELECT failure, wanted_issues FROM repository_merge_activity")
        .get(),
    ).toEqual({ failure: "github-wanted-issue-invalid", wanted_issues: null });
  });
});
