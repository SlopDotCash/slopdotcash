import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest.ts";

// Exercise the real Inbox reads and native D1's bind limit. Closed programs
// retain historical case access; no offer, report, model or delivery is live.
const directory = await mkdtemp(join(tmpdir(), "slop-inbox-projects-"));
const actor = { githubId: "900000002", githubLogin: "fixture-maintainer" };
const other = { githubId: "900000003", githubLogin: "fixture-other" };
const at = "2026-10-29T00:00:00.000Z";
let runtime;
try {
  const projects = Array.from({ length: 100 }, (_, index) => {
    const id = `inbox-${index}`;
    const repository = `example/${id}`;
    const contact = index < 99 ? actor : other;
    const project = applicationManifest(id, repository, {
      securityBounty: {
        version: "1",
        status: "closed",
        rewardMode: "separate",
        eligibility: "critical-loss-of-funds",
        amount: {
          currency: "USDC",
          decimals: 6,
          network: "base",
          grossMinor: "1000000",
        },
        split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
        sponsor: { name: "Example", githubId: contact.githubId },
        funding: { state: "pledged" },
        capacity: {
          awards: 1,
          closesAt: null,
          exhaustionRule: "New awards wait for available funds.",
        },
        scope: {
          sourceRevisions: [{ repository, commit: "a".repeat(40) }],
          deployments: [],
          includedAssets: ["Synthetic vault funds"],
          excludedDependencies: [],
          testingPermission: "Test only in disposable local fixtures.",
          severityRubric: "Assess the impact on covered funds.",
          lossDefinition: "Unauthorized loss of covered funds.",
        },
        intake: { kind: "github-private-vulnerability-reporting", repository },
        responseTargets: {
          acknowledgeHours: 24,
          triageBusinessDays: 3,
          updateIntervalDays: 7,
        },
        approvers: {
          technical: [contact],
          financial: [contact],
          dispute: [contact],
        },
        dispute: {
          authority: "advisory",
          process: "Request a private review from Slop.",
        },
        disclosure: "The maintainer controls public disclosure.",
        safeHarbor: "Good-faith testing within these rules is authorized.",
      },
    });
    Object.assign(project.rewardAsset, {
      chainId: "1",
      cluster: null,
      decimals: 6,
      verifiedAt: at,
    });
    return project;
  });
  assert.equal(assertProjectRegistry(projects).length, 100);
  const entry = join(directory, "worker.ts");
  const output = join(directory, "worker.mjs");
  await writeFile(
    entry,
    `import { handleSecurityApi } from ${JSON.stringify(resolve("backend/security/handler.ts"))};
export default { fetch(request, env) { return handleSecurityApi(request, {
  db: env.DB, now: () => new Date(${JSON.stringify(at)}), randomId: () => "unused",
  sessionActor: async () => !request.headers.has("x-fixture-actor") ? null : request.headers.get("x-fixture-actor") === "other" ? ${JSON.stringify(other)} : ${JSON.stringify(actor)},
  reportingRead: async () => { throw new Error("Unexpected provider read"); },
  reportStorage: {}
}); } };`,
  );
  const build = spawnSync(
    "bun",
    ["--no-env-file", "build", entry, "--target=browser", "--outfile", output],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      host: "127.0.0.1",
      port: 0,
      modules: true,
      compatibilityDate: "2026-09-14",
      script: await readFile(output, "utf8"),
      d1Databases: { DB: "inbox-projects" },
      outboundService() {
        throw new Error("Unexpected outbound request");
      },
    }),
  );
  const db = await runtime.getD1Database("DB");
  for (const name of (await readdir("migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await db.batch(
      splitSqlQuery(await readFile(`migrations/${name}`, "utf8")).map((sql) =>
        db.prepare(sql),
      ),
    );
  }
  for (const project of projects) {
    const manifest = JSON.stringify(project);
    const digest = createHash("sha256").update(manifest).digest("hex");
    await db.batch([
      db
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'Fixture history',?)",
        )
        .bind(project.id, manifest, digest, at),
      db
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
        )
        .bind(project.id, manifest, digest, at, at),
    ]);
  }
  const visibleIds = Array.from(
    { length: 99 },
    (_, index) => `sc_fixture_${String(index).padStart(3, "0")}`,
  );
  const cases = [
    ...visibleIds.map((id, index) => [id, `inbox-${index}`, other]),
    ["sc_fixture_own", "inbox-99", actor],
    ["sc_fixture_hidden", "inbox-99", other],
  ];
  await db.batch(
    cases.map(([id, projectId, reporter]) =>
      db
        .prepare(
          "INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at) VALUES(?,?,?,?,?,'claimed','received','not-started','not-applicable','not-applicable','embargoed','private','none',1,?,?)",
        )
        .bind(
          id,
          projectId,
          `example/${projectId}`,
          reporter.githubId,
          reporter.githubLogin,
          at,
          at,
        ),
    ),
  );
  const request = (path, signedIn = true, identity = "1") =>
    runtime.dispatchFetch(`https://slop.cash/api/v1/${path}`, {
      headers: signedIn ? { "x-fixture-actor": identity } : {},
    });
  assert.equal((await request("security-cases", false)).status, 401);
  assert.equal((await request("security-submissions", false)).status, 401);
  assert.equal((await request("security-cases", true, "other")).status, 200);
  assert.equal(
    (await request("security-submissions", true, "other")).status,
    200,
  );
  const response = await request("security-cases");
  const submissions = await request("security-submissions");
  console.log(
    JSON.stringify({
      caseStatus: response.status,
      submissionStatus: submissions.status,
    }),
  );
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(
    body.cases.map((row) => row.id).sort(),
    [...visibleIds, "sc_fixture_own"].sort(),
  );
  const audited = await db
    .prepare(
      "SELECT COUNT(*) count FROM security_case_access_log WHERE actor_github_id=?",
    )
    .bind(actor.githubId)
    .first();
  assert.equal(audited.count, 100);
  assert.equal(submissions.status, 200, await submissions.clone().text());
  assert.deepEqual((await submissions.json()).submissions, []);
  console.log(
    JSON.stringify({
      nativeD1: true,
      registryProjects: 100,
      authorizedProjects: 99,
      visibleCases: 100,
      auditedCases: 100,
      hiddenCases: 1,
      realProviderRequests: 0,
    }),
  );
} finally {
  await runtime?.dispose();
  await rm(directory, { recursive: true, force: true });
}
