// Free advisory reviews are capped per repository and UTC calendar month
// (operator decision, 16 November 2026). Over the cap a review makes no model
// call and writes nothing to GitHub; the skip is recorded. Value assessment is
// a separate pipeline and is never refused by the cap. Local HTTP fixtures
// exercise the control only; synthetic verdicts do not qualify any model.

import type { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { findProject } from "../../src/lib/projects.mjs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import type { D1Database } from "./persistence";
import { type ReviewEnv, reviewItem } from "./review";
import {
  admitMonthlyReview,
  FREE_REVIEWS_PER_REPO_PER_MONTH,
  MONTHLY_REVIEW_CAP_REASON,
  reviewMonth,
} from "./review-cap";
import { runValueInference } from "./value-inference";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

/** Admitted items numbered from 1000, clear of the fixture pull request #5. */
function seedStarts(
  sqlite: Database,
  repositoryId: number,
  month: string,
  count: number,
) {
  const insert = sqlite.prepare(
    "INSERT INTO slopbot_review_month_starts(repository_id, month, item_kind, item_number, started_at) VALUES (?, ?, ?, ?, ?)",
  );
  sqlite.transaction(() => {
    for (let i = 0; i < count; i++)
      insert.run(
        repositoryId,
        month,
        i % 2 === 0 ? "pull_request" : "issue",
        1000 + i,
        `${month}-01T00:00:00.000Z`,
      );
  })();
}

function previousMonth(at: Date): string {
  return reviewMonth(
    new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 1, 15)),
  );
}

/** One active-project pull request whose review reaches a model call. */
async function reviewOnePull(
  seed: (sqlite: Database, repositoryId: number) => void,
) {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status: "active" });
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
  seed(sqlite, repositoryId);
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
          id: "local-monthly-cap",
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
                summary: "Synthetic monthly-cap verdict.",
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
        return Response.json({ permission: "read" });
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
    SURPLUS_API_KEY: "local-monthly-cap",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "monthly-cap",
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

test("the 2,001st distinct item of a repository in a month makes no model call and records the skip", async () => {
  const month = reviewMonth(new Date());
  const result = await reviewOnePull((sqlite, repositoryId) =>
    seedStarts(sqlite, repositoryId, month, FREE_REVIEWS_PER_REPO_PER_MONTH),
  );
  expect(result.outcome).toBe(MONTHLY_REVIEW_CAP_REASON);
  expect(result.prompts).toEqual([]);
  expect(result.comments).toEqual([]);
  expect(result.writes).toEqual([]);
  expect(result.review).toEqual({
    status: "skipped",
    action: null,
    skip_reason: MONTHLY_REVIEW_CAP_REASON,
  });
  expect(result.started).toBe(FREE_REVIEWS_PER_REPO_PER_MONTH);
});

test("the 2,000th distinct item of a month still runs and is counted once", async () => {
  const month = reviewMonth(new Date());
  const result = await reviewOnePull((sqlite, repositoryId) =>
    seedStarts(
      sqlite,
      repositoryId,
      month,
      FREE_REVIEWS_PER_REPO_PER_MONTH - 1,
    ),
  );
  expect(result.prompts).toHaveLength(1);
  expect(result.comments).toHaveLength(1);
  expect(result.review).toMatchObject({ status: "completed" });
  expect(result.started).toBe(FREE_REVIEWS_PER_REPO_PER_MONTH);
});

test("a re-review of an item admitted earlier this month runs after the cap is reached", async () => {
  const month = reviewMonth(new Date());
  const result = await reviewOnePull((sqlite, repositoryId) => {
    seedStarts(
      sqlite,
      repositoryId,
      month,
      FREE_REVIEWS_PER_REPO_PER_MONTH - 1,
    );
    // Pull request #5 was reviewed earlier this month at another revision.
    sqlite.run(
      "INSERT INTO slopbot_review_month_starts(repository_id, month, item_kind, item_number, started_at) VALUES (?, ?, 'pull_request', 5, ?)",
      [repositoryId, month, `${month}-01T00:00:00.000Z`],
    );
  });
  expect(result.prompts).toHaveLength(1);
  expect(result.comments).toHaveLength(1);
  expect(result.review).toMatchObject({ status: "completed" });
  expect(result.started).toBe(FREE_REVIEWS_PER_REPO_PER_MONTH);
});

test("another repository at its cap does not affect this one", async () => {
  const month = reviewMonth(new Date());
  const result = await reviewOnePull((sqlite, repositoryId) =>
    seedStarts(
      sqlite,
      repositoryId + 1,
      month,
      FREE_REVIEWS_PER_REPO_PER_MONTH,
    ),
  );
  expect(result.prompts).toHaveLength(1);
  expect(result.comments).toHaveLength(1);
  expect(result.review).toMatchObject({ status: "completed" });
  expect(result.started).toBe(1);
});

test("a full previous month does not count against the new month", async () => {
  const result = await reviewOnePull((sqlite, repositoryId) =>
    seedStarts(
      sqlite,
      repositoryId,
      previousMonth(new Date()),
      FREE_REVIEWS_PER_REPO_PER_MONTH,
    ),
  );
  expect(result.prompts).toHaveLength(1);
  expect(result.review).toMatchObject({ status: "completed" });
  expect(result.started).toBe(1);
});

test("admission counts an item once, refuses a new item at the cap and resets by month", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const d1 = db as unknown as D1Database;
  const november = new Date("2026-11-30T23:59:59.000Z");
  const december = new Date("2026-12-01T00:00:00.000Z");
  try {
    seedStarts(sqlite, 7, "2026-11", FREE_REVIEWS_PER_REPO_PER_MONTH - 1);
    expect(await admitMonthlyReview(d1, 7, "pull_request", 1, november)).toBe(
      true,
    );
    // New pushes, a moved base and retries review the same item again.
    expect(await admitMonthlyReview(d1, 7, "pull_request", 1, november)).toBe(
      true,
    );
    expect(
      await admitMonthlyReview(d1, 7, "pull_request", 1000, november),
    ).toBe(true);
    expect(await admitMonthlyReview(d1, 7, "issue", 2, november)).toBe(false);
    expect(await admitMonthlyReview(d1, 8, "issue", 2, november)).toBe(true);
    expect(await admitMonthlyReview(d1, 7, "issue", 2, december)).toBe(true);
    const rows = sqlite
      .query(
        "SELECT month, COUNT(*) AS n FROM slopbot_review_month_starts WHERE repository_id = 7 GROUP BY month ORDER BY month",
      )
      .all();
    expect(rows).toEqual([
      { month: "2026-11", n: FREE_REVIEWS_PER_REPO_PER_MONTH },
      { month: "2026-12", n: 1 },
    ]);
    // Parallel admissions of new items never pass the cap.
    seedStarts(sqlite, 9, "2026-11", FREE_REVIEWS_PER_REPO_PER_MONTH - 3);
    const admitted = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        admitMonthlyReview(d1, 9, "pull_request", i + 1, november),
      ),
    );
    expect(admitted.filter(Boolean)).toHaveLength(3);
  } finally {
    sqlite.close();
  }
});

test("value assessment is not refused by a repository at its review cap", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  seedStarts(
    sqlite,
    1,
    reviewMonth(new Date()),
    FREE_REVIEWS_PER_REPO_PER_MONTH,
  );
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++;
      const input = (await request.json()) as { model: string };
      return Response.json(
        {
          id: "local-value-under-review-cap",
          type: "message",
          role: "assistant",
          model: input.model,
          content: [{ type: "text", text: '{"accepted":true}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        { headers: { "x-si-buyer-cost-micro": "100" } },
      );
    },
  });
  try {
    const result = await runValueInference(
      {
        SURPLUS_API_KEY: "local-only",
        SURPLUS_BASE_URL: `http://127.0.0.1:${server.port}`,
      },
      {
        system: "Local monthly-cap value fixture",
        policy: "No publication",
        item: "No source material",
      },
      {
        sourceDigest: "e".repeat(64),
        name: "monthly_cap_value_fixture",
        schema: {
          type: "object",
          properties: { accepted: { type: "boolean" } },
          required: ["accepted"],
          additionalProperties: false,
        },
        validate: (value: unknown) =>
          (value as { accepted?: boolean })?.accepted === true
            ? { accepted: true }
            : null,
      },
      async () => true,
      {
        db,
        installationId: 1,
        attemptId: `value:${crypto.randomUUID()}`,
        maximumMicroUsd: 600,
        approvedMonthlyMicroUsd: 1000,
      },
    );
    expect(requests).toBe(1);
    expect(result.verdict).toEqual({ accepted: true });
  } finally {
    server.stop(true);
    sqlite.close();
  }
});
