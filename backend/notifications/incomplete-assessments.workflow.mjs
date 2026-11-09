import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Real notification reads and native D1, with isolated synthetic projects and
// an administrator session. No GitHub or model requests are part of this path.
const actor = { githubId: "900000002", githubLogin: "fixture-admin" };
const at = "2026-10-30T00:00:00.000Z";
const endpoint =
  "https://slop.cash/api/v1/notifications/incomplete-assessments";
let worker;
try {
  const projects = Array.from({ length: 100 }, (_, index) => {
    const id = `incomplete-${String(index).padStart(3, "0")}`;
    const project = applicationManifest(id, `example/${id}`);
    project.authority.repositoryId = String(123456789 + index);
    Object.assign(project.rewardAsset, {
      chainId: "1",
      cluster: null,
      decimals: 6,
      verifiedAt: at,
    });
    return project;
  });
  assert.equal(assertProjectRegistry(projects).length, 100);
  worker = await startHandlerWorker({
    d1: "incomplete-inbox",
    outbound() {
      throw new Error("Unexpected outbound request");
    },
    entrySource: `import { handleNotificationsApi } from ${JSON.stringify(resolve("backend/notifications/handler.ts"))};
export default { fetch(request, env) {
  return handleNotificationsApi(request, {
    db: env.DB, now: () => new Date(${JSON.stringify(at)}),
    sessionActor: async () => (${JSON.stringify(actor)}),
    adminGithubIds: new Set([${JSON.stringify(actor.githubId)}])
  });
}};`,
  });
  const { runtime, db } = worker;
  for (const [index, project] of projects.entries()) {
    const manifest = JSON.stringify(project);
    const digest = createHash("sha256").update(manifest).digest("hex");
    await db.batch([
      db
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture',?)",
        )
        .bind(project.id, manifest, digest, at),
      db
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
        )
        .bind(project.id, manifest, digest, at, at),
      db
        .prepare(
          "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)",
        )
        .bind(`example/${project.id}`, project.id),
      db
        .prepare(
          "INSERT INTO slopbot_deliveries(delivery_id,event,received_at) VALUES(?,'pull_request',?)",
        )
        .bind(project.id, at),
      db
        .prepare(
          "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES(?,1,?,'example',?,7,?)",
        )
        .bind(project.id, 123456789 + index, project.id, at),
      db
        .prepare(
          "INSERT INTO slopbot_value_processing(delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,incomplete_since) VALUES(?,'fixture',?,'waiting','source-incomplete',?,?,?)",
        )
        .bind(project.id, at, at, at, at),
    ]);
  }
  const durations = [];
  for (let sample = 0; sample < 6; sample++) {
    const started = performance.now();
    const response = await runtime.dispatchFetch(endpoint);
    assert.equal(response.status, 200, await response.clone().text());
    const page = await response.json();
    assert.deepEqual(
      page.items.map((item) => item.projectId),
      projects.slice(0, 25).map((project) => project.id),
    );
    assert.equal(page.recipientGithubId, actor.githubId);
    if (sample > 0)
      durations.push(Number((performance.now() - started).toFixed(2)));
  }
  const ids = [];
  let cursor = null;
  do {
    const response = await runtime.dispatchFetch(
      `${endpoint}${cursor ? `?${new URLSearchParams({ after: cursor })}` : ""}`,
    );
    assert.equal(response.status, 200, await response.clone().text());
    const page = await response.json();
    ids.push(...page.items.map((item) => item.projectId));
    cursor = page.next;
  } while (cursor !== null);
  assert.deepEqual(
    ids,
    projects.map((project) => project.id),
  );
  console.log(
    JSON.stringify({
      nativeD1: true,
      projects: projects.length,
      pages: 4,
      responseMilliseconds: durations,
      medianMilliseconds: [...durations].sort((a, b) => a - b)[2],
      providerRequests: 0,
    }),
  );
} finally {
  await worker?.dispose();
}
