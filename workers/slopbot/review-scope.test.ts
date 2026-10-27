// A paused project keeps security review only (PRD section 5): a non-security
// finding writes nothing to GitHub, while the same item on an active project
// is labeled. Local HTTP fixtures exercise input and action controls only;
// synthetic verdicts do not qualify model correctness.
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

type SourceCase =
  | "current"
  | "moved"
  | "missing"
  | "saturated"
  | "wrong-repo"
  | "unavailable"
  | "wrong-comparison"
  | "missing-pull"
  | "changed-original";

async function reviewEmptyPull(
  status: "active" | "paused",
  source?: SourceCase,
) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-10-21T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
    [project.id, status, manifest, digest, at, at],
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
  if (source === "changed-original") {
    // A stored equal digest is only a candidate: the original has since changed.
    const priorItem =
      "Title: empty change\n\nBody:\nMade via @slopdotcash\n\nDiff:\n--- current-0.ts (modified)\n+actual current change\n";
    sqlite.run(
      `INSERT INTO slopbot_reviews
      (review_key,installation_id,repository_id,item_kind,item_number,item_node_id,author_id,
       revision,content_digest,policy_digest,status,action,created_at)
      VALUES ('prior',1,?,'pull_request',6,'PR_prior',42,?,?,?,'completed','none',?)`,
      [
        repositoryId,
        "e".repeat(40),
        createHash("sha256").update(priorItem).digest("hex"),
        "old-policy",
        at,
      ],
    );
  }
  const writes: string[] = [];
  const reads: string[] = [];
  const prompts: string[] = [];
  let targetSha = "c".repeat(40);
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      else reads.push(path);
      if (path === "/v1/messages") {
        const body = (await request.json()) as {
          messages: { content: { text: string }[] }[];
        };
        prompts.push(body.messages[0].content[1].text);
        if (source === "moved") targetSha = "d".repeat(40);
        return Response.json({
          id: "local-input-control",
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
      if (
        (path.endsWith("/issues/5") || path.endsWith("/issues/6")) &&
        request.method === "GET"
      )
        return Response.json({
          node_id: path.endsWith("/issues/6") ? "PR_prior" : "PR_local",
          number: path.endsWith("/issues/6") ? 6 : 5,
          state: "open",
          title: "empty change",
          body: "Made via @slopdotcash",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          pull_request: {},
        });
      if (path.endsWith("/pulls/5") || path.endsWith("/pulls/6"))
        if (source === "missing-pull")
          return new Response(null, { status: 404 });
        else
          return Response.json({
            draft: false,
            merged: false,
            head: { sha: (path.endsWith("/pulls/6") ? "e" : "b").repeat(40) },
            base: {
              sha: source ? "a".repeat(40) : targetSha,
              ref: source ? "development" : "main",
              repo: {
                id: source === "wrong-repo" ? repositoryId + 1 : repositoryId,
              },
            },
            additions: 0,
            deletions: 0,
            changed_files: 0,
          });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.endsWith("/branches/development"))
        return Response.json({ commit: { sha: targetSha } });
      if (path.endsWith("/pulls/5/files"))
        return Response.json([
          {
            filename: "inherited-payments.ts",
            status: "modified",
            patch: "+inherited",
          },
        ]);
      if (path.includes("/compare/"))
        if (source === "unavailable")
          return new Response(null, { status: 404 });
        else
          return Response.json({
            base_commit: {
              sha: source === "wrong-comparison" ? "f".repeat(40) : targetSha,
            },
            merge_base_commit: { sha: "c".repeat(40) },
            files: !source
              ? []
              : Array.from(
                  { length: source === "saturated" ? 300 : 1 },
                  (_, i) => ({
                    filename: path.endsWith("e".repeat(40))
                      ? "changed-original.ts"
                      : `current-${i}.ts`,
                    status: "modified",
                    ...(source === "missing"
                      ? {}
                      : { patch: "+actual current change" }),
                  }),
                ),
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
    SURPLUS_API_KEY: "local-input-control",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: `scope-${status}`,
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
    const review = sqlite
      .query(
        "SELECT status, action FROM slopbot_reviews WHERE item_node_id = 'PR_local'",
      )
      .get();
    return { outcome, writes, review, prompts, reads };
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

test("a paused project gets security review only and no contributor-work action", async () => {
  const paused = await reviewEmptyPull("paused");
  expect(paused.outcome).toBe("no action (empty; security review only)");
  expect(paused.review).toEqual({ status: "completed", action: "none" });
  expect(paused.writes.filter((w) => !w.endsWith("/access_tokens"))).toEqual(
    [],
  );

  const active = await reviewEmptyPull("active");
  expect(active.outcome).toBe("labeled (empty)");
  expect(active.review).toEqual({ status: "completed", action: "label" });
  expect(active.writes).toContain(
    "POST /repos/SlopDotCash/asi/issues/5/labels",
  );
});

test("current target comparison replaces stale PR files and stale zero-file metadata", async () => {
  const result = await reviewEmptyPull("active", "current");
  expect(result.prompts).toHaveLength(1);
  expect(result.prompts[0]).toContain("current-0.ts");
  expect(result.prompts[0]).not.toContain("inherited-payments.ts");
  expect(result.outcome).toContain("held for maintainer");
  expect(result.review).toEqual({ status: "completed", action: "hold" });
});

test("target movement after review prevents even an advisory write", async () => {
  const result = await reviewEmptyPull("active", "moved");
  expect(result.prompts).toHaveLength(1);
  expect(result.outcome).toBe(
    "review source or authorization changed before action",
  );
  expect(result.review).toEqual({ status: "failed", action: "none" });
  expect(
    result.writes.filter(
      (w) => !w.endsWith("/access_tokens") && w !== "POST /v1/messages",
    ),
  ).toEqual([]);
});

test.each([
  "missing",
  "saturated",
  "wrong-repo",
  "unavailable",
  "wrong-comparison",
] as const)(
  "%s source cannot reach a model or GitHub action",
  async (source) => {
    const result = await reviewEmptyPull("active", source);
    expect(result.outcome).toContain(
      source === "wrong-repo"
        ? "target identity is unavailable"
        : source === "missing" || source === "saturated"
          ? "comparison is incomplete"
          : "comparison is unavailable",
    );
    expect(result.prompts).toEqual([]);
    expect(result.review).toBeNull();
    expect(result.writes.filter((w) => !w.endsWith("/access_tokens"))).toEqual(
      [],
    );
  },
);

test("an equal stored digest cannot label a changed original as a duplicate", async () => {
  const result = await reviewEmptyPull("active", "changed-original");
  expect(result.reads).toContain(
    `/repos/SlopDotCash/asi/compare/${"c".repeat(40)}...${"e".repeat(40)}`,
  );
  expect(result.prompts).toHaveLength(1);
  expect(result.outcome).toContain("held for maintainer");
  expect(result.review).toEqual({ status: "completed", action: "hold" });
});

test("an unavailable PR cannot be reviewed as an issue without its source", async () => {
  const result = await reviewEmptyPull("active", "missing-pull");
  expect(result.outcome).toBe("item or repository not readable");
  expect(result.prompts).toEqual([]);
  expect(result.review).toBeNull();
  expect(result.writes.filter((w) => !w.endsWith("/access_tokens"))).toEqual(
    [],
  );
});
