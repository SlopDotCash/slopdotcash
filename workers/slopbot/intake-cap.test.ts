// A maintainer's intake cap (operator decision, 17 November 2026). While a
// project is over the cap its owner set, a pull request from an outside
// contributor that Slopbot has not reviewed before gets no model call and
// nothing on GitHub; the skip is recorded and uses no monthly review. Local
// HTTP fixtures exercise the control only; synthetic verdicts do not qualify
// any model.

import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { INTAKE_COUNT_MAX_AGE_MS } from "../../src/lib/intake-cap.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import { INTAKE_CAP_REASON, intakeCapRefuses } from "./intake-cap";
import type { D1Database } from "./persistence";
import { type ReviewEnv, reviewItem } from "./review";
import { reviewMonth } from "./review-cap";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** The stored open count of the project's repository, read `ageMs` ago. */
function seedCount(
  sqlite: Database,
  projectId: string,
  openOutside: number | null,
  ageMs = 60_000,
) {
  const at = new Date(Date.now() - ageMs).toISOString();
  sqlite.run(
    `INSERT INTO repository_merge_activity
       (project_id, repository, observed_at, attempted_at, waiting_outside,
        waiting_capped, merged_outside_30d, open_outside, open_outside_capped)
     VALUES (?, 'SlopDotCash/asi', ?, ?, 0, 0, 0, ?, 0)`,
    [projectId, at, at, openOutside],
  );
}

/** An earlier completed review of the fixture pull request #5 by author 42. */
function seedCompletedReview(sqlite: Database, repositoryId: number) {
  sqlite.run(
    `INSERT INTO slopbot_reviews
       (review_key, installation_id, repository_id, item_kind, item_number,
        item_node_id, author_id, revision, content_digest, policy_digest,
        status, created_at, completed_at)
     VALUES ('earlier', 1, ?, 'pull_request', 5, 'PR_local', 42, 'old', 'd',
        'p', 'completed', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:01.000Z')`,
    [repositoryId],
  );
}

/** One active-project pull request whose review reaches a model call. */
async function reviewOnePull(
  options: {
    intakeCap?: number;
    /** The pull request author's repository permission. */
    permission?: "read" | "write";
    seed?: (sqlite: Database, repositoryId: number, projectId: string) => void;
  } = {},
) {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({
    ...project,
    status: "active",
    ...(options.intakeCap === undefined
      ? {}
      : {
          slopbot: { automaticClosure: false, intakeCap: options.intakeCap },
        }),
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-10-21T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
    [project.id, manifest, digest, at, at],
  );
  const [owner, repo] = new URL(project.repositories[0].githubUrl).pathname
    .slice(1)
    .split("/");
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
    [`${owner}/${repo}`.toLowerCase(), project.id],
  );
  sqlite.run(
    "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
    [owner, at],
  );
  const repositoryId = Number(project.authority.repositoryId);
  options.seed?.(sqlite, repositoryId, project.id);
  const writes: string[] = [];
  const prompts: string[] = [];
  const comments: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages") {
        const body = (await request.json()) as {
          messages: { content: { text: string }[] }[];
        };
        prompts.push(body.messages[0].content[1].text);
        return Response.json({
          id: "local-intake-cap",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: "none",
                confidence: 0.6,
                rule_refs: [],
                evidence: [],
                summary: "Synthetic intake-cap verdict.",
                limitations: [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: false,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      if (path.endsWith("/issues/5") && request.method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state: "open",
          title: "small change",
          body: "Made via @slopdotcash",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          pull_request: {},
        });
      if (path.endsWith("/pulls/5"))
        return Response.json({
          draft: false,
          merged: false,
          head: { sha: "b".repeat(40) },
          base: {
            sha: "a".repeat(40),
            ref: "development",
            repo: { id: repositoryId },
          },
          additions: 1,
          deletions: 0,
          changed_files: 1,
        });
      if (
        path.endsWith("/branches/main") ||
        path.endsWith("/branches/development")
      )
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: "c".repeat(40) },
          merge_base_commit: { sha: "c".repeat(40) },
          files: [
            {
              filename: "current-0.ts",
              status: "modified",
              patch: "+actual current change",
            },
          ],
        });
      if (path.endsWith("/permission"))
        return Response.json({ permission: options.permission ?? "read" });
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([]);
      if (path.endsWith("/issues/5/comments")) {
        comments.push(((await request.json()) as { body: string }).body);
        return Response.json({ id: 900 }, { status: 201 });
      }
      return new Response(null, { status: 404 });
    },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    if (u.origin === server.url.origin) return nativeFetch(url, init);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const env = {
    SLOPBOT_DB: db as unknown as D1Database,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
    SURPLUS_API_KEY: "local-intake-cap",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "intake-cap",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request",
    number: 5,
  };
  try {
    const outcome = await reviewItem(env, job);
    const review = sqlite
      .query(
        "SELECT status, action, skip_reason FROM slopbot_reviews WHERE item_node_id = 'PR_local'",
      )
      .get();
    const started = sqlite
      .query(
        "SELECT COUNT(*) AS n FROM slopbot_review_month_starts WHERE repository_id = ? AND month = ?",
      )
      .get(repositoryId, reviewMonth(new Date())) as { n: number };
    return {
      outcome,
      review,
      prompts,
      comments,
      started: started.n,
      writes: writes.filter(
        (w) => !w.endsWith("/access_tokens") && w !== "POST /v1/messages",
      ),
    };
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

const SKIPPED = {
  status: "skipped",
  action: null,
  skip_reason: INTAKE_CAP_REASON,
};

test("a new outside pull request of a project at its intake cap makes no model call and records the skip", async () => {
  const result = await reviewOnePull({
    intakeCap: 20,
    seed: (sqlite, _repositoryId, projectId) =>
      seedCount(sqlite, projectId, 20),
  });
  expect(result.outcome).toBe(INTAKE_CAP_REASON);
  expect(result.prompts).toEqual([]);
  expect(result.comments).toEqual([]);
  expect(result.writes).toEqual([]);
  expect(result.review).toEqual(SKIPPED);
  // The skipped item uses none of the month's free reviews.
  expect(result.started).toBe(0);
});

test("below the cap the review runs as before", async () => {
  const result = await reviewOnePull({
    intakeCap: 20,
    seed: (sqlite, _repositoryId, projectId) =>
      seedCount(sqlite, projectId, 19),
  });
  expect(result.outcome).not.toBe(INTAKE_CAP_REASON);
  expect(result.prompts.length).toBeGreaterThan(0);
  expect(result.review).toMatchObject({ status: "completed" });
  expect(result.started).toBe(1);
});

test("a project without the setting is reviewed whatever its open count", async () => {
  const result = await reviewOnePull({
    seed: (sqlite, _repositoryId, projectId) =>
      seedCount(sqlite, projectId, 5_000),
  });
  expect(result.prompts.length).toBeGreaterThan(0);
  expect(result.review).toMatchObject({ status: "completed" });
});

test("a pull request Slopbot reviewed before the pause keeps its reviews", async () => {
  const result = await reviewOnePull({
    intakeCap: 20,
    seed: (sqlite, repositoryId, projectId) => {
      seedCount(sqlite, projectId, 45);
      seedCompletedReview(sqlite, repositoryId);
    },
  });
  expect(result.prompts.length).toBeGreaterThan(0);
  expect(result.review).toMatchObject({ status: "completed" });
});

test("a maintainer's own pull request is not refused by the cap", async () => {
  const result = await reviewOnePull({
    intakeCap: 20,
    permission: "write",
    seed: (sqlite, _repositoryId, projectId) =>
      seedCount(sqlite, projectId, 45),
  });
  expect(result.outcome).not.toBe(INTAKE_CAP_REASON);
  expect(result.review).not.toEqual(SKIPPED);
});

test("a count that was never read, or is older than three days, refuses nothing", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const d1 = db as unknown as D1Database;
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({
    ...project,
    status: "active",
    slopbot: { automaticClosure: false, intakeCap: 20 },
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-10-21T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,'active',1,?,?,?,?)",
    [project.id, manifest, digest, at, at],
  );
  const refuses = () => intakeCapRefuses(d1, project.id, 7, 42, 5);
  try {
    // No stored row.
    expect(await refuses()).toBe(false);
    // A row read before the count existed.
    seedCount(sqlite, project.id, null);
    expect(await refuses()).toBe(false);
    sqlite.run("DELETE FROM repository_merge_activity");
    // A stale count, such as after Slopbot was uninstalled.
    seedCount(sqlite, project.id, 45, INTAKE_COUNT_MAX_AGE_MS + 60_000);
    expect(await refuses()).toBe(false);
    sqlite.run("DELETE FROM repository_merge_activity");
    seedCount(sqlite, project.id, 45);
    expect(await refuses()).toBe(true);
    // Another project's count is never read.
    expect(await intakeCapRefuses(d1, "other-project", 7, 42, 5)).toBe(false);
  } finally {
    sqlite.close();
  }
});
