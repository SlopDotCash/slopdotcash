/** Shipped local Worker + real D1 triggers + send_email capture. No external mail. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  handleSecurityApi,
  inboxStatements,
} from "../../backend/security/handler.ts";
import { childEnvironment } from "../../scripts/child-environment.mjs";
import { startNotifyWorkerFixture } from "../../tests/notify-worker-fixture.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1.ts";

const root = resolve(import.meta.dir, "../..");
const artifact =
  process.env.SLOP_NOTIFY_TEST_ARTIFACT_DIR ??
  mkdtempSync(join(tmpdir(), "slop-mail-proof-"));
mkdirSync(artifact, { recursive: true });
const persist = mkdtempSync(join(artifact, "d1-"));
const port = Number(process.env.SLOP_NOTIFY_TEST_PORT ?? "32894");
const migrationLog = openSync(join(artifact, "local-migrations.log"), "w");
try {
  execFileSync(
    "node",
    [
      join(root, "node_modules/wrangler/bin/wrangler.js"),
      "d1",
      "migrations",
      "apply",
      "slop-private",
      "--local",
      "--persist-to",
      persist,
    ],
    {
      cwd: root,
      env: { ...childEnvironment(), CI: "true" },
      stdio: ["ignore", migrationLog, migrationLog],
    },
  );
} finally {
  closeSync(migrationLog);
}
const database = readdirSync(persist, { recursive: true }).find((path) =>
  /[a-f0-9]{64}\.sqlite$/u.test(String(path)),
);
assert.ok(database);
const { db, sqlite } = sqliteD1([], join(persist, String(database)));
const owner = { githubId: "101", githubLogin: "owner" };
const reporter = { githubId: "102", githubLogin: "reporter" };
const backup = { githubId: "103", githubLogin: "backup" };
const finance = { githubId: "104", githubLogin: "finance" };
const unlisted = { githubId: "105", githubLogin: "unlisted" };
const actors = [owner, reporter, backup, finance];
const at = new Date().toISOString();
const program = {
  status: "open",
  intake: { repository: "example/private-audit" },
  approvers: {
    technical: [owner, backup, unlisted],
    financial: [finance],
    dispute: [],
  },
  capacity: { awards: 1, closesAt: null },
  responseTargets: { acknowledgeHours: 24 },
};
const manifest = {
  id: "private-audit",
  status: "active",
  securityBounty: program,
};
function publish(value, revision) {
  const text = JSON.stringify(value),
    digest = createHash("sha256").update(text).digest("hex");
  sqlite
    .prepare(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('private-audit',?,?,?,'local notification proof',?)",
    )
    .run(revision, text, digest, at);
  if (revision === 1)
    sqlite
      .prepare(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES('private-audit','active',1,?,?,?,?)",
      )
      .run(text, digest, at, at);
  else
    sqlite
      .prepare(
        "UPDATE projects SET revision=?,manifest=?,manifest_sha256=?,updated_at=? WHERE id='private-audit'",
      )
      .run(revision, text, digest, at);
}
publish(manifest, 1);
const response = await handleSecurityApi(
  new Request("https://slop.test/api/v1/security-cases", {
    method: "POST",
    headers: {
      origin: "https://slop.test",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      mode: "claim",
      projectId: "private-audit",
      advisory: "GHSA-7c8f-9g2h-3j4m",
      idempotencyKey: "local-notify-report-claim",
    }),
  }),
  {
    db,
    now: () => new Date(at),
    randomId: () => "maildeliveryproof",
    sessionActor: async () => reporter,
    reportingRead: async () => ({ kind: "unavailable" }),
  },
);
assert.equal(response.status, 201);
const caseId = (await response.json()).case.id;
const frozen = JSON.stringify({
  grossMinor: "10000",
  researcherMinor: "7500",
  slopMinor: "2500",
  currency: "USD",
  decimals: 2,
  network: null,
  capacityAwards: 1,
});
for (const [revision, completed] of [
  [2, false],
  [3, true],
]) {
  const key = `local-verification-${revision}`;
  const event = {
    caseId,
    revision,
    kind: "verify-payment",
    idempotencyKey: key,
    reporterGithubId: reporter.githubId,
    detail: { completed, secret: "PRIVATE_REPORT_BODY_SENTINEL" },
    terms: program,
  };
  await db.batch([
    db
      .prepare(
        "UPDATE security_cases SET revision=?,submission_state='verified',received_at=?,verified_at=?,verified_by_github_id=?,policy_revision=1,terms=?,award_state='approved' WHERE id=?",
      )
      .bind(revision, at, at, owner.githubId, frozen, caseId),
    db
      .prepare(
        "INSERT INTO security_case_events(case_id,case_revision,kind,actor_github_id,actor_role,idempotency_key,detail,at) VALUES(?,?,'verify-payment',?,'security-maintainer',?,?,?)",
      )
      .bind(
        caseId,
        revision,
        owner.githubId,
        key,
        JSON.stringify(event.detail),
        at,
      ),
    ...inboxStatements({ db }, event),
  ]);
  await db.batch(inboxStatements({ db }, event));
}
assert.equal(sqlite.query("SELECT COUNT(*) n FROM notifications").get().n, 11);
let worker;
try {
  worker = await startNotifyWorkerFixture(root, persist, port, {
    securityGithubIds: actors.map((actor) => actor.githubId),
    securityVerifiedAt: "2099-01-01T00:00:00.000Z",
  });
  await worker.dispatchSecurityMail();
  assert.equal((await worker.capturedEmails()).length, 0);
  assert.deepEqual(
    sqlite
      .query(
        "SELECT state,COUNT(*) n FROM security_notification_outbox GROUP BY state ORDER BY state",
      )
      .all(),
    [
      { state: "retrying", n: 8 },
      { state: "suppressed", n: 3 },
    ],
  );
  await worker.close();
  worker = null;
  publish(
    {
      ...manifest,
      securityBounty: {
        ...program,
        approvers: { ...program.approvers, technical: [owner, unlisted] },
      },
    },
    2,
  );
  sqlite
    .prepare(
      "UPDATE security_notification_outbox SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE state='retrying'",
    )
    .run();
  worker = await startNotifyWorkerFixture(root, persist, port, {
    securityGithubIds: actors.map((actor) => actor.githubId),
  });
  await Promise.all([
    worker.dispatchSecurityMail(),
    worker.dispatchSecurityMail(),
  ]);
  let messages = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    messages = await worker.capturedEmails();
    if (messages.length === 5) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.equal(messages.length, 5);
  assert.deepEqual(messages.flatMap((email) => email.to).sort(), [
    "actor-101@example.com",
    "actor-102@example.com",
    "actor-102@example.com",
    "actor-104@example.com",
    "actor-104@example.com",
  ]);
  for (const [index, email] of messages.entries()) {
    assert.match(email.text, /https:\/\/staging\.slop\.cash\/inbox/);
    assert.doesNotMatch(
      email.raw,
      /PRIVATE_REPORT_BODY_SENTINEL|private-audit|GHSA|10000|7500|2500|security-case:/,
    );
    assert.ok(!email.raw.includes(caseId));
    writeFileSync(join(artifact, `captured-${index + 1}.eml`), email.raw);
  }
  await worker.dispatchSecurityMail();
  assert.equal((await worker.capturedEmails()).length, 5);
  assert.deepEqual(
    sqlite
      .query(
        "SELECT state,COUNT(*) n FROM security_notification_outbox GROUP BY state ORDER BY state",
      )
      .all(),
    [
      { state: "provider-accepted", n: 5 },
      { state: "suppressed", n: 6 },
    ],
  );
  assert.equal(
    sqlite
      .query(
        "SELECT COUNT(*) n FROM security_notification_delivery_events WHERE state='provider-accepted'",
      )
      .get().n,
    5,
  );
  writeFileSync(
    join(artifact, "local-email-capture.json"),
    JSON.stringify(messages, null, 2),
  );
  console.log(
    JSON.stringify({
      passed: true,
      localWorker: true,
      externalMail: false,
      captured: messages.length,
      retryBeforeSend: true,
      concurrentDedup: true,
      revokedAndUnlistedSuppressed: true,
      privateContentAbsent: true,
      artifact,
    }),
  );
} finally {
  if (worker) await worker.close();
  sqlite.close();
}
