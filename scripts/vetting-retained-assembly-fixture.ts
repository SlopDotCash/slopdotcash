/** Fresh local API authority with explicitly replayed retained source evidence.
 * This does not recreate the old database or attest a new VM execution.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../backend/projects/cloudflare-persistence";
import { handleProjectApi } from "../backend/projects/handler";
import { handleVettingApi } from "../backend/vetting/handler";
import { CloudflareVettingPersistence } from "../backend/vetting/persistence";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import type { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import { vettingKeyPair } from "../tests/vetting-fixtures";
import {
  acquireQueuedAssessment,
  readPendingAssessments,
} from "../workers/vetting/queue";

const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
type Retained = Awaited<ReturnType<typeof localVettingEvidence>>;

export async function retainedAssemblyFixture(input: {
  sourceDirectory: string;
  createEvidence: (db: ProjectD1Database, now: () => Date) => Promise<Retained>;
}) {
  const now = () => new Date("2026-10-20T12:00:00Z");
  const originalBytes = await readFile(
    join(input.sourceDirectory, "inventory.json"),
  );
  const source = JSON.parse(originalBytes.toString("utf8"));
  const oldQueue = JSON.parse(
    await readFile(join(input.sourceDirectory, "queued-inputs.json"), "utf8"),
  );
  assert.equal(source.schema, "slop-source-inventory-v1");
  assert.equal(source.repository, "example/fixture");
  assert.equal(source.records.length, 1);
  assert.equal(source.records[0].path, "fixture.py");
  assert.equal(source.records[0].type, "blob");
  assert.equal(digest(originalBytes), oldQueue.sourceInventorySha256);
  const record = source.records[0];
  const blob = await readFile(
    join(input.sourceDirectory, "objects", record.sha256),
  );
  assert.equal(digest(blob), record.sha256);
  assert.equal(
    createHash("sha1")
      .update(`blob ${blob.length}\0`)
      .update(blob)
      .digest("hex"),
    record.gitSha,
  );
  const templates = oldQueue.templateInputs;
  assert.equal(
    digest(JSON.stringify(templates)),
    oldQueue.assessment.templateSha256,
  );
  const templateBodies = new Map<string, Buffer>();
  for (const file of oldQueue.inputs) {
    const body = await readFile(
      join(input.sourceDirectory, "objects", file.sha256),
    );
    assert.equal(digest(body), file.sha256);
    templateBodies.set(file.path, body);
  }
  const { db, sqlite } = sqliteD1(
    (await readdir(new URL("../migrations", import.meta.url)))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const retained = await input.createEvidence(db, now);
  const projects = new CloudflareProjectPersistence(db);
  const vetting = new CloudflareVettingPersistence(
    db,
    async (a) => a.result !== null && retained.evidence.complete(a.result),
  );
  const keys = await vettingKeyPair();
  const pin = {
    commitSha: source.commitSha,
    templateSha256: oldQueue.assessment.templateSha256,
  };
  let ids = 0;
  const actorOf = (request: Request) =>
    request.headers.get("x-test-actor") === "admin"
      ? ADMIN
      : request.headers.get("x-test-actor") === "applicant"
        ? APPLICANT
        : null;
  const vettingApi = (request: Request) =>
    handleVettingApi(request, {
      evidence: retained.evidence,
      vetting,
      projects,
      resultPublicKeys: keys.publicKey,
      operatorGithubIds: [ADMIN.githubId],
      livePin: async () => pin,
      session: async (request) => {
        const actor = actorOf(request);
        return actor && { ...actor, admin: actor === ADMIN };
      },
      now,
      randomId: () => `0000000000004000a000${String(++ids).padStart(12, "0")}`,
    });
  const projectApi = (request: Request) =>
    handleProjectApi(request, {
      persistence: projects,
      adminGithubIds: new Set([ADMIN.githubId]),
      moderatorGithubIds: new Set<string>(),
      now,
      randomId: () =>
        `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
      sessionActor: async (request) => actorOf(request),
      repositoryControl: async () => ({
        state: "proven",
        reason: "Synthetic local replay authority",
      }),
      readTokenMetadata: async () => {
        throw new Error("Unexpected token lookup");
      },
      github: { fetch: async () => new Response(null, { status: 404 }) },
      vettingClearance: (id, manifest, through) =>
        vetting.manifestClearance(id, manifest, through, async () => pin),
    });
  const session = (path: string, actor: string, body: unknown) =>
    new Request(`${ORIGIN}/api/v1/${path}`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "x-test-actor": actor,
      },
      body: JSON.stringify(body),
    });
  const root = await mkdtemp(join(tmpdir(), "slop-retained-replay-"));
  let server: ReturnType<typeof Bun.serve> | undefined;
  const dispose = async () => {
    server?.stop(true);
    await retained.dispose();
    sqlite.close();
    await rm(root, { recursive: true, force: true });
  };
  try {
    const created = await projectApi(
      session("projects", "applicant", {
        manifest: applicationManifest("retained-replay", source.repository),
      }),
    );
    assert.ok(created);
    assert.equal(created.status, 201);
    const queued = await vettingApi(
      session("admin/vetting/assessments", "admin", {
        projectId: "retained-replay",
        revision: 1,
        reason: "Local retained source replay; not a new VM run",
      }),
    );
    assert.ok(queued);
    assert.equal(queued.status, 201);
    const queuedId = (await queued.json()).assessment.id;
    server = Bun.serve({
      port: 0,
      async fetch(incoming) {
        const path = new URL(incoming.url).pathname;
        const request = new Request(`${ORIGIN}${path}`, incoming);
        if (path === "/api/v1/vetting/requests")
          return (
            (await vettingApi(request)) ?? new Response(null, { status: 404 })
          );
        if (path.startsWith("/api/v1/project-revisions/"))
          return (
            (await projectApi(request)) ?? new Response(null, { status: 404 })
          );
        if (path === "/repos/example/fixture")
          return Response.json({
            id: 123456789,
            node_id: "R_example",
            full_name: source.repository,
            private: false,
          });
        if (path === "/skill-templates/index.json")
          return Response.json({
            schemaVersion: "1",
            repository: "example/templates",
            commit: source.commitSha,
            templateSha256: pin.templateSha256,
            revisionStatus: "committed",
            contributor: templates.contributor,
            reviewer: templates.reviewer,
            renderer: {
              sources: templates.rendererSources,
              revisionStatus: "committed",
            },
            acceptedRevisions: templates.acceptedRevisions,
          });
        for (const [name, body] of templateBodies)
          if (
            path === `/skill-templates/${name}` ||
            path === `/example/templates/${source.commitSha}/${name}`
          )
            return new Response(new Uint8Array(body));
        if (path === `/repos/example/fixture/git/commits/${source.commitSha}`)
          return Response.json({
            sha: source.commitSha,
            tree: { sha: source.treeSha },
          });
        if (path === `/repos/example/fixture/git/trees/${source.treeSha}`)
          return Response.json({
            sha: source.treeSha,
            truncated: false,
            tree: [
              {
                path: record.path,
                mode: record.mode,
                type: "blob",
                sha: record.gitSha,
              },
            ],
          });
        if (path === `/repos/example/fixture/git/blobs/${record.gitSha}`)
          return Response.json({
            sha: record.gitSha,
            encoding: "base64",
            size: blob.length,
            content: blob.toString("base64"),
          });
        return new Response(null, { status: 404 });
      },
    });
    const port = server.port;
    const publicKey = await crypto.subtle.importKey(
      "raw",
      keys.raw,
      { name: "Ed25519" },
      true,
      ["verify"],
    );
    const connection = {
      origin: ORIGIN,
      privateKey: keys.privateKey,
      publicKey,
      now,
      fetch: ((url: string | URL | Request, init?: RequestInit) => {
        assert.equal(init?.method, "GET");
        const parsed = new URL(String(url));
        return fetch(
          `http://localhost:${port}${parsed.pathname}${parsed.search}`,
          init,
        );
      }) as typeof fetch,
    };
    assert.equal(
      (await readPendingAssessments(connection))[0].assessmentId,
      queuedId,
    );
    const acquired = await acquireQueuedAssessment(connection, queuedId, root);
    assert.deepEqual(
      await readFile(join(acquired.directory, "inventory.json")),
      originalBytes,
    );
    const assessment = await vetting.getAssessment(queuedId);
    assert.ok(assessment);
    assert.equal(assessment.state, "pending");
    return {
      db,
      sqlite,
      projects,
      vetting,
      assessment,
      acquisitionDirectory: acquired.directory,
      keys,
      now,
      vettingApi,
      projectApi,
      retained,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
