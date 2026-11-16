import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { startHandlerWorker } from "../../tests/miniflare-d1.mjs";

// Real Pages entry, session, D1 and Slopbot binding. GitHub facts are synthetic.
const project = {
  ...fixtureProject("eliza"),
  escrow: {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  },
};
const actor = { githubId: "900000002", githubLogin: "fixture-maintainer" };
const token = "a".repeat(43);
const hash = createHash("sha256").update(token).digest("hex");
const state = {
  permission: "write",
  installation: "installed",
  unavailable: false,
  includeRepository: true,
  repository: {
    id: Number(project.authority.repositoryId),
    node_id: project.authority.repositoryNodeId,
    full_name: project.repositories[0].id,
    private: false,
    owner: {
      id: Number(project.steward.github.actorId),
      node_id: project.steward.github.nodeId,
      login: project.steward.github.login,
      type: project.steward.github.type,
    },
  },
};
const requests = [];
let worker;
try {
  worker = await startHandlerWorker({
    d1: "monthly-authority",
    outbound() {
      throw new Error("Monthly authority must use the Slopbot service binding");
    },
    serviceBindings: {
      SLOPBOT(request) {
        const url = new URL(request.url);
        assert.equal(request.method, "GET");
        assert.equal(url.origin, "https://slopbot.internal");
        assert.equal(url.pathname, "/v1/repository-access");
        assert.equal(
          url.searchParams.get("repository"),
          project.repositories[0].id,
        );
        assert.equal(
          url.searchParams.get("repositoryId"),
          project.authority.repositoryId,
        );
        assert.equal(url.searchParams.get("login"), actor.githubLogin);
        assert.equal(url.searchParams.get("githubId"), actor.githubId);
        assert.equal(url.searchParams.get("includeRepository"), "1");
        requests.push(url.pathname);
        if (state.unavailable) return new Response(null, { status: 503 });
        if (state.installation === "missing")
          return Response.json({ installation: "missing" });
        if (state.installation === "suspended")
          return Response.json({
            installation: "suspended",
            installationId: 123,
          });
        return Response.json({
          installation: "installed",
          installationId: 123,
          permission: state.permission,
          roleName: state.permission,
          ...(state.includeRepository ? { repository: state.repository } : {}),
        });
      },
    },
    entrySource: `import { onRequest } from ${JSON.stringify(resolve("functions/api/v1/[[path]].ts"))};
export default { fetch(request, env, ctx) {
  return onRequest({request, env: {...env, SLOP_DB: env.DB, SLOP_ENVIRONMENT: "production", SLOP_GITHUB_READ_TOKEN: "public-read-credential-must-not-authorize"}, waitUntil: ctx.waitUntil.bind(ctx)});
} };`,
  });
  const { runtime, db } = worker;
  const text = JSON.stringify(project);
  const digest = createHash("sha256").update(text).digest("hex");
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
      )
      .bind(project.id, text, digest, "Fixture", now),
    db
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
      )
      .bind(project.id, project.status, text, digest, now, now),
    db
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,1)",
      )
      .bind("U_fixtureMonthly", actor.githubId, actor.githubLogin, now),
    db
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,'2099-01-01T00:00:00.000Z')",
      )
      .bind(hash, "U_fixtureMonthly"),
  ]);
  const check = (signedIn = true, method = "GET", suffix = "2026-10", body) =>
    runtime.dispatchFetch(
      `https://slop.cash/api/v1/payments/projects/${project.id}/monthly/${suffix}`,
      {
        method,
        headers: {
          ...(signedIn ? { cookie: `__Host-slop_points=${token}` } : {}),
          ...(body
            ? {
                origin: "https://slop.cash",
                "content-type": "application/json",
              }
            : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
  const refusal = async (status, code) => {
    const response = await check();
    assert.equal(response.status, status, await response.clone().text());
    assert.equal((await response.json()).error, code);
  };
  assert.equal((await check(false)).status, 401);
  assert.equal(requests.length, 0);
  for (const period of ["2026-10", "2026-11"]) {
    const valid = await check(true, "GET", period);
    assert.equal(valid.status, 200, await valid.clone().text());
    const view = await valid.json();
    assert.equal(view.canManage, false);
    assert.equal(view.period, period);
  }
  const refusedWrite = await check(true, "POST", "2026-11/allocations", {
    githubUserId: "123",
    grossBase: "1",
    expectedSequence: 0,
  });
  assert.equal(refusedWrite.status, 403, await refusedWrite.clone().text());
  state.permission = "admin";
  const admin = await check();
  assert.equal(admin.status, 200, await admin.clone().text());
  assert.equal((await admin.json()).canManage, true);
  state.permission = "read";
  await refusal(403, "owner_required");
  state.permission = "write";
  state.repository.id++;
  await refusal(409, "repository_changed");
  state.repository.id--;
  state.repository.private = true;
  await refusal(409, "repository_changed");
  state.repository.private = false;
  const nodeId = state.repository.node_id;
  state.repository.node_id = "R_different";
  await refusal(409, "repository_changed");
  state.repository.node_id = nodeId;
  state.repository.full_name = "different/repository";
  await refusal(409, "repository_changed");
  state.repository.full_name = project.repositories[0].id;
  state.repository.owner.id++;
  await refusal(409, "repository_changed");
  state.repository.owner.id--;
  state.includeRepository = false;
  await refusal(503, "github_unavailable");
  state.includeRepository = true;
  state.installation = "missing";
  await refusal(403, "owner_required");
  state.installation = "suspended";
  await refusal(403, "owner_required");
  state.installation = "installed";
  state.unavailable = true;
  await refusal(503, "github_unavailable");
  assert.equal(
    (
      await db
        .prepare("SELECT COUNT(*) n FROM monthly_allocation_changes")
        .first()
    ).n,
    0,
  );
  console.log(
    JSON.stringify({
      nativePagesEntry: true,
      nativeD1: true,
      sessionChecked: true,
      slopbotAuthorityReads: requests.length,
      publicTokenRequests: 0,
      financialWrites: 0,
    }),
  );
} finally {
  await worker?.dispose();
}
