/** Actual case transitions and migrated SQLite D1, with only the mail transport substituted. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { notifySecurityReportReceived } from "../../backend/notifications/events";
import {
  handleNotificationsApi,
  type NotificationsDependencies,
} from "../../backend/notifications/handler";
import {
  handleSecurityApi,
  type SecurityD1Database,
} from "../../backend/security/handler";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  destinationDigest,
  dispatchSecurityMail,
  parseSecurityMailConfig,
  reconcileSecurityMail,
  type SecurityMailDependencies,
} from "./security";

const owner = { githubId: "101", githubLogin: "owner" };
const reporter = { githubId: "102", githubLogin: "reporter" };
const backup = { githubId: "103", githubLogin: "backup" };
const at = "2026-10-19T12:00:00.000Z";
const origin = "https://slop.test";
async function setup(beforeMailMigration = false) {
  const { db: source, sqlite } = sqliteD1(
    readdirSync("migrations")
      // Defer mail activation and the later inbox rebuilds; the rollout
      // test applies them in order after creating pre-pilot history. The
      // 0080 membership rebuild needs 0063's closure column and is not part
      // of the inbox rollout, so it is left out with it.
      .filter(
        (p) =>
          p.endsWith(".sql") &&
          (!beforeMailMigration ||
            !(
              p.startsWith("0030") ||
              p.startsWith("0063") ||
              p.startsWith("0065") ||
              p.startsWith("0079") ||
              p.startsWith("0080_points")
            )),
      )
      .sort(),
  );
  const db = source as unknown as SecurityD1Database;
  const manifest = JSON.stringify({
    id: "bounty",
    status: "active",
    securityBounty: {
      status: "pending-approval",
      intake: { repository: "example/bounty" },
      approvers: { technical: [owner, backup], financial: [], dispute: [] },
      capacity: { awards: 1, closesAt: null },
      responseTargets: { acknowledgeHours: 1 },
    },
  });
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES ('bounty',1,?,?,'test',?)",
    )
    .run(manifest, "a".repeat(64), at);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('bounty','active',1,?,?,?,?)",
    )
    .run(manifest, "a".repeat(64), at, at);
  let current = new Date(at);
  let sequence = 0;
  const call = async (actor: typeof owner, path: string, body: object) =>
    handleSecurityApi(
      new Request(origin + "/api/v1/" + path, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      {
        db,
        now: () => current,
        randomId: () => `noticecase${++sequence}`,
        sessionActor: async () => actor,
        github: { fetch, apiOrigin: "https://github.invalid" },
      },
    );
  const claim = await call(reporter, "security-cases", {
    mode: "claim",
    projectId: "bounty",
    advisory: "GHSA-7c8f-9g2h-3j4m",
    idempotencyKey: "security-mail-claim-1",
  });
  expect(claim?.status).toBe(201);
  if (claim === null) throw new Error("Case route missing");
  const caseId = ((await claim.json()) as { case: { id: string } }).case.id;
  const recipients = Object.fromEntries(
    [
      [owner, backup],
      [backup, owner],
      [reporter, owner],
    ].map(([actor, spare]) => [
      actor.githubId,
      {
        email: `${actor.githubLogin}@example.com`,
        verifiedAt: at,
        evidenceReference: "private-operator-verification-1",
        backupGithubId: spare.githubId,
      },
    ]),
  );
  const config = parseSecurityMailConfig(
    JSON.stringify({
      inboxUrl: "https://staging.slop.cash/inbox",
      recipients,
    }),
  );
  expect(config).not.toBeNull();
  const sent: { to: string; mime: string }[] = [];
  const deps: SecurityMailDependencies = {
    db,
    config: config!,
    fromAddress: "notifications@slop.cash",
    now: () => current,
    sendEmail: async (_from, to, mime) => {
      sent.push({ to, mime });
    },
  };
  const rows = () =>
    sqlite
      .query(
        "SELECT * FROM security_notification_outbox ORDER BY recipient_github_id",
      )
      .all() as {
      id: string;
      event_key: string;
      recipient_github_id: string;
      state: string;
      attempts: number;
      acknowledged_at: string | null;
      escalation_of: string | null;
    }[];
  return {
    db,
    sqlite,
    deps,
    call,
    caseId,
    rows,
    sent,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms);
    },
  };
}

test("a case change queues once, sends generic per-role mail once, and needs explicit recipient acknowledgment", async () => {
  const h = await setup();
  expect(h.rows()).toHaveLength(2);
  await Promise.all([
    dispatchSecurityMail(h.deps),
    dispatchSecurityMail(h.deps),
  ]);
  expect(h.sent).toHaveLength(2);
  expect(h.rows().map((r) => r.state)).toEqual([
    "provider-accepted",
    "provider-accepted",
  ]);
  for (const send of h.sent) {
    expect(send.mime).toContain("https://staging.slop.cash/inbox");
    expect(send.mime).not.toContain(h.caseId);
    expect(send.mime).not.toContain("GHSA");
    expect(send.mime).not.toContain("bounty");
  }
  const notice = h
    .rows()
    .find((r) => r.recipient_github_id === owner.githubId)!;
  expect(
    (
      await h.call(reporter, `security-cases/${h.caseId}/acknowledge`, {
        eventKey: notice.event_key,
      })
    )?.status,
  ).toBe(404);
  expect(
    (
      await h.call(owner, `security-cases/${h.caseId}/acknowledge`, {
        eventKey: notice.event_key,
      })
    )?.status,
  ).toBe(200);
  expect(
    (
      await h.call(owner, `security-cases/${h.caseId}/acknowledge`, {
        eventKey: notice.event_key,
      })
    )?.status,
  ).toBe(200);
  expect(h.rows()[0].acknowledged_at).toBe(at);
  expect(
    h.sqlite
      .query(
        "SELECT count(*) AS n FROM security_notification_delivery_events WHERE state = 'acknowledged'",
      )
      .get(),
  ).toEqual({ n: 1 });
  await dispatchSecurityMail(h.deps);
  expect(h.sent).toHaveLength(2);
  expect(
    await reconcileSecurityMail(h.deps, {
      deliveryId: notice.id,
      attempt: notice.attempts,
      destinationDigest: await destinationDigest(
        h.deps.config.recipients[notice.recipient_github_id],
      ),
      outcome: "delivered",
      evidenceReference: "private-provider-delivery-receipt",
    }),
  ).toBe(true);
  expect(h.rows()[0].state).toBe("delivered");
  h.sqlite.close();
});

test("a report receipt is mailed generically and never escalates for a missing acknowledgment", async () => {
  const h = await setup();
  await dispatchSecurityMail(h.deps);
  expect(h.sent).toHaveLength(2);
  h.sqlite
    .query(
      "UPDATE security_cases SET submission_state = 'verified', received_at = ?, verified_at = ?, verified_by_github_id = ? WHERE id = ?",
    )
    .run(at, at, owner.githubId, h.caseId);
  for (let replay = 0; replay < 2; replay++)
    await h.db.batch([notifySecurityReportReceived(h.db, h.caseId)]);
  const receipt = h
    .rows()
    .find((r) => r.event_key === `security-receipt:${h.caseId}`);
  if (!receipt) throw new Error("Receipt notice missing");
  expect(receipt.recipient_github_id).toBe(reporter.githubId);
  await dispatchSecurityMail(h.deps);
  expect(h.sent).toHaveLength(3);
  const mail = h.sent[2];
  expect(mail.to).toBe("reporter@example.com");
  expect(mail.mime).toContain("Your private Slop inbox has a new notice.");
  expect(mail.mime).not.toContain("Acknowledge");
  expect(mail.mime).not.toContain(h.caseId);
  // Past the program's one-hour acknowledgment target, the unacknowledged
  // case notices escalate to their backups; the receipt does not.
  h.advance(2 * 3600_000);
  await dispatchSecurityMail(h.deps);
  const escalated = h
    .rows()
    .map((r) => r.escalation_of)
    .filter((id) => id !== null);
  expect(escalated).toHaveLength(2);
  expect(escalated).not.toContain(receipt.id);
  h.sqlite.close();
});

test("ambiguous transport never resends until independent non-acceptance evidence; failures reach only an authorized backup", async () => {
  const h = await setup();
  h.deps.sendEmail = async () => {
    throw new Error("transport interrupted after request");
  };
  await dispatchSecurityMail(h.deps);
  expect(
    h
      .rows()
      .filter((r) => !r.escalation_of)
      .map((r) => r.state),
  ).toEqual(["ambiguous", "ambiguous"]);
  expect(h.rows().filter((r) => r.escalation_of)).toHaveLength(2);
  await dispatchSecurityMail(h.deps);
  expect(h.rows()).toHaveLength(4); // no recursive escalation
  expect(
    h
      .rows()
      .filter((r) => !r.escalation_of)
      .every((r) => r.attempts === 1),
  ).toBe(true);
  const first = h.rows()[0];
  expect(
    await reconcileSecurityMail(h.deps, {
      deliveryId: first.id,
      attempt: first.attempts,
      destinationDigest: await destinationDigest(
        h.deps.config.recipients[first.recipient_github_id],
      ),
      outcome: "not-accepted",
      evidenceReference: "private-provider-negative-receipt",
    }),
  ).toBe(true);
  h.advance(60_000);
  h.deps.sendEmail = async (_from, to, mime) => {
    h.sent.push({ to, mime });
  };
  await dispatchSecurityMail(h.deps);
  expect(h.sent).toHaveLength(1);
  h.sqlite.close();
});

test("role revocation suppresses queued mail; missing verified destinations exhaust bounded retries without losing the case", async () => {
  const h = await setup();
  h.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) SELECT id,2,json_set(manifest, '$.securityBounty.approvers.technical', json(?)),?, 'test role revocation',? FROM projects WHERE id='bounty'",
    )
    .run(JSON.stringify([owner]), "b".repeat(64), at);
  h.sqlite
    .query(
      "UPDATE projects SET revision=2, manifest_sha256='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', manifest = json_set(manifest, '$.securityBounty.approvers.technical', json(?)) WHERE id = 'bounty'",
    )
    .run(JSON.stringify([owner]));
  delete h.deps.config.recipients[owner.githubId];
  for (let i = 0; i < 5; i++) {
    await dispatchSecurityMail(h.deps);
    h.advance(3600_000);
  }
  expect(h.rows().map((r) => r.state)).toEqual(["exhausted", "suppressed"]);
  expect(h.rows().map((r) => r.attempts)).toEqual([5, 1]);
  expect(h.sent).toHaveLength(0);
  expect(
    h.sqlite
      .query("SELECT submission_state FROM security_cases WHERE id = ?")
      .get(h.caseId),
  ).toEqual({ submission_state: "claimed" });
  h.sqlite.close();
});

test("backup notices have a durable inbox row and their own authenticated acknowledgment", async () => {
  const h = await setup();
  await dispatchSecurityMail(h.deps);
  h.advance(3600_000);
  await dispatchSecurityMail(h.deps);
  const escalation = h
    .rows()
    .find((r) => r.escalation_of && r.recipient_github_id === backup.githubId);
  if (!escalation) throw new Error("Backup notice missing");
  expect(
    h.sqlite
      .query(
        "SELECT kind, subject FROM notifications WHERE event_key = ? AND recipient_github_id = ?",
      )
      .get(escalation.event_key, backup.githubId),
  ).toEqual({ kind: "security_case", subject: h.caseId });
  expect(
    (
      await h.call(backup, `security-cases/${h.caseId}/acknowledge`, {
        eventKey: escalation.event_key,
      })
    )?.status,
  ).toBe(200);
  expect(
    h.rows().find((r) => r.id === escalation.id)?.acknowledged_at,
  ).not.toBeNull();
  h.sqlite.close();
});

test("already escalated history cannot starve a later overdue notice", async () => {
  const h = await setup();
  await dispatchSecurityMail(h.deps);
  h.advance(3600_000);
  // Persist the historical workload that caused the LIMIT 100 regression.
  for (let i = 0; i < 101; i++) {
    h.sqlite
      .query(
        "INSERT INTO notifications(event_key,recipient_github_id,kind,subject,action_path,source_at,created_at) VALUES (?,?,'security_case',?,'/security',?,?)",
      )
      .run(`security-case:historical-${i}`, owner.githubId, h.caseId, at, at);
  }
  h.sqlite
    .query(
      "UPDATE security_notification_outbox SET state='provider-accepted' WHERE event_key LIKE 'security-case:historical-%'",
    )
    .run();
  await dispatchSecurityMail(h.deps);
  h.advance(300_000);
  await dispatchSecurityMail(h.deps);
  const missing = h.sqlite
    .query(
      "SELECT count(*) AS n FROM security_notification_outbox o WHERE o.event_key LIKE 'security-case:historical-%' AND NOT EXISTS (SELECT 1 FROM security_notification_outbox b WHERE b.escalation_of=o.id)",
    )
    .get();
  expect(missing).toEqual({ n: 0 });
  h.sqlite.close();
});

test("pre-pilot inbox history is not mailed and does not expose a dead acknowledgment action", async () => {
  const h = await setup(true);
  h.sqlite.exec(
    readFileSync("migrations/0030_security_notification_outbox.sql", "utf8"),
  );
  expect(h.rows()).toEqual([]);
  // Rebuilding the inbox table copies history back before its triggers exist.
  h.sqlite.exec(
    readFileSync(
      "migrations/0063_account_closure_notification_events.sql",
      "utf8",
    ),
  );
  expect(h.rows()).toEqual([]);
  h.sqlite.exec(
    readFileSync("migrations/0065_slopbot_appeal_notifications.sql", "utf8"),
  );
  expect(h.rows()).toEqual([]);
  h.sqlite.exec(
    readFileSync(
      "migrations/0079_slopbot_scam_review_notifications.sql",
      "utf8",
    ),
  );
  expect(h.rows()).toEqual([]);
  const response = await handleNotificationsApi(
    new Request(origin + "/api/v1/notifications"),
    {
      db: h.db as unknown as NotificationsDependencies["db"],
      sessionActor: async () => owner,
      now: () => new Date(at),
    },
  );
  if (!response) throw new Error("Inbox route missing");
  const body = (await response.json()) as {
    notifications: Record<string, unknown>[];
  };
  expect(body.notifications).toHaveLength(1);
  expect(Object.hasOwn(body.notifications[0], "acknowledgedAt")).toBe(false);
  h.sqlite.close();
});

test("a negative receipt cannot reconcile a later attempt or append duplicate evidence", async () => {
  const h = await setup();
  h.deps.sendEmail = async () => {
    throw new Error("ambiguous send");
  };
  await dispatchSecurityMail(h.deps);
  const first = h
    .rows()
    .find((r) => !r.escalation_of && r.recipient_github_id === owner.githubId);
  if (!first) throw new Error("Original notice missing");
  const oldEvidence = {
    deliveryId: first.id,
    attempt: 1,
    destinationDigest: await destinationDigest(
      h.deps.config.recipients[owner.githubId],
    ),
    outcome: "not-accepted",
    evidenceReference: "provider-attempt-one-negative-receipt",
  };
  expect(await reconcileSecurityMail(h.deps, oldEvidence)).toBe(true);
  expect(await reconcileSecurityMail(h.deps, oldEvidence)).toBe(false);
  h.advance(60_000);
  h.deps.sendEmail = async () => {};
  await dispatchSecurityMail(h.deps);
  expect(h.rows().find((r) => r.id === first.id)?.state).toBe(
    "provider-accepted",
  );
  expect(await reconcileSecurityMail(h.deps, oldEvidence)).toBe(false);
  // Merely changing the asserted attempt cannot recycle evidence either.
  expect(
    await reconcileSecurityMail(h.deps, { ...oldEvidence, attempt: 2 }),
  ).toBe(false);
  expect(
    h.sqlite
      .query(
        "SELECT count(*) AS n FROM security_notification_delivery_events WHERE evidence_reference=?",
      )
      .get(oldEvidence.evidenceReference),
  ).toEqual({ n: 1 });
  expect(h.rows().find((r) => r.id === first.id)?.state).toBe(
    "provider-accepted",
  );
  h.sqlite.close();
});

test("concurrent copies of one provider receipt append one delivery event", async () => {
  const h = await setup();
  await dispatchSecurityMail(h.deps);
  const first = h.rows().find((r) => r.recipient_github_id === owner.githubId);
  if (!first) throw new Error("Original notice missing");
  const receipt = {
    deliveryId: first.id,
    attempt: 1,
    destinationDigest: await destinationDigest(
      h.deps.config.recipients[owner.githubId],
    ),
    outcome: "delivered",
    evidenceReference: "provider-delivery-receipt",
  };
  expect(
    (
      await Promise.all([
        reconcileSecurityMail(h.deps, receipt),
        reconcileSecurityMail(h.deps, receipt),
      ])
    ).sort(),
  ).toEqual([false, true]);
  expect(
    h.sqlite
      .query(
        "SELECT count(*) AS n FROM security_notification_delivery_events WHERE evidence_reference=?",
      )
      .get(receipt.evidenceReference),
  ).toEqual({ n: 1 });
  h.sqlite.close();
});
