// A pending close attempt whose owner died must not block the item forever.
// Repro for: after a transient GitHub close failure (5xx/timeout), the
// attempt stays 'pending' with no expiry; every later review of the still-open
// item throws ReviewBusyError, the queue retries 5 times and drops the job to
// the DLQ (max_retries = 5, no DLQ consumer), and no scheduled job ever
// re-drives it. The item becomes permanently unreviewable and the attempt
// permanently consumes one daily-close-cap slot.
// Local fixtures only: real migrations via sqliteD1, synthetic GitHub/model.
import { expect, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import type { D1Database } from "./persistence";
import { type ReviewEnv, reviewItem } from "./review";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

async function reviewWithStalePendingClose(leaseExpired: boolean) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
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
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
    [project.id, "active", manifest, digest, at, at],
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
  // The earlier review reserved a close, then its GitHub close request failed
  // transiently (5xx/timeout: no authoritative refusal, so no rejectClose).
  // Its review row is left 'running'; the lease is either still live (the
  // owner may still be in flight) or long expired (the owner is dead).
  const lease = leaseExpired
    ? "2026-10-21T00:00:00.000Z"
    : "2999-01-01T00:00:00.000Z";
  sqlite.run(
    `INSERT INTO slopbot_reviews
      (review_key,installation_id,repository_id,item_kind,item_number,item_node_id,author_id,
       revision,content_digest,policy_digest,status,created_at,claim_token,lease_expires_at)
      VALUES ('old-close-key',1,?,'pull_request',5,'PR_local',42,?,?,?,'running',?, 'old-token', ?)`,
    [
      repositoryId,
      "b".repeat(40),
      createHash("sha256").update("old item").digest("hex"),
      "old-policy",
      at,
      lease,
    ],
  );
  sqlite.run(
    `INSERT INTO slopbot_close_attempts
      (attempt_id,review_key,repository_id,project_id,item_node_id,author_id,revision,
       recovery_json,penalty_eligible,state,created_at)
      VALUES ('old-attempt', 'old-close-key', ?, ?, 'PR_local', 42, ?, ?, 0, 'pending', ?)`,
    [
      repositoryId,
      project.id,
      "b".repeat(40),
      JSON.stringify({
        verdict: { category: "busywork", confidence: 0.6 },
        triage: null,
        confirm: null,
      }),
      at,
    ],
  );
  const writes: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages") {
        return Response.json({
          id: "local-pending-close",
          type: "message",
          role: "assistant",
          model: "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: "busywork",
                confidence: 0.6,
                rule_refs: [],
                evidence: [],
                summary: "Synthetic input-control verdict.",
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
          title: "empty change",
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
            sha: "c".repeat(40),
            ref: "main",
            repo: { id: repositoryId },
          },
          additions: 0,
          deletions: 0,
          changed_files: 0,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.endsWith("/pulls/5/files")) return Response.json([]);
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: "c".repeat(40) },
          merge_base_commit: { sha: "c".repeat(40) },
          files: [],
        });
      if (path.endsWith("/permission"))
        return Response.json({ permission: "read" });
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([]);
      if (path.endsWith("/issues/5/comments"))
        return Response.json({ id: 900 }, { status: 201 });
      if (path.endsWith("/issues/5/labels"))
        return Response.json([{ name: "slopbot: empty" }]);
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
    SURPLUS_API_KEY: "local-pending-close",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "pending-close-1",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request",
    number: 5,
  };
  try {
    let outcome: string;
    try {
      outcome = await reviewItem(env, job);
    } catch (error) {
      outcome = String(error);
    }
    const attempt = sqlite
      .query(
        "SELECT state FROM slopbot_close_attempts WHERE attempt_id = 'old-attempt'",
      )
      .get() as { state: string };
    const review = sqlite
      .query(
        "SELECT status, action FROM slopbot_reviews WHERE item_node_id = 'PR_local' AND review_key != 'old-close-key'",
      )
      .get() as { status: string; action: string } | null;
    return { outcome, attemptState: attempt.state, review, writes };
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

test("a pending close whose owner lease expired is rejected and the item is reviewed", async () => {
  const result = await reviewWithStalePendingClose(true);
  expect(result.attemptState).toBe("rejected");
  expect(result.review).toEqual({ status: "completed", action: "label" });
  expect(result.outcome).toContain("labeled (empty)");
});

test("a pending close whose owner lease is still live keeps the item waiting", async () => {
  const result = await reviewWithStalePendingClose(false);
  expect(result.outcome).toContain(
    "Review is still claimed by another attempt",
  );
  expect(result.attemptState).toBe("pending");
  expect(result.review).toBeNull();
});
