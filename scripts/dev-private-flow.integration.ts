/** Real isolated Vite/API/R2 processes; synthetic local accounts, no provider credentials. */

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { HISTORICAL_PROJECTS } from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";
import { childEnvironment } from "./child-environment.mjs";

const root = resolve(import.meta.dir, "..");
if (
  [".dev.vars", "workers/identity/.dev.vars"].some((p) =>
    existsSync(resolve(root, p)),
  )
)
  throw new Error("Isolated dev proof requires no local .dev.vars files.");
const artifact = resolve(
  process.env.SLOP_DEV_TEST_ARTIFACT_DIR ??
    join(tmpdir(), "slop-dev-private-proof"),
);
mkdirSync(artifact, { recursive: true });
const directory = mkdtempSync(join(tmpdir(), "slop-dev-private-data-"));
const alias = resolve(root, `.private-flow-alias-${process.pid}`);
const fixtureDirectory = resolve(root, `.private-flow-fixture-${process.pid}`);
const base = Number(process.env.SLOP_DEV_TEST_PORT ?? "34960");
const origin = `http://127.0.0.1:${base}`;
const backend = `http://127.0.0.1:${base + 1}`;
const sessions = [
  randomBytes(32).toString("hex"),
  randomBytes(32).toString("hex"),
  randomBytes(32).toString("hex"),
];
const actors = ["920000011", "920000013", "920000015"];
const { sqlite } = sqliteD1(MIGRATIONS, join(directory, "slop.sqlite"));
sqlite.exec("CREATE TABLE dev_migrations(name TEXT PRIMARY KEY) STRICT");
for (const name of MIGRATIONS)
  sqlite.query("INSERT INTO dev_migrations VALUES(?)").run(name);
const at = new Date().toISOString();
for (let i = 0; i < actors.length; i++) {
  sqlite
    .query(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
    )
    .run(`local-${i}`, actors[i], `local-proof-${i}`, at);
  sqlite
    .query(
      "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)",
    )
    .run(
      createHash("sha256").update(sessions[i]).digest("hex"),
      `local-${i}`,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
}
const occupiedPublicProject = HISTORICAL_PROJECTS.find(
  (project) => project.repositories.length > 0,
);
assert.ok(occupiedPublicProject);
const occupiedRepository = occupiedPublicProject.repositories[0].id;
const manifest = applicationManifest(
  "local-private-proof",
  occupiedRepository,
  {
    status: "active",
    securityBounty: {
      status: "open",
      fundingPolicy: "after-approval",
      funding: { state: "pledged" },
      intake: { repository: occupiedRepository },
      amount: {
        currency: "USDC",
        decimals: 6,
        network: "base",
        grossMinor: "10000000000",
      },
      sponsor: { name: "Synthetic local sponsor", githubId: null },
      approvers: {
        technical: [{ githubId: actors[1], githubLogin: "local-proof-1" }],
        financial: [],
        dispute: [],
      },
      capacity: { awards: null, closesAt: null },
      responseTargets: {
        acknowledgeHours: 24,
        triageBusinessDays: 3,
        updateIntervalDays: 7,
      },
      scope: {
        includedAssets: ["Synthetic local code"],
        severityRubric: "Synthetic criteria",
        lossDefinition: "Synthetic loss",
      },
    },
  },
);
const body = JSON.stringify(manifest),
  digest = createHash("sha256").update(body).digest("hex");
sqlite
  .query(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('local-private-proof',1,?,?,'Local proof',?)",
  )
  .run(body, digest, at);
sqlite
  .query(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('local-private-proof','active',1,?,?,?,?)",
  )
  .run(body, digest, at, at);
sqlite
  .query(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,'local-private-proof')",
  )
  .run(occupiedRepository.toLowerCase());
sqlite.close();
writeFileSync(
  join(directory, "private-marker.txt"),
  "SYNTHETIC-PRIVATE-MARKER",
  { mode: 0o600 },
);
symlinkSync(directory, alias, "dir");
mkdirSync(fixtureDirectory);
writeFileSync(join(fixtureDirectory, ".dev.vars"), "SYNTHETIC=PRIVATE", {
  mode: 0o600,
});
const env = childEnvironment(process.env, {
  PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
  SLOP_DEV_ORIGIN: origin,
  SLOP_DEV_BACKEND_PORT: String(base + 1),
  SLOP_DEV_BACKEND: backend,
  SLOP_DEV_DATA_DIR: directory,
});
let api: ChildProcess | undefined, site: ChildProcess | undefined;
async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done();
    }, 8000);
    child.once("exit", () => {
      clearTimeout(timer);
      done();
    });
  });
}
function startApi() {
  api = spawn(process.execPath, ["scripts/dev-backend.ts"], {
    cwd: root,
    env,
    stdio: [
      "ignore",
      openSync(join(artifact, "backend.log"), "a"),
      openSync(join(artifact, "backend-errors.log"), "a"),
    ],
  });
}
async function request(
  path: string,
  actor: number | null = 0,
  method = "GET",
  payload?: object,
) {
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(actor === null
        ? {}
        : { cookie: `__Host-slop_points=${sessions[actor]}` }),
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
}
async function wait<T>(
  read: () => Promise<T | false>,
  timeout = 25_000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value !== false) return value;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("Local proof deadline exceeded");
}
try {
  startApi();
  site = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      String(base),
      "--strictPort",
    ],
    {
      cwd: root,
      env,
      stdio: [
        "ignore",
        openSync(join(artifact, "vite.log"), "a"),
        openSync(join(artifact, "vite-errors.log"), "a"),
      ],
    },
  );
  await wait(async () => (await request("/__dev/health", null)).ok);
  const inventory = (await (
    await request("/api/v1/projects", null)
  ).json()) as { projects: { id: string }[] };
  assert.ok(
    inventory.projects.some((project) => project.id === "local-private-proof"),
  );
  assert.ok(
    !inventory.projects.some(
      (project) => project.id === occupiedPublicProject.id,
    ),
    "public clone must not displace a local repository claim",
  );
  assert.equal((await request("/__dev/mail", null)).status, 401);
  const signup = await request(
    "/api/v1/notifications/email/verification",
    0,
    "POST",
    {
      email: "synthetic-local@example.com",
      idempotencyKey: "local-server-enrollment-proof",
      enabled: true,
      securityEnabled: true,
    },
  );
  assert.equal(
    signup.status,
    202,
    "real local verification API must accept enrollment",
  );
  const mail = await wait(async () => {
    const response = await request("/__dev/mail");
    const text = await response.text();
    return text.includes("#verify-email=") ? text : false;
  });
  const token = /#verify-email=([a-f0-9]{64})/u.exec(mail)?.[1];
  assert.ok(token);
  assert.ok(
    !(await (await request("/__dev/mail", 2)).text()).includes(token),
    "other actor must not read a capture",
  );
  assert.equal(
    (await request("/api/v1/notifications/email/verify", 2, "POST", { token }))
      .status,
    409,
  );
  assert.equal(
    (await request("/api/v1/notifications/email/verify", 0, "POST", { token }))
      .status,
    200,
  );
  const report = {
    summary: "Synthetic private persistence proof",
    description:
      "SYNTHETIC-PRIVATE-REPORT-BODY. A local-only reproduction retained across process restarts.",
  };
  const submitted = await request("/api/v1/security-submissions", 0, "POST", {
    projectId: "local-private-proof",
    origin: "slop",
    idempotencyKey: "local-server-report-proof",
    report,
  });
  assert.equal(
    submitted.status,
    201,
    "real local report intake must retain its private body",
  );
  const submission = (
    (await submitted.json()) as { submission: { id: string } }
  ).submission;
  const before = await request(`/api/v1/security-submissions/${submission.id}`);
  assert.equal(before.status, 200);
  assert.deepEqual(
    ((await before.json()) as { report: object }).report,
    report,
  );
  assert.equal(
    (await request(`/api/v1/security-submissions/${submission.id}`, 2)).status,
    404,
  );
  assert.equal(
    (await request(`/api/v1/security-submissions/${submission.id}`, 1)).status,
    200,
  );
  await wait(async () => {
    const html = await (await request("/__dev/mail")).text();
    return html.includes("private Slop inbox");
  }, 12_000);
  const captured = await (await request("/__dev/mail")).text();
  assert.ok(!captured.includes(report.description));
  await stop(api);
  startApi();
  await wait(async () => (await request("/__dev/health", null)).ok);
  const persisted = await request(
    `/api/v1/security-submissions/${submission.id}`,
  );
  assert.equal(persisted.status, 200);
  assert.deepEqual(
    ((await persisted.json()) as { report: object }).report,
    report,
  );
  assert.equal((await request("/api/v1/notifications/email")).status, 200);
  const paths = [
    "/.slop-dev/slop.sqlite",
    `/@fs${directory}/slop.sqlite`,
    `/@fs${directory}/private-marker.txt`,
    `/${alias.split("/").at(-1)}/private-marker.txt`,
    `/${fixtureDirectory.split("/").at(-1)}/.dev.vars`,
    `/${fixtureDirectory.split("/").at(-1)}/%2edev%2evars`,
  ];
  for (const path of paths)
    assert.equal(
      (await request(path, null, "HEAD")).status,
      403,
      `private URL must be blocked: ${path}`,
    );
  const wrongHost = await fetch(`${backend}/__dev/health`, {
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(wrongHost.status, 421);
  console.log(
    JSON.stringify({
      passed: true,
      realDevProcesses: true,
      privateReportSurvivesRestart: true,
      capturedEmailVerified: true,
      actorIsolation: true,
      privateUrlsBlocked: paths.length,
      externalMail: false,
      liveProviderCalls: false,
    }),
  );
} finally {
  await stop(site);
  await stop(api);
  rmSync(alias, { force: true });
  rmSync(fixtureDirectory, { recursive: true, force: true });
  rmSync(directory, { recursive: true, force: true });
}
