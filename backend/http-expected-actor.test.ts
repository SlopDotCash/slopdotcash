import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { requireActor } from "./http";
import {
  handleSecurityApi,
  type SecurityApiDependencies,
} from "./security/handler";
import type { R2Bucket } from "./trace/cloudflare-persistence";

const ORIGIN = "https://slop.test";
const ACTOR = { githubId: "42", githubLogin: "reporter" };
const PROJECT = "bound-private-intake";
const REPORT = {
  summary: "An authenticated request must retain its expected researcher",
  description:
    "Private synthetic evidence for the request identity regression. No live service or model is used.",
};

function fixture() {
  const { db, sqlite } = sqliteD1();
  const at = "2026-10-27T12:00:00.000Z";
  const manifest = JSON.stringify(
    applicationManifest(PROJECT, "example/bound-private-intake", {
      status: "active",
    }),
  );
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(PROJECT, manifest, digest, "Identity fixture", at);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(PROJECT, manifest, digest, at, at);
  const objects = new Map<
    string,
    { bytes: Uint8Array; customMetadata: Record<string, string> }
  >();
  let databaseCalls = 0;
  let storageCalls = 0;
  let sequence = 0;
  const storage: R2Bucket = {
    async head(key) {
      storageCalls++;
      const object = objects.get(key);
      return object
        ? { size: object.bytes.length, customMetadata: object.customMetadata }
        : null;
    },
    async put(key, bytes, options) {
      storageCalls++;
      objects.set(key, {
        bytes: bytes.slice(),
        customMetadata: options.customMetadata,
      });
    },
    async get(key) {
      storageCalls++;
      const object = objects.get(key);
      return object
        ? {
            body: new Response(new Uint8Array(object.bytes).buffer)
              .body as ReadableStream<Uint8Array>,
            size: object.bytes.length,
            customMetadata: object.customMetadata,
          }
        : null;
    },
  };
  const deps: SecurityApiDependencies = {
    db: {
      prepare(sql) {
        databaseCalls++;
        return db.prepare(sql);
      },
      batch(statements) {
        databaseCalls++;
        return db.batch(statements);
      },
    },
    reportStorage: storage,
    now: () => new Date(at),
    randomId: () => String(++sequence).padStart(16, "0"),
    sessionActor: async () => ACTOR,
    reportingRead: async () => {
      throw new Error("Private intake must not require GitHub delivery");
    },
  };
  return {
    sqlite,
    counters: () => ({ databaseCalls, storageCalls }),
    async call(
      method: "GET" | "POST",
      path: string,
      expected?: string,
      body?: unknown,
    ) {
      const response = await handleSecurityApi(
        new Request(`${ORIGIN}/api/v1/${path}`, {
          method,
          headers: {
            ...(expected === undefined
              ? {}
              : { "x-slop-expected-github-id": expected }),
            ...(method === "POST"
              ? { origin: ORIGIN, "content-type": "application/json" }
              : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        deps,
      );
      if (response === null) throw new Error("Security route was not handled");
      return response;
    },
  };
}

describe("expected actor binding", () => {
  test("a changed session cannot read or store private evidence", async () => {
    const t = fixture();
    try {
      const before = t.counters();
      const read = await t.call(
        "GET",
        "security-submissions/ss_0000000000000001",
        "43",
      );
      expect(read.status).toBe(403);
      expect(await read.json()).toMatchObject({ error: "actor_changed" });
      const write = await t.call("POST", "security-submissions", "43", {
        projectId: PROJECT,
        origin: "slop",
        idempotencyKey: "changed-actor-private-report",
        report: REPORT,
      });
      expect(write.status).toBe(403);
      expect(await write.json()).toMatchObject({ error: "actor_changed" });
      expect(t.counters()).toEqual(before);
      expect(
        t.sqlite
          .query("SELECT COUNT(*) AS count FROM security_submissions")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      t.sqlite.close();
    }
  });

  test("matching requests retain normal private authorization and legacy clients remain valid", async () => {
    const t = fixture();
    try {
      const created = await t.call("POST", "security-submissions", "42", {
        projectId: PROJECT,
        origin: "slop",
        idempotencyKey: "matching-actor-private-report",
        report: REPORT,
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { submission: { id: string } };
      const path = `security-submissions/${body.submission.id}`;
      const read = await t.call("GET", path, "42");
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ report: REPORT });
      const legacyRead = await t.call("GET", path);
      expect(legacyRead.status).toBe(200);
      expect(await legacyRead.json()).toMatchObject({ report: REPORT });
    } finally {
      t.sqlite.close();
    }
  });

  test("a malformed expectation is refused and cannot replace authentication", async () => {
    for (const expected of ["", "0", "042", "reporter", "42,43"]) {
      await expect(
        requireActor(
          new Request(ORIGIN, {
            headers: { "x-slop-expected-github-id": expected },
          }),
          { sessionActor: async () => ACTOR },
        ),
      ).rejects.toMatchObject({ status: 400, code: "invalid_expected_actor" });
    }
    await expect(
      requireActor(
        new Request(ORIGIN, {
          headers: { "x-slop-expected-github-id": "42" },
        }),
        { sessionActor: async () => null },
      ),
    ).rejects.toMatchObject({ status: 401, code: "unauthorized" });
  });
});
