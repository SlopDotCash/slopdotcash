// An uncertain finding goes to the maintainer first (PRD section 5). The real
// worker runs against the real migrations, a local synthetic GitHub server and
// a local synthetic model endpoint; nothing leaves this process.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import worker from "./index";
import type { D1TransactionalDatabase } from "./persistence";
import { type ReviewEnv, reviewItem } from "./review";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

afterEach(() => setSystemTime());

async function uncertainReview(
  maintainerComments: boolean,
  cb: (run: {
    review: () => Promise<string>;
    tick: () => Promise<Job[]>;
    deliver: (jobs: Job[]) => Promise<void>;
    setDraft: (v: boolean) => void;
    writes: string[];
    labels: { name: string }[];
    sql: (q: string) => unknown;
  }) => Promise<void>,
  confidence = 0.6,
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
  let pullDraft = false;
  const writes: string[] = [];
  const labels: { name: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      if (request.method !== "GET") writes.push(`${request.method} ${path}`);
      if (path === "/v1/messages")
        return Response.json({
          id: "msg_local",
          type: "message",
          role: "assistant",
          model: "claude-opus-5.5",
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                category: "busywork",
                confidence,
                rule_refs: [],
                evidence: [],
                summary: "This change may be busywork.",
                limitations: [],
                objective_defect: null,
              }),
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10 },
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
      if (path.endsWith("/issues/5") && request.method === "GET")
        return Response.json({
          node_id: "PR_local",
          number: 5,
          state: "open",
          title: "rename a variable",
          body: "Small rename.",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          labels,
        });
      if (path.endsWith("/pulls/5"))
        return Response.json({
          draft: pullDraft,
          merged: false,
          head: { sha: "b".repeat(40) },
          base: { sha: "c".repeat(40) },
          additions: 1,
          deletions: 1,
          changed_files: 1,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.endsWith("/pulls/5/files"))
        return Response.json(
          url.searchParams.get("page") === "1" || !url.searchParams.has("page")
            ? [
                {
                  filename: "a.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 1,
                  patch: "-const a = 1;\n+const b = 1;",
                },
              ]
            : [],
        );
      if (path.endsWith("/permission"))
        return Response.json({
          permission: path.includes("/maintainer/") ? "write" : "read",
        });
      if (path.endsWith("/issues/5/timeline"))
        return Response.json([
          {
            event: "commented",
            created_at: new Date().toISOString(),
            actor: { login: "author", id: 42 },
          },
          ...(maintainerComments
            ? [
                {
                  event: "commented",
                  created_at: new Date().toISOString(),
                  actor: { login: "maintainer", id: 43 },
                },
              ]
            : []),
          {
            event: "commented",
            created_at: new Date().toISOString(),
            actor: { login: "slopbot[bot]", id: 999 },
          },
        ]);
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([]);
      if (path.endsWith("/issues/5/comments"))
        return Response.json({ id: 900 }, { status: 201 });
      if (path.endsWith("/issues/5/labels")) {
        const body = (await request.json()) as { labels: string[] };
        for (const name of body.labels) labels.push({ name });
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
    if (u.origin === new URL(server.url).origin) return nativeFetch(url, init);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const sent: Job[] = [];
  const env = {
    SLOPBOT_DB: db as unknown as D1TransactionalDatabase,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
    SURPLUS_API_KEY: "local-synthetic-key",
    SURPLUS_BASE_URL: server.url.origin,
    SLOPBOT_QUEUE: { send: async (job: Job) => void sent.push(job) },
  };
  const job: Extract<Job, { kind: "review" }> = {
    kind: "review",
    deliveryId: "hold-review",
    installationId: 1,
    repositoryId,
    owner,
    repo,
    itemKind: "pull_request",
    number: 5,
  };
  type Worker = {
    scheduled(event: unknown, env: unknown): Promise<void>;
    queue(batch: unknown, env: unknown): Promise<void>;
  };
  try {
    await cb({
      writes,
      labels,
      setDraft: (v: boolean) => {
        pullDraft = v;
      },
      review: () => reviewItem(env as unknown as ReviewEnv, job),
      tick: async () => {
        sent.length = 0;
        await (worker as unknown as Worker).scheduled({}, env);
        return [...sent];
      },
      deliver: async (jobs) => {
        await (worker as unknown as Worker).queue(
          {
            messages: jobs.map((body) => ({
              body,
              ack() {},
              retry() {
                throw new Error("hold job was retried");
              },
            })),
          },
          env,
        );
      },
      sql: (q) => sqlite.query(q).all(),
    });
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
}

const day = 24 * 60 * 60 * 1000;

test("an uncertain finding waits 7 days for the maintainer, then is labeled once and never closed", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(
      /^held for maintainer until .+ \(busywork\)$/,
    );
    expect(run.writes).toContain(
      "POST /repos/SlopDotCash/asi/issues/5/comments",
    );
    expect(run.writes.some((w) => w.endsWith("/labels"))).toBe(false);
    expect(run.sql("SELECT status, action FROM slopbot_reviews")).toEqual([
      { status: "completed", action: "hold" },
    ]);

    // Before the 7-day window ends, nothing is queued.
    setSystemTime(new Date(start + 6 * day));
    expect(await run.tick()).toEqual([]);

    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["maintainer_hold"]);
    await run.deliver(due);
    expect(run.writes.filter((w) => w.endsWith("/labels"))).toEqual([
      "POST /repos/SlopDotCash/asi/issues/5/labels",
    ]);
    // Owner decision D8: one uncertain label; the verdict stays in the comment.
    expect(run.labels).toEqual([{ name: "slopbot:uncertain" }]);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "labeled" },
    ]);

    // A replayed message and the next scheduler run add nothing.
    await run.deliver(due);
    setSystemTime(new Date(start + 9 * day));
    expect(await run.tick()).toEqual([]);
    expect(run.writes.filter((w) => w.endsWith("/labels"))).toHaveLength(1);
    expect(
      run.writes.some((w) =>
        w.startsWith("PATCH /repos/SlopDotCash/asi/pulls/"),
      ),
    ).toBe(false);
    expect(run.sql("SELECT action FROM slopbot_actions ORDER BY id")).toEqual([
      { action: "comment" },
      { action: "label" },
    ]);
  });
});

test("a maintainer who acts inside the window keeps the decision; Slopbot adds no label", async () => {
  await uncertainReview(true, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(/^held for maintainer until /);
    setSystemTime(new Date(start + 8 * day));
    await run.deliver(await run.tick());
    expect(run.writes.some((w) => w.endsWith("/labels"))).toBe(false);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "maintainer_acted" },
    ]);
  });
});

test("a label-only finding without cited evidence waits even at high confidence", async () => {
  await uncertainReview(
    false,
    async (run) => {
      expect(await run.review()).toMatch(/^held for maintainer until /);
      expect(run.writes.some((w) => w.endsWith("/labels"))).toBe(false);
      expect(run.sql("SELECT status, action FROM slopbot_reviews")).toEqual([
        { status: "completed", action: "hold" },
      ]);
    },
    0.99,
  );
});

test("a pull request converted to draft during the window is not labeled", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(/^held for maintainer until /);
    // The author converts the pull request back to draft before the window
    // ends; the head SHA the hold recorded does not change.
    run.setDraft(true);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["maintainer_hold"]);
    await run.deliver(due);
    expect(run.writes.filter((w) => w.endsWith("/labels"))).toEqual([]);
    expect(run.labels).toEqual([]);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "superseded" },
    ]);
    expect(run.sql("SELECT action FROM slopbot_actions ORDER BY id")).toEqual([
      { action: "comment" },
    ]);
  });
});
