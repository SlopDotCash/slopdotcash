import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { findProject } from "../../src/lib/projects.mjs";
import { enqueueReopen } from "../../tests/slopbot-reopen-fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { Job } from "./contracts";
import worker from "./index";
import {
  confirmedReopenFor,
  confirmReopen,
  reopenSource,
} from "./reopen-source";

afterEach(() => setSystemTime());

function fixture() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((p) => p.endsWith(".sql"))
      .sort(),
  );
  const project = findProject("asi");
  if (!project) throw new Error("fixture project missing");
  const manifest = JSON.stringify({ ...project, status: "active" });
  const digest = createHash("sha256").update(manifest).digest("hex");
  const at = "2026-11-10T00:00:00.000Z";
  setSystemTime(new Date(at));
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,1,?,?,?,?)",
    [project.id, manifest, digest, "signed reopen fixture", at],
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
  const sent: Job[] = [];
  let queueFailure = false;
  const env = {
    SLOPBOT_DB: db,
    SLOPBOT_APP_USER_ID: "999",
    SLOPBOT_WEBHOOK_SECRET: "local-synthetic-secret",
    SLOPBOT_QUEUE: {
      send: async (job: Job) => {
        sent.push(job);
        if (queueFailure) throw new Error("queue accepted; response lost");
      },
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const job: Extract<Job, { kind: "human_reopen" | "appeal" }> = {
    kind: "human_reopen",
    deliveryId: "reopen-delivery",
    installationId: 1,
    repositoryId: Number(project.authority.repositoryId),
    owner,
    repo,
    itemKind: "issue",
    number: 5,
    senderId: 43,
  };
  const item = {
    node_id: "I_local",
    title: "Original title",
    body: "Original body",
    updated_at: at,
  };
  return {
    db,
    sqlite,
    env,
    job,
    item,
    sent,
    queueFailure: (value: boolean) => {
      queueFailure = value;
    },
  };
}

test("a lost queue response retains the signed source and changed redelivery cannot rebind it", async () => {
  const f = fixture();
  try {
    f.queueFailure(true);
    await expect(enqueueReopen(f.env, f.job, f.item)).rejects.toThrow(
      "queue accepted; response lost",
    );
    const original = await reopenSource(f.db, f.job);
    expect(original?.revision).toBe(
      createHash("sha256")
        .update("Original title\nOriginal body")
        .digest("hex"),
    );
    expect(f.sent).toHaveLength(1);
    f.queueFailure(false);
    await expect(
      enqueueReopen(f.env, f.job, { ...f.item, body: "Changed body" }),
    ).rejects.toThrow("Reopen delivery source differs");
    expect(await reopenSource(f.db, f.job)).toEqual(original);
    expect(f.sent).toHaveLength(1);
    expect(await (await enqueueReopen(f.env, f.job, f.item)).text()).toBe(
      "queued",
    );
    expect(f.sent).toHaveLength(2);
    expect(
      await (
        await enqueueReopen(f.env, f.job, { ...f.item, body: "Changed body" })
      ).text(),
    ).toBe("duplicate delivery");
    expect(await reopenSource(f.db, f.job)).toEqual(original);
    expect(await reopenSource(f.db, { ...f.job, senderId: 44 })).toBeNull();
    expect(() =>
      f.sqlite.run(
        "UPDATE slopbot_deliveries SET reopen_source = '{}' WHERE delivery_id = ?",
        [f.job.deliveryId],
      ),
    ).toThrow("reopen source is immutable");
  } finally {
    f.sqlite.close();
  }
});

test("only a confirmed bound receipt can supersede a hold on its exact revision", async () => {
  const f = fixture();
  try {
    await enqueueReopen(f.env, f.job, f.item);
    const source = await reopenSource(f.db, f.job);
    if (!source) throw new Error("source missing");
    expect(await confirmedReopenFor(f.db, "I_local", source.revision)).toBe(
      false,
    );
    await confirmReopen(f.db, f.job.deliveryId);
    const first = f.sqlite
      .query("SELECT reopen_confirmed_at FROM slopbot_deliveries")
      .all();
    setSystemTime(new Date(Date.now() + 1000));
    await confirmReopen(f.db, f.job.deliveryId);
    expect(
      f.sqlite
        .query("SELECT reopen_confirmed_at FROM slopbot_deliveries")
        .all(),
    ).toEqual(first);
    expect(await confirmedReopenFor(f.db, "I_local", source.revision)).toBe(
      true,
    );
    expect(await confirmedReopenFor(f.db, "I_local", "changed")).toBe(false);
    expect(await confirmedReopenFor(f.db, "I_other", source.revision)).toBe(
      false,
    );
    expect(await confirmedReopenFor(f.db, "I_local", source.revision)).toBe(
      true,
    );
  } finally {
    f.sqlite.close();
  }
});

test("missing or unsigned reopen evidence cannot enqueue a maintainer decision", async () => {
  const f = fixture();
  try {
    const unsigned = await worker.fetch(
      new Request("https://slopbot.test/github/webhook", {
        method: "POST",
        body: "{}",
        headers: { "x-github-delivery": "unsigned" },
      }),
      f.env,
    );
    expect(unsigned.status).toBe(401);
    expect(
      f.sqlite.query("SELECT delivery_id FROM slopbot_deliveries").all(),
    ).toEqual([]);
    expect(
      await (
        await enqueueReopen(f.env, f.job, { ...f.item, updated_at: undefined })
      ).text(),
    ).toBe("reopen source unavailable; no decision");
    expect(f.sent).toHaveLength(0);
    expect(await reopenSource(f.db, f.job)).toBeNull();
  } finally {
    f.sqlite.close();
  }
});
