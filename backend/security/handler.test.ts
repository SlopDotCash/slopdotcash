// Runs the security case API against the real migrations. A concurrent
// writer is injected between the case read and the write batch, which a
// browser test cannot schedule deterministically.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleSecurityApi, type SecurityD1Database } from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ORIGIN = "https://slop.test";
const PROJECT = "bounty";
const MAINTAINER = { githubId: "900000101", githubLogin: "maintainer" };
const REPORTER = { githubId: "900000102", githubLogin: "reporter" };
const TRIAGER = { githubId: "900000103", githubLogin: "triager" };
const FINANCE = { githubId: "900000104", githubLogin: "finance" };
const FINANCE_2 = { githubId: "900000107", githubLogin: "finance-two" };
const DISPUTE = { githubId: "900000105", githubLogin: "dispute" };
const DISPUTE_2 = { githubId: "900000106", githubLogin: "dispute-two" };
const ADVISORY = "GHSA-7c8f-9g2h-3j4m";
const RECEIVED = "2026-10-19T09:00:00.000Z";

type Reply = {
  error?: string;
  replayed?: boolean;
  case: {
    id: string;
    revision: number;
    submissionState: string;
    receivedAt: string | null;
    awardState: string;
    receiptState: string;
    appealState: string;
    allowedActions: string[];
  };
};

// An open paid program with separate financial and dispute approvers.
const OPEN_PROGRAM = {
  status: "open",
  intake: { repository: "example/bounty" },
  amount: {
    currency: "USD",
    decimals: 2,
    network: null,
    grossMinor: "1000000",
  },
  sponsor: { name: "Slop", githubId: null },
  approvers: {
    technical: [MAINTAINER],
    financial: [FINANCE, FINANCE_2],
    dispute: [DISPUTE, DISPUTE_2],
  },
  capacity: { awards: 1, closesAt: null },
};

function programManifest(securityBounty: Record<string, unknown>): string {
  return JSON.stringify({ id: PROJECT, status: "active", securityBounty });
}

function open(
  securityBounty: Record<string, unknown> = {
    status: "pending-approval",
    intake: { repository: "example/bounty" },
    approvers: { technical: [MAINTAINER], financial: [], dispute: [] },
    capacity: { awards: 1, closesAt: null },
  },
) {
  const { db, sqlite } = sqliteD1(migrations);
  const manifest = programManifest(securityBounty);
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'test', ?)",
    )
    .run(PROJECT, manifest, digest, RECEIVED);
  sqlite
    .query(
      "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)",
    )
    .run(PROJECT, manifest, digest, RECEIVED, RECEIVED);
  let actor = MAINTAINER;
  let ids = 0;
  // Runs before the next write batch, after the handler read the case.
  let beforeBatch: (() => void) | null = null;
  const securityDb = db as unknown as SecurityD1Database;
  const wrapped: SecurityD1Database = {
    prepare: (sql) => securityDb.prepare(sql),
    batch: async (statements) => {
      const hook = beforeBatch;
      beforeBatch = null;
      hook?.();
      return securityDb.batch(statements);
    },
  };
  const call = async (
    as: typeof MAINTAINER,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => {
    actor = as;
    const response = await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin: ORIGIN, "content-type": "application/json" }
            : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        db: wrapped,
        now: () => new Date("2026-10-19T10:00:00.000Z"),
        randomId: () => {
          ids += 1;
          return `case${String(ids).padStart(8, "0")}`;
        },
        sessionActor: async () => actor,
        github: { fetch, apiOrigin: "https://api.github.invalid" },
      },
    );
    return {
      status: response?.status ?? 0,
      body: (await response?.json()) as Reply,
    };
  };
  let keys = 0;
  const key = () => {
    keys += 1;
    return `test-key-${String(keys).padStart(8, "0")}`;
  };
  // Inbox rows (NOT-01, SEC-09): event key, kind, subject, detail and link.
  const inbox = (recipient: { githubId: string }) =>
    sqlite
      .query(
        "SELECT event_key, kind, subject, detail, action_path FROM notifications WHERE recipient_github_id = ? ORDER BY event_key",
      )
      .all(recipient.githubId) as Record<string, string | null>[];
  return {
    sqlite,
    call,
    key,
    inbox,
    setBeforeBatch: (hook: () => void) => {
      beforeBatch = hook;
    },
  };
}

/** Real API steps for a paid program, shared by the award tests. */
function awardSteps({ call, key, sqlite }: ReturnType<typeof open>) {
  let advisories = 0;
  const record = async (receivedAt: string) => {
    advisories += 1;
    const recorded = await call(MAINTAINER, "POST", "security-cases", {
      mode: "record",
      projectId: PROJECT,
      advisory: `GHSA-2c3f-4g5h-6j${"23456789"[advisories - 1]}m`,
      reporterGithubId: REPORTER.githubId,
      reporterGithubLogin: REPORTER.githubLogin,
      receivedAt,
      confirmation: true,
      idempotencyKey: key(),
    });
    expect(recorded.status).toBe(201);
    return recorded.body.case;
  };
  const act = async (
    as: typeof MAINTAINER,
    id: string,
    fields: Record<string, unknown>,
  ) => {
    const current = await call(as, "GET", `security-cases/${id}`);
    return call(as, "POST", `security-cases/${id}/actions`, {
      expectedRevision: current.body.case.revision,
      idempotencyKey: key(),
      ...fields,
    });
  };
  const decide = (id: string, rootCauseKey: string, relatedParty = false) =>
    act(MAINTAINER, id, {
      action: "decide",
      outcome: "confirmed",
      severity: "critical",
      loss: "verified-actual",
      inScope: true,
      reason: "Confirmed critical loss of covered funds.",
      evidenceReference: "private-evidence-1",
      relatedParty,
      rootCauseKey,
      evidenceDigest: "a".repeat(64),
    });
  // The owner raises capacity to 2 by an appended project revision.
  const raiseCapacity = () => {
    const raised = programManifest({
      ...OPEN_PROGRAM,
      capacity: { awards: 2, closesAt: null },
    });
    const raisedDigest = createHash("sha256").update(raised).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 2, ?, ?, 'raise capacity', ?)",
      )
      .run(PROJECT, raised, raisedDigest, RECEIVED);
    sqlite
      .query(
        "UPDATE projects SET revision = 2, manifest = ?, manifest_sha256 = ? WHERE id = ?",
      )
      .run(raised, raisedDigest, PROJECT);
  };
  // Inbox rows one account received for a case (NOT-01, SEC-09).
  const inbox = (account: typeof MAINTAINER, caseId: string) =>
    (
      sqlite
        .query(
          "SELECT event_key FROM notifications WHERE recipient_github_id = ? AND event_key LIKE ? ORDER BY event_key",
        )
        .all(account.githubId, `security-case:${caseId}:%`) as {
        event_key: string;
      }[]
    ).map((row) => row.event_key);
  return { record, act, decide, raiseCapacity, inbox };
}

describe("security cases", () => {
  test("a rejected link can be corrected by a new claim or a record", async () => {
    const { call, key, inbox } = open();
    const claim = () =>
      call(REPORTER, "POST", "security-cases", {
        mode: "claim",
        projectId: PROJECT,
        advisory: ADVISORY,
        idempotencyKey: key(),
      });
    const record = (idempotencyKey = key()) =>
      call(MAINTAINER, "POST", "security-cases", {
        mode: "record",
        projectId: PROJECT,
        advisory: ADVISORY,
        reporterGithubId: REPORTER.githubId,
        reporterGithubLogin: REPORTER.githubLogin,
        receivedAt: RECEIVED,
        confirmation: true,
        idempotencyKey,
      });
    const first = await claim();
    expect(first.status).toBe(201);
    // A record over an open claim wrote nothing, so it is not a success.
    const overClaim = await record();
    expect(overClaim.status).toBe(409);
    expect(overClaim.body.error).toBe("claim_pending");
    const rejected = await call(
      MAINTAINER,
      "POST",
      `security-cases/${first.body.case.id}/actions`,
      {
        action: "reject-link",
        expectedRevision: 1,
        idempotencyKey: key(),
        reason: "The advisory names a different reporter.",
      },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.case.submissionState).toBe("link-rejected");
    // The reporter links again: a new live case, not the rejected one.
    const again = await claim();
    expect(again.status).toBe(201);
    expect(again.body.case.id).not.toBe(first.body.case.id);
    expect(again.body.case.submissionState).toBe("claimed");
    const reject2 = await call(
      MAINTAINER,
      "POST",
      `security-cases/${again.body.case.id}/actions`,
      {
        action: "reject-link",
        expectedRevision: 1,
        idempotencyKey: key(),
        reason: "Rejected again so the maintainer records it directly.",
      },
    );
    expect(reject2.status).toBe(200);
    // The maintainer records the advisory; the verified receipt is written.
    const recordKey = key();
    const recorded = await record(recordKey);
    expect(recorded.status).toBe(201);
    expect(recorded.body.case).toMatchObject({
      submissionState: "verified",
      receivedAt: RECEIVED,
    });
    // Only the exact request replays; another record is refused.
    const replay = await record(recordKey);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.case.id).toBe(recorded.body.case.id);
    const other = await record();
    expect(other.status).toBe(409);
    expect(other.body.error).toBe("advisory_already_recorded");
    // The inbox holds one row per event and recipient, with only the private
    // case reference and the sign-in link (SEC-09). A replay adds nothing,
    // and nobody is told about their own action.
    const row = (id: string, revision: number) => ({
      event_key: `security-case:${id}:${revision}`,
      kind: "security_case",
      subject: id,
      detail: null,
      action_path: "/security",
    });
    const ids = [first, again, recorded].map(
      (reply) => reply.body.case.id as string,
    );
    expect(inbox(MAINTAINER)).toEqual(
      [row(ids[0], 1), row(ids[1], 1)].sort((a, b) =>
        a.event_key.localeCompare(b.event_key),
      ),
    );
    expect(inbox(REPORTER)).toEqual(
      [row(ids[0], 2), row(ids[1], 2), row(ids[2], 1)].sort((a, b) =>
        a.event_key.localeCompare(b.event_key),
      ),
    );
    expect(inbox(TRIAGER)).toEqual([]);
  });

  test("a stale triager change grants or revokes nothing", async () => {
    const { call, key, sqlite, setBeforeBatch, inbox } = open();
    const recorded = await call(MAINTAINER, "POST", "security-cases", {
      mode: "record",
      projectId: PROJECT,
      advisory: ADVISORY,
      reporterGithubId: REPORTER.githubId,
      reporterGithubLogin: REPORTER.githubLogin,
      receivedAt: RECEIVED,
      confirmation: true,
      idempotencyKey: key(),
    });
    expect(recorded.status).toBe(201);
    const id = recorded.body.case.id as string;
    // Another maintainer moves the case two revisions ahead while this
    // request is in flight, so its event guard skips instead of colliding.
    const advanceTwice = () => {
      for (const revision of [2, 3]) {
        sqlite
          .query(
            "UPDATE security_cases SET revision = ?, updated_at = ? WHERE id = ?",
          )
          .run(revision, RECEIVED, id);
        sqlite
          .query(
            "INSERT INTO security_case_events (case_id, case_revision, kind, actor_github_id, actor_role, idempotency_key, detail, at) VALUES (?, ?, 'next-action', ?, 'security-maintainer', ?, '{}', ?)",
          )
          .run(id, revision, MAINTAINER.githubId, key(), RECEIVED);
      }
    };
    const members = () =>
      sqlite
        .query(
          "SELECT github_id, revoked_at FROM security_case_members WHERE case_id = ?",
        )
        .all(id) as { github_id: string; revoked_at: string | null }[];
    setBeforeBatch(advanceTwice);
    const stale = await call(
      MAINTAINER,
      "POST",
      `security-cases/${id}/actions`,
      {
        action: "assign-triager",
        expectedRevision: 1,
        idempotencyKey: key(),
        ...TRIAGER,
      },
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe("stale_revision");
    expect(members()).toEqual([]);
    expect(inbox(TRIAGER)).toEqual([]);
    expect((await call(TRIAGER, "GET", `security-cases/${id}`)).status).toBe(
      404,
    );

    const assigned = await call(
      MAINTAINER,
      "POST",
      `security-cases/${id}/actions`,
      {
        action: "assign-triager",
        expectedRevision: 3,
        idempotencyKey: key(),
        ...TRIAGER,
      },
    );
    expect(assigned.status).toBe(200);
    expect(members()).toEqual([
      { github_id: TRIAGER.githubId, revoked_at: null },
    ]);
    // Only the assignment that landed reaches the triager.
    expect(inbox(TRIAGER).map((n) => n.event_key)).toEqual([
      `security-case:${id}:4`,
    ]);

    setBeforeBatch(() => {
      for (const revision of [5, 6]) {
        sqlite
          .query("UPDATE security_cases SET revision = ? WHERE id = ?")
          .run(revision, id);
        sqlite
          .query(
            "INSERT INTO security_case_events (case_id, case_revision, kind, actor_github_id, actor_role, idempotency_key, detail, at) VALUES (?, ?, 'next-action', ?, 'security-maintainer', ?, '{}', ?)",
          )
          .run(id, revision, MAINTAINER.githubId, key(), RECEIVED);
      }
    });
    const staleRevoke = await call(
      MAINTAINER,
      "POST",
      `security-cases/${id}/actions`,
      {
        action: "revoke-triager",
        expectedRevision: 4,
        idempotencyKey: key(),
        githubId: TRIAGER.githubId,
      },
    );
    expect(staleRevoke.status).toBe(409);
    expect(members()).toEqual([
      { github_id: TRIAGER.githubId, revoked_at: null },
    ]);
    const events = sqlite
      .query(
        "SELECT kind FROM security_case_events WHERE case_id = ? AND kind LIKE '%triager' ORDER BY case_revision",
      )
      .all(id) as { kind: string }[];
    expect(events).toEqual([{ kind: "assign-triager" }]);
  });

  test("raised capacity funds the earliest waiting receipt on every reserving path", async () => {
    const env = open(OPEN_PROGRAM);
    const { sqlite } = env;
    const { record, act, decide, raiseCapacity, inbox } = awardSteps(env);
    const funded = await record("2026-10-19T09:10:00.000Z");
    const waiting = await record("2026-10-19T09:20:00.000Z");
    const later = await record("2026-10-19T09:30:00.000Z");
    const related = await record("2026-10-19T09:40:00.000Z");
    expect((await decide(funded.id, "vault-drain")).body.case.awardState).toBe(
      "reserved",
    );
    // Capacity 1 is used, so the earlier valid finding waits.
    expect((await decide(waiting.id, "oracle-skew")).body.case.awardState).toBe(
      "capacity-exhausted",
    );
    raiseCapacity();
    // A related-party approval cannot take the slot the earlier receipt
    // waits for.
    expect(
      (await decide(related.id, "fee-rounding", true)).body.case.awardState,
    ).toBe("pending");
    const approved = await act(DISPUTE, related.id, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Approved after independent review.",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.case.awardState).toBe("capacity-exhausted");
    // A later decision cannot take it either.
    const laterDecided = await decide(later.id, "bridge-replay");
    expect(laterDecided.status).toBe(200);
    expect(laterDecided.body.case.awardState).toBe("capacity-exhausted");
    const reserve = (id: string) =>
      act(FINANCE, id, {
        action: "reserve-award",
        reason: "Capacity raised by revision; earliest receipt first.",
      });
    expect((await reserve(later.id)).body.error).toBe(
      "earlier_receipt_waiting",
    );
    const reserved = await reserve(waiting.id);
    expect(reserved.status).toBe(200);
    expect(reserved.body.case.awardState).toBe("reserved");
    // The reservation reaches the other financial approver, never the
    // actor; a related-party approval that reserved nothing reaches no one
    // in finance.
    expect(inbox(FINANCE_2, waiting.id)).toEqual([
      `security-case:${waiting.id}:3`,
    ]);
    expect(inbox(FINANCE, waiting.id)).toEqual([]);
    expect(inbox(FINANCE_2, related.id)).toEqual([]);
    // Capacity 2 is now used; the later findings still wait their turn.
    expect((await reserve(later.id)).body.error).toBe("capacity_exhausted");
    expect(
      sqlite
        .query(
          "SELECT case_id FROM security_award_reservations ORDER BY reserved_at, case_id",
        )
        .all()
        .map((row) => (row as { case_id: string }).case_id)
        .sort(),
    ).toEqual([funded.id, waiting.id].sort());
  });

  test("a pending related-party review holds its root cause and its place", async () => {
    const env = open(OPEN_PROGRAM);
    const { act, decide, record, inbox } = awardSteps(env);
    const related = await record("2026-10-19T09:10:00.000Z");
    const otherCause = await record("2026-10-19T09:20:00.000Z");
    const sameCause = await record("2026-10-19T09:30:00.000Z");
    expect(
      (await decide(related.id, "shared-cause", true)).body.case.awardState,
    ).toBe("pending");
    // The dispute reviewers learn that a review waits for them; finance
    // learns nothing before an award is reserved.
    for (const reviewer of [DISPUTE, DISPUTE_2])
      expect(inbox(reviewer, related.id)).toEqual([
        `security-case:${related.id}:2`,
      ]);
    expect(inbox(FINANCE, related.id)).toEqual([]);
    // The earlier receipt waits for its independent review, so a later
    // finding cannot take the only capacity.
    expect(
      (await decide(otherCause.id, "other-cause")).body.case.awardState,
    ).toBe("capacity-exhausted");
    // The pending review holds its root cause: a later report records a
    // duplicate instead.
    const duplicate = await decide(sameCause.id, "shared-cause");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("root_cause_reserved");
    const approved = await act(DISPUTE, related.id, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Approved after independent review.",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.case.awardState).toBe("reserved");
    // The approval reserved an award, so finance is told once.
    expect(inbox(FINANCE, related.id)).toEqual([
      `security-case:${related.id}:3`,
    ]);
    // The reviewer is never notified of its own action.
    expect(inbox(DISPUTE, related.id)).toEqual([
      `security-case:${related.id}:2`,
    ]);
  });

  test("a finding that waits for capacity holds its root cause", async () => {
    const env = open(OPEN_PROGRAM);
    const { act, decide, record, raiseCapacity } = awardSteps(env);
    const funded = await record("2026-10-19T09:10:00.000Z");
    const first = await record("2026-10-19T09:20:00.000Z");
    const later = await record("2026-10-19T09:30:00.000Z");
    expect((await decide(funded.id, "vault-drain")).body.case.awardState).toBe(
      "reserved",
    );
    expect((await decide(first.id, "oracle-skew")).body.case.awardState).toBe(
      "capacity-exhausted",
    );
    // The earlier receipt will reserve this root cause once capacity exists,
    // so a later report of it is a duplicate now. Confirming it would leave
    // a finding that can never reserve and offer finance a `reserve-award`
    // that always fails (SEC-04, SEC-06).
    const duplicate = await decide(later.id, "oracle-skew");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("root_cause_reserved");
    const pending = await env.call(
      MAINTAINER,
      "GET",
      `security-cases/${later.id}`,
    );
    expect(pending.body.case.allowedActions).toContain("decide");
    // The earlier receipt still reserves its own root cause.
    raiseCapacity();
    const reserved = await act(FINANCE, first.id, {
      action: "reserve-award",
      reason: "Capacity raised by revision; earliest receipt first.",
    });
    expect(reserved.status).toBe(200);
    expect(reserved.body.case.awardState).toBe("reserved");
    expect((await decide(later.id, "oracle-skew")).body.error).toBe(
      "root_cause_reserved",
    );
  });

  test("a finding that waits for capacity can still be appealed", async () => {
    const env = open(OPEN_PROGRAM);
    const { sqlite } = env;
    const { act, decide, record, raiseCapacity, inbox } = awardSteps(env);
    const funded = await record("2026-10-19T09:10:00.000Z");
    const waiting = await record("2026-10-19T09:20:00.000Z");
    const laterSameCause = await record("2026-10-19T09:30:00.000Z");
    expect((await decide(funded.id, "vault-drain")).body.case.awardState).toBe(
      "reserved",
    );
    // Capacity 1 is used, so the finding stays confirmed and waits for money
    // (SEC-06). The shortage is a financial exception, not a reason to
    // relabel the finding (SEC-12), so its award can still be disputed.
    const decided = await decide(waiting.id, "oracle-skew");
    expect(decided.status).toBe(200);
    expect(decided.body.case.awardState).toBe("capacity-exhausted");
    const reporterSees = await env.call(
      REPORTER,
      "GET",
      `security-cases/${waiting.id}`,
    );
    expect(reporterSees.body.case.receiptState).toBe("confirmed");
    expect(reporterSees.body.case.allowedActions).toContain("appeal");
    const appeal = await act(REPORTER, waiting.id, {
      action: "appeal",
      reason: "The award was withheld for capacity without telling me.",
    });
    expect(appeal.status).toBe(200);
    expect(appeal.body.case.receiptState).toBe("disputed");
    expect(appeal.body.case.appealState).toBe("open");
    // The appeal reaches both dispute reviewers and the reporter, never the
    // maintainer who decided (SEC-04).
    for (const reviewer of [DISPUTE, DISPUTE_2])
      expect(inbox(reviewer, waiting.id)).toEqual([
        `security-case:${waiting.id}:3`,
      ]);
    expect(inbox(REPORTER, waiting.id)).toEqual([
      `security-case:${waiting.id}:1`,
      `security-case:${waiting.id}:2`,
    ]);
    expect(inbox(MAINTAINER, waiting.id)).toEqual([]);
    // The appeal keeps the funding place and the root cause of the earliest
    // receipt: a later report on the same root cause is a duplicate, even
    // after capacity is raised (SEC-04).
    raiseCapacity();
    const laterDecided = await decide(laterSameCause.id, "oracle-skew");
    expect(laterDecided.status).toBe(409);
    expect(laterDecided.body.error).toBe("root_cause_reserved");
    // The independent reviewer can now open the case and resolve the dispute
    // (SEC-04, SEC-18).
    const waitingForReview = await env.call(
      DISPUTE,
      "GET",
      `security-cases/${waiting.id}`,
    );
    expect(waitingForReview.body.case.allowedActions).toContain(
      "decide-appeal",
    );
    // Upholding restores the confirmed receipt unchanged, so the reporter
    // keeps the award its appeal protected (SEC-12).
    const upheld = await act(DISPUTE, waiting.id, {
      action: "decide-appeal",
      outcome: "uphold",
      reason: "The finding stands; only the funding was disputed.",
    });
    expect(upheld.status).toBe(200);
    expect(
      sqlite
        .query(
          "SELECT receipt_state, award_state, appeal_state FROM security_cases WHERE id = ?",
        )
        .get(waiting.id),
    ).toEqual({
      receipt_state: "confirmed",
      award_state: "capacity-exhausted",
      appeal_state: "upheld",
    });
    const reserved = await act(FINANCE, waiting.id, {
      action: "reserve-award",
      reason: "Capacity raised by revision; earliest receipt first.",
    });
    expect(reserved.status).toBe(200);
    expect(reserved.body.case.awardState).toBe("reserved");
    expect(
      sqlite
        .query(
          "SELECT case_id FROM security_award_reservations ORDER BY reserved_at, case_id",
        )
        .all()
        .map((row) => (row as { case_id: string }).case_id)
        .sort(),
    ).toEqual([funded.id, waiting.id].sort());
  });

  test("a returned funding appeal waits for a new decision", async () => {
    const env = open(OPEN_PROGRAM);
    const { sqlite } = env;
    const { act, decide, record, raiseCapacity } = awardSteps(env);
    const funded = await record("2026-10-19T09:10:00.000Z");
    const waiting = await record("2026-10-19T09:20:00.000Z");
    expect((await decide(funded.id, "vault-drain")).body.case.awardState).toBe(
      "reserved",
    );
    expect((await decide(waiting.id, "oracle-skew")).body.case.awardState).toBe(
      "capacity-exhausted",
    );
    expect(
      (
        await act(REPORTER, waiting.id, {
          action: "appeal",
          reason: "The award was withheld for capacity without telling me.",
        })
      ).status,
    ).toBe(200);
    // Returning it sends the finding back for a new decision; the award it
    // waited for is untouched, so nothing is reserved or erased (SEC-12).
    const returned = await act(DISPUTE, waiting.id, {
      action: "decide-appeal",
      outcome: "return",
      reason:
        "Funding shortage is a financial exception, not a finding change.",
    });
    expect(returned.status).toBe(200);
    expect(
      sqlite
        .query(
          "SELECT receipt_state, award_state, appeal_state FROM security_cases WHERE id = ?",
        )
        .get(waiting.id),
    ).toEqual({
      receipt_state: "triaging",
      award_state: "capacity-exhausted",
      appeal_state: "returned",
    });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM security_award_reservations")
        .get(),
    ).toEqual({ n: 1 });
    // A new decision reserves as soon as the program raises its budget, so
    // the returned appeal does not strand the money (SEC-06).
    raiseCapacity();
    const redecided = await decide(waiting.id, "oracle-skew");
    expect(redecided.status).toBe(200);
    expect(redecided.body.case.awardState).toBe("reserved");
  });

  test("a returned appeal cannot clear the related-party review", async () => {
    const env = open(OPEN_PROGRAM);
    const { sqlite } = env;
    const { act, decide, record } = awardSteps(env);
    const related = await record("2026-10-19T09:10:00.000Z");
    expect(
      (await decide(related.id, "insider-cause", true)).body.case.awardState,
    ).toBe("pending");
    const refused = await act(DISPUTE, related.id, {
      action: "decide-related-party",
      outcome: "refuse",
      reason: "Refused after independent review.",
    });
    expect(refused.body.case.awardState).toBe("ineligible");
    expect(
      (
        await act(REPORTER, related.id, {
          action: "appeal",
          reason: "The related-party refusal used the wrong facts.",
        })
      ).status,
    ).toBe(200);
    const returned = await act(DISPUTE_2, related.id, {
      action: "decide-appeal",
      outcome: "return",
      reason: "Return for a new technical decision.",
    });
    expect(returned.status).toBe(200);
    // A redecision that declares no related party still needs a review.
    const redecided = await decide(related.id, "insider-cause", false);
    expect(redecided.status).toBe(200);
    expect(redecided.body.case.awardState).toBe("pending");
    expect(
      sqlite
        .query(
          "SELECT related_party, related_party_review, related_party_reviewer_github_id FROM security_cases WHERE id = ?",
        )
        .get(related.id),
    ).toEqual({
      related_party: "related",
      related_party_review: "pending",
      related_party_reviewer_github_id: DISPUTE.githubId,
    });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM security_award_reservations")
        .get(),
    ).toEqual({ n: 0 });
  });
});
