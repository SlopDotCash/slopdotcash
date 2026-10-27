// Durable intake through the real API and migrations. The in-memory storage,
// screening answers and unavailable GitHub transport are deterministic fixtures;
// these tests prove controls, not live model quality or provider delivery.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { D1QueryStatement } from "../d1";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import type { SecurityAnalyzer, SecurityScreeningProposal } from "./analysis";
import {
  handleSecurityApi,
  type SecurityApiDependencies,
  type SecurityD1Database,
} from "./handler";

const ORIGIN = "https://slop.test";
const START = "2026-10-27T12:00:00.000Z";
const PROJECT = "private-intake";
const REPOSITORY = "example/private-intake";
const OWNER = { githubId: "710000001", githubLogin: "owner" };
const REPORTER = { githubId: "710000002", githubLogin: "reporter" };
const OTHER = { githubId: "710000003", githubLogin: "other" };
const FINANCE = { githubId: "710000004", githubLogin: "finance" };
const VAULT = `0x${"b".repeat(40)}`;
const ASSET = `0x${"a".repeat(40)}`;
const REPORT = {
  summary: "Withdrawal rounds shares in the wrong direction",
  description:
    "PRIVATE-REPORT-SENTINEL. At commit abc, withdraw() rounds shares down. " +
    "A local test with synthetic funds can repeat a withdrawal and obtain " +
    "more than the synthetic deposit. No public service or real funds used.",
};

type Actor = typeof OWNER;
type Intake = {
  state: string;
  routingState: string;
  receivedAt: string;
  reportVersion: number;
  revision: number;
  canForward: boolean;
  canRetryScreening: boolean;
  canReview: boolean;
  reason: string | null;
};
type Submission = {
  id: string;
  caseId: string;
  state: string;
  intake: Intake;
};
type Case = {
  id: string;
  revision: number;
  receivedAt: string;
  receivedAtSource: string;
  advisory: unknown;
  terms: { grossMinor: string; researcherMinor: string; slopMinor: string };
  awardState: string;
  award: { grossMinor: string; researcherMinor: string; slopMinor: string };
};
type Body = {
  recipientGithubId?: string;
  error?: string;
  authorityUnavailable?: boolean;
  replayed?: boolean;
  submission?: Submission;
  submissions?: Submission[];
  report?: typeof REPORT;
  case?: Case;
};

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Required fixture response is missing");
  return value;
}

function program() {
  return {
    status: "open",
    fundingPolicy: "after-approval",
    funding: { state: "pledged" },
    intake: { repository: REPOSITORY },
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "10000000000",
    },
    sponsor: { name: "Slop", githubId: null },
    approvers: {
      technical: [OWNER],
      financial: [FINANCE],
      dispute: [],
    },
    capacity: { awards: null, closesAt: null },
    responseTargets: {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
    scope: {
      includedAssets: ["Synthetic local vault"],
      severityRubric: "Critical means loss of covered funds.",
      lossDefinition: "Unauthorized loss of covered assets.",
    },
    settlement: {
      chain: "base",
      deployments: [{ network: "base-sepolia", vault: VAULT, asset: ASSET }],
    },
  };
}

function fixture() {
  const { db, sqlite } = sqliteD1();
  const statementSql = new WeakMap<object, string>();
  let routeFails = false;
  const tracked = (
    statement: D1QueryStatement,
    sql: string,
  ): D1QueryStatement => {
    const result = {
      ...statement,
      bind: (...values: unknown[]) => tracked(statement.bind(...values), sql),
    };
    statementSql.set(result, sql);
    return result;
  };
  const controlDb: SecurityD1Database = {
    prepare: (sql) => tracked(db.prepare(sql), sql),
    batch: async (statements) => {
      if (
        routeFails &&
        statements.some((statement) => {
          const sql = statementSql.get(statement) ?? "";
          return (
            (sql.includes("INSERT INTO notifications") &&
              sql.includes("review_decision='forward'")) ||
            sql.includes("UPDATE security_submission_intake SET routed_at=")
          );
        })
      )
        throw new Error("Fixture owner-route outage");
      return db.batch(statements);
    },
  };
  const base = applicationManifest(PROJECT, REPOSITORY, {
    status: "active",
    securityBounty: program(),
  });
  let manifest = base;
  function publish(next: typeof manifest) {
    const revision =
      (
        sqlite
          .query("SELECT revision FROM projects WHERE id = ?")
          .get(PROJECT) as { revision: number } | null
      )?.revision ?? 0;
    const text = JSON.stringify(next);
    const digest = createHash("sha256").update(text).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(PROJECT, revision + 1, text, digest, "Fixture terms", START);
    if (revision === 0) {
      sqlite
        .query(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',?,?,?,?,?)",
        )
        .run(PROJECT, 1, text, digest, START, START);
    } else {
      sqlite
        .query(
          "UPDATE projects SET revision=?,manifest=?,manifest_sha256=?,updated_at=? WHERE id=?",
        )
        .run(revision + 1, text, digest, START, PROJECT);
    }
    manifest = next;
  }
  publish(base);
  const objects = new Map<
    string,
    { bytes: Uint8Array; customMetadata: Record<string, string> }
  >();
  let beforeStore: (() => Promise<void>) | null = null;
  const storage: R2Bucket = {
    async put(key, bytes, options) {
      const callback = beforeStore;
      beforeStore = null;
      if (callback) await callback();
      if (!objects.has(key))
        objects.set(key, {
          bytes: bytes.slice(),
          customMetadata: options.customMetadata,
        });
    },
    async head(key) {
      const object = objects.get(key);
      return object
        ? {
            size: object.bytes.byteLength,
            customMetadata: object.customMetadata,
          }
        : null;
    },
    async get(key) {
      const object = objects.get(key);
      return object
        ? {
            size: object.bytes.byteLength,
            customMetadata: object.customMetadata,
            body: required(
              new Response(new Uint8Array(object.bytes).buffer).body,
            ),
          }
        : null;
    },
  };
  let actor: Actor | null = REPORTER;
  let clock = Date.parse(START);
  let sequence = 0;
  let screeningCalls = 0;
  let decision: SecurityScreeningProposal["decision"] = "legitimate";
  let screeningFails = false;
  let beforeScreenResult: (() => Promise<void>) | null = null;
  const screenedDescriptions: string[] = [];
  const analyzer: SecurityAnalyzer = {
    provider: "deterministic-fixture",
    model: "fixture-screening",
    async analyze() {
      throw new Error("This control test does not qualify case analysis");
    },
    async screen(input) {
      screeningCalls++;
      screenedDescriptions.push(input.report.description);
      if (beforeScreenResult) await beforeScreenResult();
      if (screeningFails) throw new Error("PRIVATE-PROVIDER-ERROR-SENTINEL");
      return {
        decision,
        reason:
          decision === "legitimate"
            ? "Concrete isolated reproduction merits human review."
            : "Provide a concrete affected function and isolated reproduction.",
      };
    },
  };
  const deps: SecurityApiDependencies = {
    db: controlDb,
    now: () => new Date(clock),
    randomId: () => `fixture${String(++sequence).padStart(12, "0")}`,
    sessionActor: async () => actor,
    reportStorage: storage,
    analyzer,
    // Deliberately no GitHub intake OAuth, installation or advisory transport.
    reportingRead: async () => ({ kind: "unavailable" }),
  };
  const call = async (
    as: Actor | null,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    origin = ORIGIN,
  ) => {
    actor = as;
    const response = await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers:
          method === "POST"
            ? { origin, "content-type": "application/json" }
            : {},
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      deps,
    );
    const handled = required(response);
    return {
      status: handled.status,
      headers: handled.headers,
      body: (await handled.json()) as Body,
    };
  };
  const create = (key = `intake-key-${++sequence}`, as: Actor = REPORTER) =>
    call(as, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: key.padEnd(20, "0"),
      origin: "slop",
      report: REPORT,
    });
  const caseAction = async (
    caseId: string,
    fields: Record<string, unknown>,
  ) => {
    const current = await call(OWNER, "GET", `security-cases/${caseId}`);
    return call(OWNER, "POST", `security-cases/${caseId}/actions`, {
      expectedRevision: required(current.body.case).revision,
      idempotencyKey: `case-action-${++sequence}`.padEnd(20, "0"),
      ...fields,
    });
  };
  const notices = (as: Actor) =>
    sqlite
      .query("SELECT * FROM notifications WHERE recipient_github_id=?")
      .all(as.githubId);
  return {
    sqlite,
    deps,
    objects,
    call,
    create,
    caseAction,
    notices,
    screenedDescriptions,
    screeningCalls: () => screeningCalls,
    decision: (value: SecurityScreeningProposal["decision"]) => {
      decision = value;
    },
    failScreening: (value: boolean) => {
      screeningFails = value;
    },
    failRouting: (value: boolean) => {
      routeFails = value;
    },
    beforeScreen: (callback: (() => Promise<void>) | null) => {
      beforeScreenResult = callback;
    },
    beforeStore: (callback: () => Promise<void>) => {
      beforeStore = callback;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    addReviewer: () =>
      publish({
        ...manifest,
        securityBounty: {
          ...program(),
          approvers: {
            technical: [OWNER, OTHER],
            financial: [FINANCE],
            dispute: [],
          },
        },
      }),
    revokeOwner: () =>
      publish({
        ...manifest,
        securityBounty: {
          ...program(),
          approvers: { technical: [OTHER], financial: [FINANCE], dispute: [] },
        },
      }),
    removePaidTerms: () => {
      const next = { ...manifest };
      delete next.securityBounty;
      publish(next);
    },
    fund: () => {
      publish({
        ...manifest,
        securityBounty: {
          ...program(),
          funding: {
            state: "verified-available",
            evidence: "fixture-finalized-deposit",
            verifiedAt: START,
          },
        },
      });
      sqlite
        .query(
          `INSERT INTO security_vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?,'base-sepolia','base',?,?,6,'10000000000','0','0','0','0','0','10000000000',NULL,NULL,NULL,'0','64',?,?)`,
        )
        .run(PROJECT, VAULT, ASSET, START, START);
    },
  };
}

describe("durable private report controls", () => {
  test.each(["send", "decision"] as const)(
    "a report revision cannot replace evidence after a concurrent %s commits",
    async (interruption) => {
      const t = fixture();
      t.decision("needs-information");
      const accepted = await t.create();
      const submission = required(accepted.body.submission);
      t.beforeStore(async () => {
        if (interruption === "send") {
          // A concurrent /send has committed its state transition before
          // contacting GitHub. The pending storage write resumes afterward.
          t.sqlite
            .query(
              "UPDATE security_submissions SET state='submitting',attempt=attempt+1,attempt_started_at=?,revision=revision+1,updated_at=? WHERE id=? AND state='draft'",
            )
            .run(START, START, submission.id);
        } else {
          const decided = await t.caseAction(submission.caseId, {
            action: "decide",
            outcome: "confirmed",
            severity: "critical",
            loss: "verified-potential",
            inScope: true,
            reason: "The owner completed the isolated reproduction.",
            relatedParty: false,
            rootCauseKey: "withdrawal-share-rounding",
          });
          expect(decided.status).toBe(200);
        }
      });
      const revised = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/report`,
        {
          expectedRevision: submission.intake.revision,
          report: {
            ...REPORT,
            description: `${REPORT.description} Replacement content.`,
          },
        },
      );
      expect(revised.status).toBe(409);
      const retained = await t.call(
        REPORTER,
        "GET",
        `security-submissions/${submission.id}`,
      );
      expect(required(retained.body.submission).intake.reportVersion).toBe(1);
      expect(retained.body.report).toEqual(REPORT);
      expect(
        t.sqlite.query("SELECT version FROM security_intake_reports").all(),
      ).toEqual([{ version: 1 }]);
    },
  );

  test("disabling new intake keeps an existing report privately readable", async () => {
    const t = fixture();
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    t.deps.reportIntakeEnabled = false;
    const refused = await t.create("after-intake-disabled");
    expect(refused.status).toBe(503);
    const retained = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    expect(retained.status).toBe(200);
    expect(retained.body.report).toEqual(REPORT);
    const listed = await t.call(REPORTER, "GET", "security-submissions");
    expect(listed.body.recipientGithubId).toBe(REPORTER.githubId);
    expect(required(listed.body.submissions).map((row) => row.id)).toEqual([
      submission.id,
    ]);
    const foreign = await t.call(OTHER, "GET", "security-submissions");
    expect(foreign.body.recipientGithubId).toBe(OTHER.githubId);
    expect(foreign.body.submissions).toEqual([]);
    expect(t.objects.size).toBe(1);
  });

  test("the first owner-confirmed qualifying receipt keeps priority before and after funding", async () => {
    const t = fixture();
    const first = required(
      (await t.create("earlier-qualifying-report")).body.submission,
    );
    const decision = {
      action: "decide",
      outcome: "confirmed",
      severity: "critical",
      loss: "verified-potential",
      inScope: true,
      reason: "The owner independently reproduced this loss-of-funds finding.",
      relatedParty: false,
      rootCauseKey: "withdrawal-share-rounding",
    };
    expect((await t.caseAction(first.caseId, decision)).status).toBe(200);
    t.advance(1000);
    const later = required(
      (await t.create("later-qualifying-report", OTHER)).body.submission,
    );
    expect((await t.caseAction(later.caseId, decision)).status).toBe(200);
    const awardLater = () =>
      t.caseAction(later.caseId, {
        action: "award",
        decision: "amount",
        grossMinor: "10000000000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
        reason: "Attempt to award the later same-finding report.",
      });
    const pending = await awardLater();
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe("earlier_qualifying_report");
    t.fund();
    const funded = await awardLater();
    expect(funded.status).toBe(409);
    expect(funded.body.error).toBe("earlier_qualifying_report");
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toEqual([]);
    const firstCase = await t.call(
      OWNER,
      "GET",
      `security-cases/${first.caseId}`,
    );
    expect(required(firstCase.body.case).award).toBeNull();
  });

  test("an earlier qualifying report keeps priority while its no-award decision is appealed", async () => {
    const t = fixture();
    const first = required(
      (await t.create("earlier-appealed-report")).body.submission,
    );
    const decision = {
      action: "decide",
      outcome: "confirmed",
      severity: "critical",
      loss: "verified-potential",
      inScope: true,
      reason: "The local reproduction proves a critical loss of funds.",
      relatedParty: false,
      rootCauseKey: "appealed-withdrawal-owner-check",
    };
    expect((await t.caseAction(first.caseId, decision)).status).toBe(200);
    expect(
      (
        await t.caseAction(first.caseId, {
          action: "award",
          decision: "none",
          reason: "The owner declines an award for this confirmed report.",
        })
      ).status,
    ).toBe(200);
    const firstCase = required(
      (await t.call(REPORTER, "GET", `security-cases/${first.caseId}`)).body
        .case,
    );
    const appealed = await t.call(
      REPORTER,
      "POST",
      `security-cases/${first.caseId}/actions`,
      {
        action: "appeal",
        expectedRevision: firstCase.revision,
        idempotencyKey: "appeal-first-qualifying-report",
        reason:
          "Please review why this confirmed qualifying report has no award.",
      },
    );
    expect(appealed.status).toBe(200);
    expect(
      t.sqlite
        .query(
          "SELECT receipt_state,appeal_state,appeal_from_state FROM security_cases WHERE id=?",
        )
        .get(first.caseId),
    ).toEqual({
      receipt_state: "disputed",
      appeal_state: "open",
      appeal_from_state: "confirmed",
    });
    t.advance(1000);
    const later = required(
      (await t.create("later-report-during-appeal", OTHER)).body.submission,
    );
    expect((await t.caseAction(later.caseId, decision)).status).toBe(200);
    const awardLater = () =>
      t.caseAction(later.caseId, {
        action: "award",
        decision: "amount",
        grossMinor: "10000000000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
        reason:
          "Try to award the later duplicate while the first appeal is open.",
      });
    const unfunded = await awardLater();
    expect(unfunded.status).toBe(409);
    expect(unfunded.body.error).toBe("earlier_qualifying_report");
    t.fund();
    const funded = await awardLater();
    expect(funded.status).toBe(409);
    expect(funded.body.error).toBe("earlier_qualifying_report");
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toHaveLength(0);
  });

  test("an after-approval award cannot substitute another amount for its published gross", async () => {
    const t = fixture();
    const submission = required((await t.create()).body.submission);
    expect(
      (
        await t.caseAction(submission.caseId, {
          action: "decide",
          outcome: "confirmed",
          severity: "critical",
          loss: "verified-potential",
          inScope: true,
          reason: "The isolated reproduction proves the qualifying finding.",
          relatedParty: false,
          rootCauseKey: "withdrawal-share-rounding",
        })
      ).status,
    ).toBe(200);
    const changed = await t.caseAction(submission.caseId, {
      action: "award",
      decision: "amount",
      grossMinor: "1000000",
      paymentDeadline: "2026-11-30T00:00:00.000Z",
      confirmation: true,
      reason: "Attempt to change the advertised qualifying amount.",
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error).toBe("award_amount_mismatch");
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toEqual([]);
  });

  test("saves a Slop receipt, screens and routes without GitHub, keeping the body private", async () => {
    const t = fixture();
    const accepted = await t.create();
    expect(accepted.status).toBe(201);
    expect(accepted.headers.get("cache-control")).toBe("private, no-store");
    const submission = required(accepted.body.submission);
    expect(submission.intake.state).toBe("legitimate");
    expect(submission.intake.canForward).toBe(true);
    const received = await t.call(
      REPORTER,
      "GET",
      `security-cases/${submission.caseId}`,
    );
    expect(received.body.case).toMatchObject({
      advisory: null,
      receivedAt: START,
      receivedAtSource: "slop-received",
      terms: {
        grossMinor: "10000000000",
        researcherMinor: "7500000000",
        slopMinor: "2500000000",
      },
    });
    expect(t.notices(REPORTER)).toHaveLength(1);
    expect(t.notices(OWNER)).toHaveLength(1);
    const read = await t.call(
      OWNER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    expect(read.body.report).toEqual(REPORT);
    expect(t.screenedDescriptions).toEqual([REPORT.description]);
    expect(
      t.sqlite.query("SELECT * FROM security_intake_access_log").all(),
    ).toHaveLength(1);
    for (const table of [
      "security_cases",
      "security_submissions",
      "security_submission_events",
      "security_intake_reports",
      "notifications",
      "security_notification_outbox",
    ]) {
      expect(
        JSON.stringify(t.sqlite.query(`SELECT * FROM ${table}`).all()),
      ).not.toContain("PRIVATE-REPORT-SENTINEL");
    }
  });

  test("replays an accepted request once and refuses changing its project or body", async () => {
    const t = fixture();
    const key = "stable-private-intake-key";
    const accepted = await t.create(key);
    const replay = await t.create(key);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(required(replay.body.submission).id).toBe(
      required(accepted.body.submission).id,
    );
    expect(t.screeningCalls()).toBe(1);
    expect(t.objects.size).toBe(1);
    expect(t.notices(OWNER)).toHaveLength(1);
    const changed = await t.call(REPORTER, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: key,
      origin: "slop",
      report: {
        ...REPORT,
        description: `${REPORT.description} Changed report.`,
      },
    });
    expect(changed.status).toBe(409);
    expect(t.objects.size).toBe(1);
  });

  test.each(["needs-information", "spam"] as const)(
    "%s remains private and recoverable without notifying the owner",
    async (decision) => {
      const t = fixture();
      t.decision(decision);
      const accepted = await t.create();
      const submission = required(accepted.body.submission);
      expect(accepted.status).toBe(201);
      expect(submission.intake.state).toBe(decision);
      expect(submission.intake.canForward).toBe(false);
      expect(t.notices(OWNER)).toHaveLength(0);
      const selfReview = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/review`,
        {
          expectedRevision: submission.intake.revision,
          decision: "forward",
          reason: "I want to bypass screening.",
        },
      );
      expect(selfReview.status).toBe(403);
      const reviewed = await t.call(
        OWNER,
        "POST",
        `security-submissions/${submission.id}/review`,
        {
          expectedRevision: submission.intake.revision,
          decision: "forward",
          reason: "I inspected the reproduction and will review privately.",
        },
      );
      expect(reviewed.status).toBe(200);
      expect(required(reviewed.body.submission).intake.canForward).toBe(true);
      expect(required(reviewed.body.submission).intake.routingState).toBe(
        "routed",
      );
      // The owner made this decision and does not receive their own notice.
      expect(t.notices(OWNER)).toHaveLength(0);
      expect(t.objects.size).toBe(1);
    },
  );

  test("retains a failed-screening receipt and immutable versions while requesting a revision", async () => {
    const t = fixture();
    t.failScreening(true);
    const accepted = await t.create();
    let submission = required(accepted.body.submission);
    expect(accepted.status).toBe(201);
    expect(submission.intake.state).toBe("unavailable");
    expect(JSON.stringify(accepted.body)).not.toContain(
      "PRIVATE-PROVIDER-ERROR-SENTINEL",
    );
    expect(t.notices(OWNER)).toHaveLength(0);
    const before = [...t.objects.values()][0].bytes.slice();
    t.failScreening(false);
    const revisedReport = {
      ...REPORT,
      description: `${REPORT.description} A second local test confirms it.`,
    };
    const revised = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      { expectedRevision: submission.intake.revision, report: revisedReport },
    );
    expect(revised.status).toBe(200);
    submission = required(revised.body.submission);
    expect(submission.intake.state).toBe("legitimate");
    expect(submission.intake.reportVersion).toBe(2);
    expect(t.objects.size).toBe(2);
    expect([...t.objects.values()][0].bytes).toEqual(before);
    const read = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    expect(read.body.report).toEqual(revisedReport);
    expect(t.notices(OWNER)).toHaveLength(1);
  });

  test("rejects cross-account, financial-only and revoked access without returning report content", async () => {
    const t = fixture();
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    for (const actor of [null, OTHER, FINANCE]) {
      const read = await t.call(
        actor,
        "GET",
        `security-submissions/${submission.id}`,
      );
      expect(read.status).toBe(actor === null ? 401 : 404);
      expect(read.body.report).toBeUndefined();
    }
    const listed = await t.call(OTHER, "GET", "security-submissions");
    expect(listed.body.submissions).toEqual([]);
    const forgedOrigin = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      {
        projectId: PROJECT,
        idempotencyKey: "forged-origin-intake-key",
        origin: "slop",
        report: REPORT,
      },
      "https://attacker.example",
    );
    expect(forgedOrigin.status).toBe(403);
    t.revokeOwner();
    const revoked = await t.call(
      OWNER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    expect(revoked.status).toBe(404);
    expect(revoked.body.report).toBeUndefined();
  });

  test("an authority outage preserves owned receipts and each other report uses one fresh authorization", async () => {
    const t = fixture();
    const own = required(
      (await t.create("owned-report", OWNER)).body.submission,
    );
    t.advance(1000);
    const other = required((await t.create("other-report")).body.submission);
    t.removePaidTerms();
    const access = {
      installation: "installed" as const,
      installationId: 1,
      permission: "admin" as const,
      roleName: "admin",
      repository: {
        id: 123456789,
        node_id: "R_example",
        full_name: REPOSITORY,
        private: false,
        owner: {
          id: 987654321,
          node_id: "O_example",
          login: "example",
          type: "Organization" as const,
        },
      },
    };
    let reads = 0;
    t.deps.repositoryAccess = async () => {
      if (++reads === 2) throw new Error("Fixture authority outage");
      return access;
    };
    const interrupted = await t.call(OWNER, "GET", "security-submissions");
    expect(interrupted.status).toBe(200);
    expect(interrupted.body.authorityUnavailable).toBe(true);
    expect(interrupted.body.submissions?.map((row) => row.id)).toEqual([
      own.id,
    ]);

    reads = 0;
    t.deps.repositoryAccess = async () => {
      if (++reads > 2) throw new Error("Unexpected repeated authorization");
      return access;
    };
    const listed = await t.call(OWNER, "GET", "security-submissions");
    expect(listed.status).toBe(200);
    expect(listed.body.authorityUnavailable).toBe(false);
    expect(listed.body.submissions?.map((row) => row.id)).toEqual([
      other.id,
      own.id,
    ]);
    expect(reads).toBe(2);

    t.deps.repositoryAccess = async () => {
      throw new Error("Fixture authority outage");
    };
    const unavailable = await t.call(
      OWNER,
      "GET",
      `security-submissions/${other.id}`,
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.body.report).toBeUndefined();
    const retained = await t.call(
      OWNER,
      "GET",
      `security-submissions/${own.id}`,
    );
    expect(retained.status).toBe(200);
    expect(retained.body.report).toEqual(REPORT);

    t.deps.repositoryAccess = async () => ({ ...access, permission: "read" });
    const denied = await t.call(OWNER, "GET", "security-submissions");
    expect(denied.status).toBe(200);
    expect(denied.body.authorityUnavailable).toBe(false);
    expect(denied.body.submissions?.map((row) => row.id)).toEqual([own.id]);
    const revoked = await t.call(
      OWNER,
      "GET",
      `security-submissions/${other.id}`,
    );
    expect(revoked.status).toBe(404);
    expect(revoked.body.report).toBeUndefined();
    const review = await t.call(
      OWNER,
      "POST",
      `security-submissions/${other.id}/review`,
      {
        expectedRevision: other.intake.revision,
        decision: "forward",
        reason: "Previously listed access cannot authorize this review.",
      },
    );
    expect(review.status).toBe(404);
  });

  test("a candidate storage failure remains fatal instead of appearing as an authority outage", async () => {
    const t = fixture();
    await t.create("owned-report", OWNER);
    const other = required((await t.create("other-report")).body.submission);
    const db = t.deps.db;
    t.deps.db = {
      ...db,
      prepare(sql) {
        const statement = db.prepare(sql);
        if (
          sql !==
          "SELECT * FROM security_submission_intake WHERE submission_id = ?"
        )
          return statement;
        return {
          ...statement,
          bind(...values) {
            if (values[0] === other.id)
              throw new Error("Fixture candidate storage failure");
            return statement.bind(...values);
          },
        };
      },
    };
    const failed = await t.call(OWNER, "GET", "security-submissions");
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe("internal_error");
    expect(failed.body.submissions).toBeUndefined();
    expect(failed.body.authorityUnavailable).toBeUndefined();
  });

  test.each(["report", "screen"] as const)(
    "one report cannot bypass the public work budget through repeated %s calls",
    async (action) => {
      const t = fixture();
      if (action === "report") t.decision("needs-information");
      else t.failScreening(true);
      const accepted = await t.create("budget-original");
      let submission = required(accepted.body.submission);
      const originalId = submission.id;
      let refused: Awaited<ReturnType<typeof t.call>> | undefined;
      for (let index = 1; index <= 10; index++) {
        const before = { objects: t.objects.size, calls: t.screeningCalls() };
        const result = await t.call(
          REPORTER,
          "POST",
          `security-submissions/${submission.id}/${action}`,
          {
            expectedRevision: submission.intake.revision,
            ...(action === "report"
              ? {
                  report: {
                    ...REPORT,
                    description: `${REPORT.description} Revision ${index}.`,
                  },
                }
              : {}),
          },
        );
        if (index < 10) {
          expect(result.status).toBe(200);
          submission = required(result.body.submission);
        } else {
          refused = result;
          expect({
            status: result.status,
            objects: t.objects.size,
            calls: t.screeningCalls(),
          }).toEqual({ status: 429, ...before });
        }
      }
      expect(refused?.body.error).toBe("intake_rate_limited");
      expect(t.screeningCalls()).toBe(10);
      const replay = await t.create("budget-original");
      expect(replay.status).toBe(200);
      expect(required(replay.body.submission).id).toBe(originalId);
      const current = await t.call(
        REPORTER,
        "GET",
        `security-submissions/${originalId}`,
      );
      const reviewed = await t.call(
        OWNER,
        "POST",
        `security-submissions/${originalId}/review`,
        {
          expectedRevision: required(current.body.submission).intake.revision,
          decision: "forward",
          reason:
            "The maintainer can review retained evidence even when the reporter's model-work budget is exhausted.",
        },
      );
      expect(reviewed.status).toBe(200);
      expect(t.screeningCalls()).toBe(10);
      const other = await t.create("other-budget", OTHER);
      expect(other.status).toBe(201);
      t.advance(3600_001);
      const recovered = await t.create("later-budget");
      expect(recovered.status).toBe(201);
    },
  );

  test("concurrent public intake refuses before writing excess private objects or calling the model", async () => {
    const t = fixture();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        t.create(`concurrent-budget-${String(index).padStart(2, "0")}`),
      ),
    );
    expect(results.filter((row) => row.status === 201)).toHaveLength(10);
    expect(results.filter((row) => row.status === 429)).toHaveLength(2);
    expect(t.objects.size).toBe(10);
    expect(t.screeningCalls()).toBe(10);
  });

  test("rolling admission prevents orphan writes across a window boundary", async () => {
    const t = fixture();
    expect((await t.create("first-boundary")).status).toBe(201);
    t.advance(3_599_000);
    for (let index = 0; index < 9; index++)
      expect((await t.create(`late-boundary-${index}`)).status).toBe(201);
    t.advance(2_000);
    const results = await Promise.all([
      t.create("new-boundary-A"),
      t.create("new-boundary-B"),
    ]);
    expect(results.map((row) => row.status).sort()).toEqual([201, 429]);
    expect(t.objects.size).toBe(11);
    expect(t.screeningCalls()).toBe(11);
  });

  test("a slow screening retry returns before the browser deadline and remains refreshable", async () => {
    const t = fixture();
    t.failScreening(true);
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    t.failScreening(false);
    const provider = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let screeningFinished = false;
    t.beforeScreen(async () => {
      started.resolve();
      await provider.promise;
      screeningFinished = true;
    });
    const pending: Promise<unknown>[] = [];
    t.deps.waitUntil = (task) => {
      pending.push(task);
    };
    const start = performance.now();
    const retry = t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      {
        expectedRevision: submission.intake.revision,
      },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () =>
          reject(new Error("Screening retry exceeded the browser deadline")),
        15_000,
      );
    });
    try {
      await Promise.race([started.promise, deadline]);
      const retried = await Promise.race([retry, deadline]);
      expect(retried.status).toBe(200);
      expect(performance.now() - start).toBeLessThan(15_000);
      expect(screeningFinished).toBe(false);
      expect(pending).toHaveLength(1);
      const running = await t.call(
        REPORTER,
        "GET",
        `security-submissions/${submission.id}`,
      );
      expect(required(running.body.submission).intake.state).toBe("running");
      expect(running.body.report).toEqual(REPORT);
    } finally {
      clearTimeout(timeout);
      provider.resolve();
      await retry;
      await Promise.all(pending);
    }
    const refreshed = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    expect(required(refreshed.body.submission).intake.state).toBe("legitimate");
    expect(refreshed.body.report).toEqual(REPORT);
  }, 20_000);

  test.each(["queued", "running"] as const)(
    "a retained %s report exposes recovery after its worker is lost",
    async (state) => {
      const t = fixture();
      const accepted = await t.create();
      const original = required(accepted.body.submission);
      t.sqlite
        .query(
          "UPDATE security_submission_intake SET screening_state=?,screening_started_at=?,screening_finished_at=NULL,screening_reason=NULL,routed_at=NULL,revision=revision+1 WHERE submission_id=?",
        )
        .run(state, state === "running" ? START : null, original.id);
      if (state === "running") {
        const active = await t.call(
          REPORTER,
          "GET",
          `security-submissions/${original.id}`,
        );
        expect(required(active.body.submission).intake.canRetryScreening).toBe(
          false,
        );
        t.advance(16 * 60 * 1000);
      }
      const retained = await t.call(
        REPORTER,
        "GET",
        `security-submissions/${original.id}`,
      );
      const submission = required(retained.body.submission);
      expect(submission.intake.canRetryScreening).toBe(true);
      expect(retained.body.report).toEqual(REPORT);
      const retried = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${original.id}/screen`,
        {
          expectedRevision: submission.intake.revision,
        },
      );
      expect(retried.status).toBe(200);
      const recovered = required(retried.body.submission);
      expect(recovered.intake.state).toBe("legitimate");
      expect(recovered.intake.routingState).toBe("routed");
      expect(recovered.intake.receivedAt).toBe(original.intake.receivedAt);
      expect(recovered.intake.reportVersion).toBe(1);
      expect(t.screeningCalls()).toBe(2);
      expect(t.notices(OWNER)).toHaveLength(1);
    },
  );

  test("a human routing decision can retry a failed notification without re-screening", async () => {
    const t = fixture();
    t.addReviewer();
    t.decision("needs-information");
    const accepted = await t.create();
    const original = required(accepted.body.submission);
    t.failRouting(true);
    const reviewed = await t.call(
      OWNER,
      "POST",
      `security-submissions/${original.id}/review`,
      {
        expectedRevision: original.intake.revision,
        decision: "forward",
        reason:
          "The maintainer independently reproduced the synthetic finding.",
      },
    );
    expect(reviewed.status).toBe(500);
    t.failRouting(false);
    const retained = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${original.id}`,
    );
    const submission = required(retained.body.submission);
    const retried = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${original.id}/screen`,
      {
        expectedRevision: submission.intake.revision,
      },
    );
    expect(retried.status).toBe(200);
    expect(submission.intake.canRetryScreening).toBe(true);
    expect(required(retried.body.submission).intake.routingState).toBe(
      "routed",
    );
    expect(t.screeningCalls()).toBe(1);
    expect(t.notices(OTHER)).toHaveLength(1);
    expect(
      t.sqlite
        .query(
          "SELECT review_decision FROM security_submission_intake WHERE submission_id=?",
        )
        .get(original.id),
    ).toEqual({ review_decision: "forward" });
  });

  test("retries an interrupted owner notification without re-screening or duplicate mail", async () => {
    const t = fixture();
    t.failRouting(true);
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    expect(accepted.status).toBe(201);
    expect(submission.intake.state).toBe("legitimate");
    expect(t.notices(OWNER)).toHaveLength(0);
    t.failRouting(false);
    const retried = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      { expectedRevision: submission.intake.revision },
    );
    expect(retried.status).toBe(200);
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(t.screeningCalls()).toBe(1);
    const current = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    const again = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      { expectedRevision: required(current.body.submission).intake.revision },
    );
    expect(again.status).toBe(200);
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(t.screeningCalls()).toBe(1);
  });

  test("retries owner routing after a committed manual approval without running screening again", async () => {
    const t = fixture();
    t.decision("needs-information");
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    t.failRouting(true);
    const reviewed = await t.call(
      OWNER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: submission.intake.revision,
        decision: "forward",
        reason: "I verified the reproduction privately.",
      },
    );
    expect(reviewed.status).toBe(500);
    const saved = await t.call(
      REPORTER,
      "GET",
      `security-submissions/${submission.id}`,
    );
    const pending = required(saved.body.submission);
    expect(pending.intake.canForward).toBe(true);
    expect(pending.intake.routingState).toBe("pending");
    expect(t.notices(OWNER)).toHaveLength(0);
    t.failRouting(false);
    const retried = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      { expectedRevision: pending.intake.revision },
    );
    expect(retried.status).toBe(200);
    expect(required(retried.body.submission).intake.routingState).toBe(
      "routed",
    );
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(t.screeningCalls()).toBe(1);
    const held = await t.call(
      OWNER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: required(retried.body.submission).intake.revision,
        decision: "request-information",
        reason: "An additional reproduction is required.",
      },
    );
    expect(held.status).toBe(200);
    const refused = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      { expectedRevision: required(held.body.submission).intake.revision },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("screening_not_retryable");
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(t.screeningCalls()).toBe(1);
  });

  test("a stale model answer cannot override the owner's information request or block revision", async () => {
    const t = fixture();
    let reviewed = false;
    t.beforeScreen(async () => {
      const own = await t.call(REPORTER, "GET", "security-submissions");
      const submission = required(own.body.submissions)[0];
      const review = await t.call(
        OWNER,
        "POST",
        `security-submissions/${submission.id}/review`,
        {
          expectedRevision: submission.intake.revision,
          decision: "request-information",
          reason: "Please include the isolated regression test.",
        },
      );
      expect(review.status).toBe(200);
      reviewed = true;
    });
    const accepted = await t.create();
    expect(reviewed).toBe(true);
    const submission = required(accepted.body.submission);
    expect(submission.intake.canForward).toBe(false);
    expect(submission.intake.reason).toBe(
      "Please include the isolated regression test.",
    );
    expect(t.notices(OWNER)).toHaveLength(0);
    t.beforeScreen(null);
    const revised = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      {
        expectedRevision: submission.intake.revision,
        report: {
          ...REPORT,
          description: `${REPORT.description} Regression test included.`,
        },
      },
    );
    expect(revised.status).toBe(200);
    expect(required(revised.body.submission).intake.canForward).toBe(true);
    expect(required(revised.body.submission).intake.reportVersion).toBe(2);
  });

  test("allows an owner award only after finalized funds cover the preserved Slop terms", async () => {
    const t = fixture();
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    const decided = await t.caseAction(submission.caseId, {
      action: "decide",
      outcome: "confirmed",
      severity: "critical",
      loss: "verified-potential",
      inScope: true,
      reason: "Reproduced with local synthetic balances.",
      relatedParty: false,
      rootCauseKey: "withdrawal-share-rounding",
    });
    expect(decided.status).toBe(200);
    const award = () =>
      t.caseAction(submission.caseId, {
        action: "award",
        decision: "amount",
        grossMinor: "10000000000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
        reason: "Owner-approved critical report award.",
      });
    const unfunded = await award();
    expect(unfunded.status).toBe(200);
    expect(required(unfunded.body.case).awardState).toBe("pending");
    expect(required(unfunded.body.case).award).toMatchObject({
      grossMinor: "10000000000",
      researcherMinor: "7500000000",
      slopMinor: "2500000000",
    });
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toHaveLength(0);
    t.fund();
    const funded = await award();
    expect(funded.status).toBe(200);
    expect(funded.body.case).toMatchObject({
      advisory: null,
      receivedAt: START,
      receivedAtSource: "slop-received",
      awardState: "approved",
      award: {
        grossMinor: "10000000000",
        researcherMinor: "7500000000",
        slopMinor: "2500000000",
      },
    });
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toHaveLength(1);
  });

  test.each([
    { severity: "high", loss: "verified-potential", inScope: true },
    { severity: "critical", loss: "not-verified", inScope: true },
    { severity: "critical", loss: "verified-potential", inScope: false },
  ])(
    "keeps nonqualifying decisions out of the critical bounty ($severity, $loss, in scope: $inScope)",
    async (finding) => {
      const t = fixture();
      const accepted = await t.create();
      const submission = required(accepted.body.submission);
      const decided = await t.caseAction(submission.caseId, {
        action: "decide",
        outcome: "confirmed",
        ...finding,
        reason: "Technical assessment of the isolated reproduction.",
        relatedParty: false,
        rootCauseKey: "withdrawal-share-rounding",
      });
      expect(decided.status).toBe(200);
      t.fund();
      const award = await t.caseAction(submission.caseId, {
        action: "award",
        decision: "amount",
        grossMinor: "10000000000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
        reason: "Attempt to award a nonqualifying finding.",
      });
      expect(award.status).toBe(409);
      expect(award.body.error).toBe("award_not_eligible");
      expect(
        t.sqlite.query("SELECT * FROM security_award_reservations").all(),
      ).toHaveLength(0);
    },
  );
});

test("durable-intake migration preserves funded historical receipts and immutable guards", () => {
  const { sqlite } = sqliteD1(
    MIGRATIONS.filter((name) => name < "0101_durable_security_intake.sql"),
  );
  const manifest = JSON.stringify({ id: PROJECT, status: "active" });
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(PROJECT, manifest, "a".repeat(64), "Historical fixture", START);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(PROJECT, manifest, "a".repeat(64), START, START);
  sqlite.exec(`INSERT INTO security_cases(id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,policy_revision,terms,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at,received_at_source,award_gross_minor)
    VALUES('sc_historical0001','${PROJECT}','${REPOSITORY}','GHSA-2345-2345-2345','${REPORTER.githubId}','reporter','verified','${START}','${START}','github',1,'{}','confirmed','investigating','reserved','not-applicable','embargoed','private','none',1,'${START}','${START}','github-verified','1000000')`);
  sqlite.exec(
    `INSERT INTO security_award_reservations VALUES('sc_historical0001','${PROJECT}','old-root-cause',1,'1000000','USDC','${START}')`,
  );
  const tables = ["security_cases", "security_award_reservations"];
  const before = tables.map((table) =>
    sqlite.query(`SELECT * FROM ${table}`).all(),
  );
  sqlite.exec(
    `BEGIN;\n${readFileSync("migrations/0101_durable_security_intake.sql", "utf8")}\nCOMMIT;`,
  );
  expect(
    tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all()),
  ).toEqual(before);
  expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  expect(() =>
    sqlite.exec("UPDATE security_cases SET received_at='changed'"),
  ).toThrow("a verified receipt is immutable");
  expect(() =>
    sqlite.exec("UPDATE security_cases SET award_gross_minor='2000000'"),
  ).toThrow("a reserved award amount is immutable");
  expect(() => sqlite.exec("DELETE FROM security_cases")).toThrow(
    "security cases are permanent",
  );
});
