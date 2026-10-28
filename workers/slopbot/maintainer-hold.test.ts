// An uncertain finding goes to the maintainer first (PRD section 5). The real
// worker runs against the real migrations, a local synthetic GitHub server and
// a local synthetic model endpoint; nothing leaves this process.
import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { enqueueReopen } from "../../tests/slopbot-reopen-fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Category, Job } from "./contracts";
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
    setMaintainerComments: (value: boolean) => void;
    setExtraTimeline: (entries: Record<string, unknown>[]) => void;
    setVerdict: (category: Category, nextConfidence: number) => void;
    job: (kind: string, extra: Record<string, unknown>) => Job;
    reopen: () => Promise<Job>;
    interleave: (
      at: "issue" | "timeline" | "add",
      callback: () => Promise<void>,
    ) => void;
    loseLabelResponse: (method: "POST" | "DELETE") => void;
    writes: string[];
    labels: { name: string }[];
    sql: (q: string) => unknown;
    advanceTarget: (changedSource: boolean) => void;
    pushUnpatchedFile: (newHead: boolean) => void;
    deleteTargetBranch: (closesPullRequest: boolean) => void;
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
  let extraTimeline: Record<string, unknown>[] = [];
  let currentCategory: Category = "busywork";
  let currentConfidence = confidence;
  const interleavings = new Map<string, () => Promise<void>>();
  const lostResponses = new Set<string>();
  const interleave = async (at: string) => {
    const callback = interleavings.get(at);
    interleavings.delete(at);
    await callback?.();
  };
  const writes: string[] = [];
  const labels: { name: string }[] = [];
  let targetSha = "c".repeat(40);
  let headSha = "b".repeat(40);
  let patch: string | undefined = "-const a = 1;\n+const b = 1;";
  let targetBranch = true;
  let itemState = "open";
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
                category: currentCategory,
                confidence: currentConfidence,
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
      if (path.endsWith("/issues/5") && request.method === "GET") {
        const issue = {
          node_id: "PR_local",
          number: 5,
          state: itemState,
          title: "rename a variable",
          body: "Small rename.",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
          labels: labels.map((entry) => ({ ...entry })),
        };
        await interleave("issue");
        return Response.json(issue);
      }
      if (path.endsWith("/pulls/5"))
        return Response.json({
          draft: pullDraft,
          merged: false,
          head: { sha: headSha },
          base: {
            sha: "c".repeat(40),
            ref: "development",
            repo: { id: repositoryId },
          },
          additions: 1,
          deletions: 1,
          changed_files: 1,
        });
      if (path.endsWith("/branches/main"))
        return Response.json({ commit: { sha: "c".repeat(40) } });
      if (path.endsWith("/branches/development") && targetBranch)
        return Response.json({ commit: { sha: targetSha } });
      if (path.includes("/compare/"))
        return Response.json({
          base_commit: { sha: targetSha },
          merge_base_commit: { sha: "c".repeat(40) },
          files:
            url.searchParams.get("page") === "1" ||
            !url.searchParams.has("page")
              ? [
                  {
                    filename: "a.ts",
                    status: "modified",
                    additions: 1,
                    deletions: 1,
                    patch,
                  },
                ]
              : [],
        });
      if (path === "/user/43")
        return Response.json({ login: "maintainer", id: 43 });
      if (path.endsWith("/permission"))
        return Response.json({
          permission: path.includes("/maintainer/") ? "write" : "read",
        });
      if (path.endsWith("/issues/5/timeline")) {
        await interleave("timeline");
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
          ...extraTimeline,
          {
            event: "commented",
            created_at: new Date().toISOString(),
            actor: { login: "slopbot[bot]", id: 999 },
          },
        ]);
      }
      if (path.endsWith("/issues/5/comments") && request.method === "GET")
        return Response.json([]);
      if (path.endsWith("/issues/5/comments"))
        return Response.json({ id: 900 }, { status: 201 });
      if (path.endsWith("/issues/5/labels")) {
        const body = (await request.json()) as { labels: string[] };
        if (body.labels.includes("slopbot:uncertain")) await interleave("add");
        for (const name of body.labels)
          if (!labels.some((entry) => entry.name === name))
            labels.push({ name });
        if (
          body.labels.includes("slopbot:uncertain") &&
          lostResponses.delete("POST")
        )
          return new Response(null, { status: 503 });
        return Response.json(labels);
      }
      const removed = path.match(/\/issues\/5\/labels\/(.+)$/u);
      if (removed && request.method === "DELETE") {
        const name = decodeURIComponent(removed[1]);
        const index = labels.findIndex((entry) => entry.name === name);
        if (index !== -1) labels.splice(index, 1);
        if (name === "slopbot:uncertain" && lostResponses.delete("DELETE"))
          return new Response(null, { status: 503 });
        return Response.json([], { status: index === -1 ? 404 : 200 });
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
    // Every case stops its ephemeral server. A pooled connection can otherwise
    // reach a reused port after teardown, corrupting the next case's response.
    const headers = new Headers(init?.headers);
    headers.set("connection", "close");
    const localInit = { ...init, headers };
    if (u.origin === new URL(server.url).origin)
      return nativeFetch(url, localInit);
    if (u.hostname !== "api.github.com")
      throw new Error(`unexpected network request to ${u.hostname}`);
    return nativeFetch(new URL(u.pathname + u.search, server.url), localInit);
  }) as typeof fetch;
  const sent: Job[] = [];
  const env = {
    SLOPBOT_DB: db as unknown as D1TransactionalDatabase,
    SLOPBOT_WEBHOOK_SECRET: "local-synthetic-secret",
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
      interleave: (at, callback) => interleavings.set(at, callback),
      loseLabelResponse: (method) => void lostResponses.add(method),
      setDraft: (v: boolean) => {
        pullDraft = v;
      },
      setMaintainerComments: (value) => {
        maintainerComments = value;
      },
      setExtraTimeline: (entries) => {
        extraTimeline = entries;
      },
      setVerdict: (category: Category, nextConfidence: number) => {
        currentCategory = category;
        currentConfidence = nextConfidence;
      },
      reopen: async () => {
        const body = {
          ...job,
          kind: "human_reopen" as const,
          deliveryId: `webhook-reopen-${crypto.randomUUID()}`,
          senderId: 43,
        };
        const response = await enqueueReopen(env as never, body, {
          node_id: "PR_local",
          updated_at: new Date().toISOString(),
          head: { sha: "b".repeat(40) },
        });
        expect(await response.text()).toBe("queued");
        return body;
      },
      job: (kind, extra) =>
        ({
          ...job,
          kind,
          deliveryId: `${kind}-${writes.length}`,
          ...extra,
        }) as Job,
      advanceTarget: (changedSource) => {
        targetSha = "d".repeat(40);
        if (changedSource) patch = "+different current target comparison";
      },
      // GitHub returns a file without a patch, such as an image.
      pushUnpatchedFile: (newHead) => {
        if (newHead) headSha = "e".repeat(40);
        patch = undefined;
      },
      deleteTargetBranch: (closesPullRequest) => {
        targetBranch = false;
        if (closesPullRequest) itemState = "closed";
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

test("an author's @mention of a maintainer is not maintainer action", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(/^held for maintainer until /);
    setSystemTime(new Date(start + 8 * day));
    // The author comments "@maintainer please take a look". GitHub records
    // `mentioned` and `subscribed` timeline events whose actor is the
    // mentioned maintainer, although the maintainer did nothing.
    const at = new Date(start + 1 * day).toISOString();
    run.setExtraTimeline([
      {
        event: "mentioned",
        created_at: at,
        actor: { login: "maintainer", id: 43 },
      },
      {
        event: "subscribed",
        created_at: at,
        actor: { login: "maintainer", id: 43 },
      },
    ]);
    await run.deliver(await run.tick());
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "labeled" },
    ]);
    expect(run.labels).toEqual([{ name: "slopbot:uncertain" }]);
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

test.each([true, false])(
  "an incomplete current comparison ends the hold without repeated retries (newHead=%s)",
  async (newHead) => {
    await uncertainReview(false, async (run) => {
      const start = Date.now();
      expect(await run.review()).toMatch(/^held for maintainer until /);
      // The author answers the finding with a new commit that adds an image.
      run.pushUnpatchedFile(newHead);
      setSystemTime(new Date(start + 7 * day + 60_000));
      const due = await run.tick();
      expect(due.map((j) => j.kind)).toEqual(["maintainer_hold"]);
      await run.deliver(due);
      expect(run.labels).toEqual([]);
      expect(run.writes.filter((w) => w.endsWith("/labels"))).toEqual([]);
      expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
        { outcome: "superseded" },
      ]);
      // A resolved hold is not queued again on later days.
      setSystemTime(new Date(start + 9 * day));
      expect((await run.tick()).length).toBe(0);
    });
  },
);
test.each([true, false])(
  "a deleted target branch ends the hold only after GitHub closes the pull request (closed=%s)",
  async (closed) => {
    await uncertainReview(false, async (run) => {
      const start = Date.now();
      expect(await run.review()).toMatch(/^held for maintainer until /);
      // Deleting the target branch closes the pull requests that target it.
      run.deleteTargetBranch(closed);
      setSystemTime(new Date(start + 7 * day + 60_000));
      const due = await run.tick();
      expect(due.map((j) => j.kind)).toEqual(["maintainer_hold"]);
      if (closed) await run.deliver(due);
      else
        await expect(run.deliver(due)).rejects.toThrow("hold job was retried");
      expect(run.labels).toEqual([]);
      expect(run.writes.filter((w) => w.endsWith("/labels"))).toEqual([]);
      expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
        { outcome: closed ? "superseded" : null },
      ]);
      // A resolved hold is not queued again on later days.
      setSystemTime(new Date(start + 9 * day));
      expect((await run.tick()).length).toBe(closed ? 0 : 1);
    });
  },
);
test.each([true, false])(
  "a due hold rechecks substantive source after a target advance (changed=%s)",
  async (changed) => {
    await uncertainReview(false, async (run) => {
      const start = Date.now();
      await run.review();
      const before = run.sql("SELECT due_at FROM slopbot_maintainer_holds");
      run.advanceTarget(changed);
      setSystemTime(new Date(start + 8 * day));
      await run.deliver(await run.tick());
      expect(run.labels).toEqual(
        changed ? [] : [{ name: "slopbot:uncertain" }],
      );
      expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
        { outcome: changed ? "superseded" : "labeled" },
      ]);
      expect(run.sql("SELECT due_at FROM slopbot_maintainer_holds")).toEqual(
        before,
      );
      expect(run.writes.some((w) => w.startsWith("PATCH "))).toBe(false);
    });
  },
);

test("an upheld appeal supersedes an open maintainer hold and removes slopbot:uncertain after the hold window", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(/^held for maintainer until /);
    run.setVerdict("none", 0.95);
    await run.deliver([run.job("appeal", { senderId: 42 })]);
    await run.deliver([
      run.job("appeal_command", { command: "accept", senderId: 42 }),
    ]);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = await run.tick();
    expect(due.map((j) => j.kind)).toEqual(["maintainer_hold"]);
    await run.deliver(due);
    expect(run.labels).toEqual([{ name: "slopbot: appeal" }]);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "superseded" },
    ]);
  });
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    expect(await run.review()).toMatch(/^held for maintainer until /);
    setSystemTime(new Date(start + 7 * day + 60_000));
    await run.deliver(await run.tick());
    expect(run.labels).toEqual([{ name: "slopbot:uncertain" }]);
    run.setVerdict("none", 0.95);
    await run.deliver([run.job("appeal", { senderId: 42 })]);
    await run.deliver([
      run.job("appeal_command", { command: "accept", senderId: 42 }),
    ]);
    expect(run.labels.map((l) => l.name)).not.toContain("slopbot:uncertain");
    expect(run.writes).toContain(
      "DELETE /repos/SlopDotCash/asi/issues/5/labels/slopbot%3Auncertain",
    );
  });
});

test.each(["timeline", "add"] as const)(
  "an appeal upheld during the hold's %s request leaves no uncertain label",
  async (at) => {
    await uncertainReview(false, async (run) => {
      const start = Date.now();
      await run.review();
      run.setVerdict("none", 0.95);
      await run.deliver([run.job("appeal", { senderId: 42 })]);
      setSystemTime(new Date(start + 7 * day + 60_000));
      const due = (await run.tick()).filter(
        (job) => job.kind === "maintainer_hold",
      );
      expect(due).toHaveLength(1);
      run.interleave(at, () =>
        run.deliver([
          run.job("appeal_command", { command: "accept", senderId: 42 }),
        ]),
      );
      await run.deliver(due);
      expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
        { resolution: "upheld" },
      ]);
      expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
        { outcome: "superseded" },
      ]);
      expect(run.labels.map((entry) => entry.name)).not.toContain(
        "slopbot:uncertain",
      );
    });
  },
);

test("an upheld appeal removes a hold label added after its issue snapshot", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    await run.review();
    run.setVerdict("none", 0.95);
    await run.deliver([run.job("appeal", { senderId: 42 })]);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = (await run.tick()).filter(
      (job) => job.kind === "maintainer_hold",
    );
    expect(due).toHaveLength(1);
    run.interleave("issue", () => run.deliver(due));
    await run.deliver([
      run.job("appeal_command", { command: "accept", senderId: 42 }),
    ]);
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "labeled" },
    ]);
    expect(run.labels.map((entry) => entry.name)).not.toContain(
      "slopbot:uncertain",
    );
    expect(run.writes).toContain(
      "DELETE /repos/SlopDotCash/asi/issues/5/labels/slopbot%3Auncertain",
    );
  });
});

test("a hold retries an unknown label write against the stored upheld appeal", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    await run.review();
    run.setVerdict("none", 0.95);
    await run.deliver([run.job("appeal", { senderId: 42 })]);
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = (await run.tick()).filter(
      (job) => job.kind === "maintainer_hold",
    );
    run.interleave("add", () =>
      run.deliver([
        run.job("appeal_command", { command: "accept", senderId: 42 }),
      ]),
    );
    run.loseLabelResponse("POST");
    await expect(run.deliver(due)).rejects.toThrow("hold job was retried");
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: null },
    ]);
    expect(run.labels.map((entry) => entry.name)).toContain(
      "slopbot:uncertain",
    );
    const calls = run.writes.filter(
      (write) => write === "POST /v1/messages",
    ).length;
    // New maintainer activity must not skip cleanup of the previous unknown
    // write once the stored appeal decision has reversed the finding.
    run.setMaintainerComments(true);
    await run.deliver(due);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "superseded" },
    ]);
    expect(run.labels.map((entry) => entry.name)).not.toContain(
      "slopbot:uncertain",
    );
    expect(
      run.writes.filter((write) => write === "POST /v1/messages"),
    ).toHaveLength(calls);
  });
});

test("an appeal retries an unknown label removal without changing its stored decision", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    await run.review();
    setSystemTime(new Date(start + 7 * day + 60_000));
    await run.deliver(await run.tick());
    run.setVerdict("none", 0.95);
    await run.deliver([run.job("appeal", { senderId: 42 })]);
    run.loseLabelResponse("DELETE");
    await expect(
      run.deliver([
        run.job("appeal_command", { command: "accept", senderId: 42 }),
      ]),
    ).rejects.toThrow("hold job was retried");
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(run.labels.map((entry) => entry.name)).not.toContain(
      "slopbot:uncertain",
    );
    const calls = run.writes.filter(
      (write) => write === "POST /v1/messages",
    ).length;
    await run.deliver([
      run.job("appeal_command", { command: "reject", senderId: 42 }),
    ]);
    expect(run.sql("SELECT resolution FROM slopbot_appeals")).toEqual([
      { resolution: "upheld" },
    ]);
    expect(
      run.sql(
        "SELECT COUNT(*) n FROM slopbot_actions WHERE review_key LIKE '%:resolution' AND action = 'comment'",
      ),
    ).toEqual([{ n: 1 }]);
    expect(
      run.writes.filter((write) => write === "POST /v1/messages"),
    ).toHaveLength(calls);
  });
});

test("a maintainer reopen removes the uncertain label and supersedes a due hold without an appeal", async () => {
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    await run.review();
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = (await run.tick()).filter(
      (job) => job.kind === "maintainer_hold",
    );
    expect(due).toHaveLength(1);
    await run.deliver(due);
    expect(run.labels.map((entry) => entry.name)).toContain(
      "slopbot:uncertain",
    );
    await run.deliver([await run.reopen()]);
    expect(run.labels.map((entry) => entry.name)).not.toContain(
      "slopbot:uncertain",
    );
    expect(run.writes).toContain(
      "DELETE /repos/SlopDotCash/asi/issues/5/labels/slopbot%3Auncertain",
    );
  });
  await uncertainReview(false, async (run) => {
    const start = Date.now();
    await run.review();
    setSystemTime(new Date(start + 7 * day + 60_000));
    const due = (await run.tick()).filter(
      (job) => job.kind === "maintainer_hold",
    );
    expect(due).toHaveLength(1);
    run.interleave("add", async () => run.deliver([await run.reopen()]));
    await run.deliver(due);
    expect(run.sql("SELECT outcome FROM slopbot_maintainer_holds")).toEqual([
      { outcome: "superseded" },
    ]);
    expect(run.labels.map((entry) => entry.name)).not.toContain(
      "slopbot:uncertain",
    );
  });
});
