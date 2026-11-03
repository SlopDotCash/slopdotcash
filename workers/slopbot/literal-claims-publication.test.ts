// Issue #1930: a low_quality finding that calls a well-formed 64-character
// digest, or a 0x integer literal, invalid must not be published. The negative
// control is a finding that makes no such claim, which still publishes.
// Local HTTP fixtures exercise the publication boundary only; synthetic
// verdicts do not qualify model correctness.
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

// The digest pinned by pumpfun-source #3297, #3302, #3303 and #3392.
const DIGEST =
  "8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697";
const RULE =
  "Keep descriptions specific to the actual diff; tests and line counts alone";
const DIFF_LINE = `+pinned sha256 ${DIGEST}`;

async function reviewFinding(
  summary: string,
  overrides: { category?: string; evidence?: string[] } = {},
) {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status: "active" });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-10-31T00:00:00.000Z";
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
  const baseSha = "c".repeat(40);
  const headSha = "b".repeat(40);
  const comments: string[] = [];
  const writes: string[] = [];
  const labels: { name: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages")
        return Response.json({
          id: "local-publication-control",
          type: "message",
          role: "assistant",
          model: "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: overrides.category ?? "low_quality",
                confidence: 0.9,
                rule_refs: [{ source: "CONTRIBUTING.md", quote: RULE }],
                evidence: overrides.evidence ?? [DIFF_LINE],
                summary,
                limitations: [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: false,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      if (path === `/repos/${owner}/${repo}/contents/CONTRIBUTING.md`)
        return Response.json({
          type: "file",
          size: RULE.length,
          encoding: "base64",
          content: Buffer.from(`${RULE}.\n`).toString("base64"),
        });
      if (path === `/repos/${owner}/${repo}/issues/7`)
        return Response.json({
          node_id: "PR_literal",
          number: 7,
          state: "open",
          title: "Pin the SPL Token ELF digest",
          body: "Made via @slopdotcash",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          pull_request: {},
        });
      if (path === `/repos/${owner}/${repo}/pulls/7`)
        return Response.json({
          draft: false,
          merged: false,
          head: { sha: headSha },
          base: {
            sha: baseSha,
            ref: "main",
            repo: { id: repositoryId },
          },
          additions: 1,
          deletions: 0,
          changed_files: 1,
        });
      if (path === `/repos/${owner}/${repo}/branches/main`)
        return Response.json({ commit: { sha: baseSha } });
      if (path === `/repos/${owner}/${repo}/compare/${baseSha}...${headSha}`)
        return Response.json({
          base_commit: { sha: baseSha },
          merge_base_commit: { sha: baseSha },
          files: [
            {
              filename: "evidence/dependencies/spl_token/DIGEST.md",
              status: "modified",
              patch: DIFF_LINE,
            },
          ],
        });
      if (path.endsWith("/permission"))
        return Response.json({ permission: "read" });
      if (path === `/repos/${owner}/${repo}/issues/7/comments`)
        if (request.method === "GET") return Response.json([]);
        else {
          comments.push(((await request.json()) as { body: string }).body);
          return Response.json({ id: 900 }, { status: 201 });
        }
      if (path === `/repos/${owner}/${repo}/issues/7/labels`)
        if (request.method === "GET") return Response.json(labels);
        else {
          const body = (await request.json()) as { labels: string[] };
          for (const name of body.labels)
            if (!labels.some((entry) => entry.name === name))
              labels.push({ name });
          return Response.json(labels);
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
    SURPLUS_API_KEY: "local-publication-control",
    SURPLUS_BASE_URL: server.url.origin,
  } as ReviewEnv;
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "literal-claim",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request",
    number: 7,
  };
  try {
    const outcome = await reviewItem(env, job);
    const review = sqlite
      .query(
        "SELECT status, action FROM slopbot_reviews WHERE item_node_id = 'PR_literal'",
      )
      .get();
    return { outcome, review, comments, writes };
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

test("a finding that rejects a pinned sha256 digest is not published", async () => {
  const result = await reviewFinding(
    `The pinned digest ${DIGEST} is not a sha256 hex value, so the hash assertion should fail.`,
  );
  expect(result.review).toEqual({ status: "completed", action: "comment" });
  expect(result.comments).toHaveLength(1);
  expect(result.comments[0]).toContain("no finding");
  expect(result.comments[0]).not.toContain("low_quality");
  expect(result.writes.some((write) => write.endsWith("/labels"))).toBe(false);
});

test("a finding that calls a 0x integer literal an undefined name is not published", async () => {
  const result = await reviewFinding(
    "The slice assigns `SLOT_TOKEN_SIDE` to an undefined name, `0xF4`, where 0xF4 appears intended.",
  );
  expect(result.review).toEqual({ status: "completed", action: "comment" });
  expect(result.comments[0]).toContain("no finding");
  expect(result.comments[0]).not.toContain("low_quality");
});

test("a finding that makes no literal claim still publishes for the maintainer", async () => {
  const result = await reviewFinding(
    "The module assigns the mask to an undefined name `TOKEN_SIDE`, so importing it raises NameError.",
  );
  // Weak low_quality work is label-only (review prompt rule 1), so an
  // unrefuted finding takes the label path rather than a maintainer hold.
  expect(result.review).toEqual({ status: "completed", action: "label" });
  expect(result.comments[0]).toContain("`low_quality`");
  expect(result.comments[0]).toContain("undefined name `TOKEN_SIDE`");
  expect(result.comments[0]).not.toContain("no finding");
});

// #2201 review (nh0cksh0ck02, finding 2): the refutation can sit in the
// evidence rather than the summary, so the gate has to read both.
test("a refuted digest claim placed in evidence is not published", async () => {
  const result = await reviewFinding(
    "Invalid hash provided for the pinned digest.",
    {
      evidence: [`The digest ${DIGEST} is not a sha256 hex value.`],
    },
  );
  expect(result.review).toEqual({ status: "completed", action: "comment" });
  expect(result.comments[0]).toContain("no finding");
  expect(result.comments[0]).not.toContain("low_quality");
});

// #2201 review (nh0cksh0ck02, finding 2): a misread is a misread whatever
// category the model picked, so the gate is not limited to low_quality.
test("a refuted literal claim under another category is not published", async () => {
  const result = await reviewFinding(
    "The diff introduces an undefined name `0xF4`, so the module cannot import.",
    { category: "missing_evidence" },
  );
  expect(result.review).toEqual({ status: "completed", action: "comment" });
  expect(result.comments[0]).toContain("no finding");
  expect(result.comments[0]).not.toContain("missing_evidence");
});

// #2201 review (remarbical, finding 2): the undefined-name claim is about a
// different token, so the legitimate finding must still publish.
test("an undefined name claim about another token still publishes", async () => {
  const result = await reviewFinding(
    "The module assigns the mask to an undefined name `TOKEN_SIDE`, raising NameError; the intended fix is `SLOT_TOKEN_SIDE=0xF4`.",
  );
  expect(result.review).toEqual({ status: "completed", action: "label" });
  expect(result.comments[0]).toContain("`low_quality`");
  expect(result.comments[0]).not.toContain("no finding");
});
