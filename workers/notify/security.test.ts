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
import { applicationManifest } from "../../tests/project-application-manifest";
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
async function setup(beforeMailMigration = false, confidentialOnly = false) {
  const { db: source, sqlite } = sqliteD1(
    readdirSync("migrations")
      // Defer mail activation and the later inbox rebuilds; the rollout
      // test applies them in order after creating pre-pilot history.
      .filter(
        (p) =>
          p.endsWith(".sql") &&
          (!beforeMailMigration ||
            !(
              p.startsWith("0030") ||
              p.startsWith("0063") ||
              p.startsWith("0065") ||
              p.startsWith("0079")
            )),
      )
      .sort(),
  );
  const db = source as unknown as SecurityD1Database;
  const manifest = JSON.stringify(
    confidentialOnly
      ? applicationManifest("bounty", "example/bounty")
      : {
          id: "bounty",
          status: "active",
          securityBounty: {
            status: "pending-approval",
            intake: { repository: "example/bounty" },
            approvers: {
              technical: [owner, backup],
              financial: [],
              dispute: [],
            },
            capacity: { awards: 1, closesAt: null },
            responseTargets: { acknowledgeHours: 1 },
          },
        },
  );
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at,actor_github_id,actor_github_login) VALUES ('bounty',1,?,?,'test',?,?,?)",
    )
    .run(
      manifest,
      "a".repeat(64),
      at,
      confidentialOnly ? owner.githubId : null,
      confidentialOnly ? owner.githubLogin : null,
    );
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES ('bounty',?,1,?,?,?,?)",
    )
    .run(
      confidentialOnly ? "paused" : "active",
      manifest,
      "a".repeat(64),
      at,
      at,
    );
  const repositoryAccess = async () =>
    ({
      installation: "installed",
      installationId: 1,
      permission: "admin",
      roleName: "admin",
      repository: {
        id: 123456789,
        node_id: "R_example",
        full_name: "example/bounty",
        private: false,
        owner: {
          id: 987654321,
          node_id: "O_example",
          login: "example",
          type: "Organization",
        },
      },
    }) as const;
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
        reportingRead: async () => ({ kind: "unavailable" }),
        repositoryAccess: confidentialOnly ? repositoryAccess : undefined,
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
    repositoryAccess: confidentialOnly ? repositoryAccess : undefined,
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
    repositoryAccess,
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

test.each([
  {
    name: "slow earlier mail does not expire a new delivery claim",
    slowDelivery: 1,
    expectedState: "provider-accepted",
    escalations: 0,
  },
  {
    name: "a genuinely stale send still requires reconciliation",
    slowDelivery: 2,
    expectedState: "ambiguous",
    escalations: 1,
  },
])("$name", async ({ slowDelivery, expectedState, escalations }) => {
  const h = await setup();
  try {
    const send = h.deps.sendEmail;
    let calls = 0;
    h.deps.sendEmail = async (from, to, mime) => {
      calls += 1;
      await send(from, to, mime);
      if (calls === slowDelivery) h.advance(6 * 60_000);
      // A second scheduled invocation runs while the second send is active.
      // Only time spent on this send may expire its claim.
      if (calls === 2) await dispatchSecurityMail(h.deps);
    };
    await dispatchSecurityMail(h.deps);
    expect(h.sent).toHaveLength(2);
    const originals = h.rows().filter((row) => row.escalation_of === null);
    const states = new Map(
      originals.map((row) => [
        h.deps.config.recipients[row.recipient_github_id].email,
        row.state,
      ]),
    );
    expect(h.sent.map(({ to }) => states.get(to))).toEqual([
      "provider-accepted",
      expectedState,
    ]);
    expect(originals.map((row) => row.attempts)).toEqual([1, 1]);
    expect(h.rows().filter((row) => row.escalation_of !== null)).toHaveLength(
      escalations,
    );
    expect(
      h.sqlite
        .query(
          "SELECT COUNT(*) AS total FROM security_notification_delivery_events WHERE state='provider-accepted'",
        )
        .get(),
    ).toEqual({ total: escalations === 0 ? 2 : 1 });
  } finally {
    h.sqlite.close();
  }
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

test("a backup authority outage does not stop another recipient's queued receipt", async () => {
  const h = await setup(false, true);
  try {
    for (const actor of [owner, backup])
      h.sqlite
        .query(
          "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES (?,?,?,?,1)",
        )
        .run(`U_${actor.githubId}`, actor.githubId, actor.githubLogin, at);
    const first = h.sqlite
      .query(
        "SELECT recipient_github_id FROM security_notification_outbox ORDER BY created_at,id LIMIT 1",
      )
      .get() as { recipient_github_id: string };
    const backupId =
      h.deps.config.recipients[first.recipient_github_id].backupGithubId;
    let unavailable = false;
    let authorized = true;
    h.deps.repositoryAccess = async (_repository, actor) => {
      if (unavailable && actor.githubId === backupId)
        throw new Error("Fixture GitHub authority outage");
      return {
        ...(await h.repositoryAccess()),
        permission:
          actor.githubId === backupId && !authorized ? "read" : "admin",
        roleName: actor.githubId === backupId && !authorized ? "read" : "admin",
      };
    };
    // Queue the reporter's own receipt after the owner's case notice.
    h.advance(1000);
    const receivedAt = h.deps.now().toISOString();
    h.sqlite
      .query(
        "UPDATE security_cases SET submission_state='verified',received_at=?,verified_at=?,verified_by_github_id=? WHERE id=?",
      )
      .run(receivedAt, receivedAt, owner.githubId, h.caseId);
    await h.db.batch([notifySecurityReportReceived(h.db, h.caseId)]);
    const send = h.deps.sendEmail;
    h.deps.sendEmail = async (from, to, mime) => {
      if (to === h.deps.config.recipients[first.recipient_github_id].email) {
        unavailable = true;
        throw new Error("Fixture uncertain provider result");
      }
      await send(from, to, mime);
    };
    const failure = await dispatchSecurityMail(h.deps).then(
      () => null,
      (error: unknown) => error,
    );
    expect(
      h.rows().find((row) => row.event_key === `security-receipt:${h.caseId}`)
        ?.state,
    ).toBe("provider-accepted");
    expect(h.sent.map((mail) => mail.to)).toEqual(["reporter@example.com"]);
    expect(failure).toBeNull();
    expect(
      h
        .rows()
        .find((row) => row.recipient_github_id === first.recipient_github_id)
        ?.state,
    ).toBe("ambiguous");
    expect(h.rows().filter((row) => row.escalation_of)).toHaveLength(0);
    // An answered check that denies access must still refuse escalation.
    unavailable = false;
    authorized = false;
    h.deps.sendEmail = send;
    h.advance(60_000);
    await dispatchSecurityMail(h.deps);
    expect(h.rows().filter((row) => row.escalation_of)).toHaveLength(0);
    // Restored authority queues the backup once; uncertain mail is not resent.
    authorized = true;
    await dispatchSecurityMail(h.deps);
    const escalations = h.rows().filter((row) => row.escalation_of);
    expect(escalations).toHaveLength(1);
    expect(escalations[0].recipient_github_id).toBe(backupId);
    await dispatchSecurityMail(h.deps);
    expect(h.rows().filter((row) => row.escalation_of)).toHaveLength(1);
    expect(
      h
        .rows()
        .find(
          (row) =>
            row.recipient_github_id === first.recipient_github_id &&
            row.escalation_of === null,
        )?.attempts,
    ).toBe(1);
    expect(
      h.sent.filter((mail) => mail.to === "reporter@example.com"),
    ).toHaveLength(1);
  } finally {
    h.sqlite.close();
  }
});

test("provider suppression evidence is a failed delivery that reaches the backup", async () => {
  const h = await setup();
  await dispatchSecurityMail(h.deps);
  const notice = h.rows().find((r) => r.recipient_github_id === owner.githubId);
  if (!notice) throw new Error("Owner notice missing");
  expect(
    await reconcileSecurityMail(h.deps, {
      deliveryId: notice.id,
      attempt: notice.attempts,
      destinationDigest: await destinationDigest(
        h.deps.config.recipients[owner.githubId],
      ),
      outcome: "suppressed",
      evidenceReference: "private-provider-suppression-receipt",
    }),
  ).toBe(true);
  h.advance(300_000);
  await dispatchSecurityMail(h.deps);
  // The suppressed notice reached no inbox, so its backup is told at once.
  // The accepted notice still waits for its one-hour acknowledgment target.
  expect(
    h
      .rows()
      .filter((r) => r.escalation_of)
      .map((r) => [r.escalation_of, r.recipient_github_id]),
  ).toEqual([[notice.id, backup.githubId]]);
  // Past that target, both notices have reached a backup.
  h.advance(2 * 3600_000);
  await dispatchSecurityMail(h.deps);
  expect(h.rows().filter((r) => r.escalation_of)).toHaveLength(2);
  h.sqlite.close();
});

test("a notice withheld for a revoked role never escalates, even after the role returns", async () => {
  const h = await setup();
  const setApprovers = (revision: number, approvers: (typeof owner)[]) => {
    const technical = JSON.stringify(approvers);
    const sha = String(revision).repeat(64);
    h.sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) SELECT id,?,json_set(manifest, '$.securityBounty.approvers.technical', json(?)),?, 'test role change',? FROM projects WHERE id='bounty'",
      )
      .run(revision, technical, sha, at);
    h.sqlite
      .query(
        "UPDATE projects SET revision=?, manifest_sha256=?, manifest = json_set(manifest, '$.securityBounty.approvers.technical', json(?)) WHERE id = 'bounty'",
      )
      .run(revision, sha, technical);
  };
  setApprovers(2, [owner]);
  await dispatchSecurityMail(h.deps);
  expect(h.rows().map((r) => r.state)).toEqual([
    "provider-accepted",
    "suppressed",
  ]);
  const notice = h.rows().find((r) => r.recipient_github_id === owner.githubId);
  if (!notice) throw new Error("Owner notice missing");
  setApprovers(3, [owner, backup]);
  h.advance(2 * 3600_000);
  await dispatchSecurityMail(h.deps);
  // Only the overdue sent notice reaches a backup. The withheld one sent
  // nothing, so it has no failed delivery or missed acknowledgment.
  expect(
    h
      .rows()
      .filter((r) => r.escalation_of)
      .map((r) => [r.escalation_of, r.recipient_github_id]),
  ).toEqual([[notice.id, backup.githubId]]);
  h.sqlite.close();
});

test("role revocation and a missing verified destination both suppress queued mail without losing the case", async () => {
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
  // No operator-verified destination exists for the owner. Nothing can be
  // sent and nothing will appear within the retry schedule, so the notice is
  // suppressed at once and the inbox shows no email state for it.
  delete h.deps.config.recipients[owner.githubId];
  for (let i = 0; i < 5; i++) {
    await dispatchSecurityMail(h.deps);
    h.advance(3600_000);
  }
  expect(h.rows().map((r) => r.state)).toEqual(["suppressed", "suppressed"]);
  expect(h.rows().map((r) => r.attempts)).toEqual([1, 1]);
  expect(h.sent).toHaveLength(0);
  expect(
    h.sqlite
      .query("SELECT submission_state FROM security_cases WHERE id = ?")
      .get(h.caseId),
  ).toEqual({ submission_state: "claimed" });
  h.sqlite.close();
});

test("a verified destination not yet in effect retries on the bounded schedule and exhausts", async () => {
  const h = await setup();
  h.deps.config.recipients[owner.githubId].verifiedAt =
    "2027-01-01T00:00:00.000Z";
  for (let i = 0; i < 5; i++) {
    await dispatchSecurityMail(h.deps);
    h.advance(3600_000);
  }
  const owner_ = h.rows().find((r) => r.recipient_github_id === owner.githubId);
  expect(owner_?.state).toBe("exhausted");
  expect(owner_?.attempts).toBe(5);
  expect(h.sent.some((m) => m.to === `${owner.githubLogin}@example.com`)).toBe(
    false,
  );
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
