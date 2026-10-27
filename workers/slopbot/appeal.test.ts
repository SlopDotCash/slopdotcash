import { test } from "bun:test";
import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import worker from "./index";

test("Slopbot queue confirms appeal labels and refuses private or replaced repositories", async () => {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const project = findProject("asi");
  assert.ok(project);
  const manifest = JSON.stringify(project),
    digest = createHash("sha256").update(manifest).digest("hex"),
    at = "2026-10-21T00:00:00.000Z";
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "local regression fixture", at],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,1,?,?,?,?)",
    [project.id, project.status, manifest, digest, at, at],
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
  let labelStatus = 404;
  let labelApplied = false;
  let title = "local fixture";
  let repositoryPrivate = false;
  let repositoryId = Number(project.authority.repositoryId);
  const calls: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(`${request.method} ${path}`);
      if (path.endsWith("/access_tokens"))
        return Response.json({ token: "local-synthetic-token" });
      if (path.endsWith("/labels")) {
        if (labelStatus === 200 || labelStatus === 500) labelApplied = true;
        return labelStatus === 200
          ? Response.json([{ name: "slopbot: appeal" }])
          : new Response(null, { status: labelStatus });
      }
      if (path.endsWith("/issues/1"))
        return Response.json({
          node_id: "I_local",
          number: 1,
          state: "closed",
          title,
          labels: labelApplied ? [{ name: "slopbot: appeal" }] : [],
          body: "appeal",
          user: { login: "author", id: 42, type: "User" },
          assignees: [],
        });
      if (path === `/repos/${owner}/${repo}`)
        return Response.json({
          id: repositoryId,
          private: repositoryPrivate,
          default_branch: "main",
          owner: { login: owner, id: 77, type: "Organization" },
        });
      throw Error("unexpected local request " + path);
    },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((
    url: Parameters<typeof fetch>[0],
    init: Parameters<typeof fetch>[1],
  ) => {
    const u = new URL(url instanceof Request ? url.url : String(url));
    assert.equal(u.hostname, "api.github.com");
    return nativeFetch(new URL(u.pathname + u.search, server.url), init);
  }) as typeof fetch;
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const queued: Job[] = [];
  const env = {
    SLOPBOT_DB: db,
    SLOPBOT_APP_ID: "1",
    SLOPBOT_APP_PRIVATE_KEY: privateKey,
    SLOPBOT_APP_USER_ID: "999",
    SLOPBOT_WEBHOOK_SECRET: "local-only",
    SLOPBOT_QUEUE: {
      async send(job: Job) {
        queued.push(job);
      },
    },
  };
  const outcomes = [];
  try {
    for (const status of [404, 302, 200, 200, 500, 200]) {
      if (status === 500) {
        title = "new revision with a lost label response";
        labelApplied = false;
      }
      labelStatus = status;
      let ack = 0,
        retry = 0;
      await worker.queue(
        {
          messages: [
            {
              body: {
                kind: "appeal",
                deliveryId: "local-" + status,
                installationId: 1,
                repositoryId: Number(project.authority.repositoryId),
                owner,
                repo,
                itemKind: "issue",
                number: 1,
                senderId: 42,
              },
              ack() {
                ack++;
              },
              retry() {
                retry++;
              },
            },
          ],
        },
        env,
      );
      outcomes.push({ status, ack, retry });
    }
    assert.equal(calls.filter((call) => call.endsWith("/labels")).length, 4);
    assert.deepEqual(
      sqlite.query("SELECT COUNT(*) AS n FROM slopbot_actions").get(),
      { n: 4 },
    );
    assert.deepEqual(outcomes, [
      { status: 404, ack: 0, retry: 1 },
      { status: 302, ack: 0, retry: 1 },
      { status: 200, ack: 1, retry: 0 },
      { status: 200, ack: 1, retry: 0 },
      { status: 500, ack: 0, retry: 1 },
      { status: 200, ack: 1, retry: 0 },
    ]);
    for (const state of ["removed_at", "suspended_at", "missing"] as const) {
      if (state === "missing")
        sqlite.run(
          "DELETE FROM slopbot_installations WHERE installation_id = 1",
        );
      else
        sqlite.run(
          `UPDATE slopbot_installations SET removed_at=NULL, suspended_at=NULL, ${state}=? WHERE installation_id=1`,
          [at],
        );
      for (const kind of ["appeal", "human_reopen"] as const) {
        const before = calls.length;
        let ack = 0;
        await worker.queue(
          {
            messages: [
              {
                body: {
                  kind,
                  deliveryId: `inactive-${state}-${kind}`,
                  installationId: 1,
                  repositoryId: Number(project.authority.repositoryId),
                  owner,
                  repo,
                  itemKind: "issue",
                  number: 1,
                  senderId: 42,
                },
                ack() {
                  ack++;
                },
                retry() {
                  assert.fail("inactive installation must be retired");
                },
              },
            ],
          },
          env,
        );
        assert.equal(ack, 1);
        assert.equal(
          calls.length,
          before,
          "inactive jobs must not authenticate or write",
        );
      }
    }
    sqlite.run(
      "INSERT INTO slopbot_installations(installation_id, account_id, account_login, account_type, created_at) VALUES (1,77,?,'Organization',?)",
      [owner, at],
    );
    for (const scope of ["private", "replaced"] as const) {
      repositoryPrivate = scope === "private";
      repositoryId =
        Number(project.authority.repositoryId) + (scope === "replaced" ? 1 : 0);
      for (const kind of ["appeal", "review"] as const) {
        const before = calls.length;
        let acknowledged = false;
        await worker.queue(
          {
            messages: [
              {
                body: {
                  kind,
                  deliveryId: scope,
                  installationId: 1,
                  repositoryId: Number(project.authority.repositoryId),
                  owner,
                  repo,
                  itemKind: "issue",
                  number: 1,
                  senderId: 42,
                },
                ack() {
                  acknowledged = true;
                },
                retry() {
                  assert.fail("out-of-scope job must be ignored");
                },
              },
            ],
          },
          env,
        );
        assert.equal(acknowledged, true);
        assert.deepEqual(calls.slice(before), [
          "POST /app/installations/1/access_tokens",
          `GET /repos/${owner}/${repo}`,
        ]);
      }
    }
    for (const visibility of [true, undefined, false]) {
      const body = JSON.stringify({
        action: "opened",
        installation: { id: 1 },
        repository: {
          id: Number(project.authority.repositoryId),
          name: repo,
          private: visibility,
          owner: { login: owner },
        },
        sender: { id: 42, type: "User" },
        issue: { number: 1 },
      });
      const response = await worker.fetch(
        new Request("https://slopbot.example/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-github-event": "issues",
            "x-github-delivery": `scope-${visibility}`,
            "x-hub-signature-256": `sha256=${createHmac("sha256", env.SLOPBOT_WEBHOOK_SECRET).update(body).digest("hex")}`,
          },
        }),
        env,
      );
      assert.equal(response.status, 202);
      assert.equal(queued.length, visibility === false ? 1 : 0);
    }
    // A completed appeal receipt drops GitHub's redelivery.
    const payload = {
      action: "created",
      installation: { id: 1 },
      repository: {
        id: Number(project.authority.repositoryId),
        name: repo,
        private: false,
        owner: { login: owner },
      },
      sender: { id: 42, type: "User" },
      issue: { number: 1, pull_request: {} },
      comment: { id: 5, body: "/slopbot appeal evidence added" },
    };
    const body = JSON.stringify(payload);
    for (const expected of ["queued", "duplicate delivery"]) {
      const response = await worker.fetch(
        new Request("https://slopbot.example/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-github-event": "issue_comment",
            "x-github-delivery": "appeal-original",
            "x-hub-signature-256": `sha256=${createHmac("sha256", env.SLOPBOT_WEBHOOK_SECRET).update(body).digest("hex")}`,
          },
        }),
        env,
      );
      assert.equal(await response.text(), expected);
    }
    assert.equal(queued.length, 2);
  } finally {
    globalThis.fetch = nativeFetch;
    server.stop(true);
    sqlite.close();
  }
});
