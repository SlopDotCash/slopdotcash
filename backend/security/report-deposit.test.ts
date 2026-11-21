// The refundable SLOP deposit on a private report, through the real API,
// migrations and case journal (PRD section 8, "Report deposit"). Screening
// and routine answers are deterministic fixtures: these tests prove the ask,
// the hold, the release and the outcome rule around them, never a model's
// answer. The Worker's part (marking a deposit paid) is one guarded UPDATE
// here, exactly the write the interface gives it.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SECURITY_DEFAULT_EXCLUSIONS } from "../../src/lib/security-bounty.mjs";
import {
  reportDepositAmount,
  reportDepositItem,
} from "../../src/lib/security-report-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_TOKENS,
} from "../../src/lib/submission-fee.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleSubmissionFeeApi } from "../submission-fee/handler";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import type {
  SecurityAnalyzer,
  SecurityRoutineInput,
  SecurityRoutineProposal,
} from "./analysis";
import type { SecurityApiDependencies } from "./case-store";
import { handleSecurityApi } from "./handler";
import {
  type ReportDepositFacts,
  type ReportDepositMode,
  reportDepositMode,
  reportDepositOutcome,
  runReportDepositSweep,
} from "./report-deposit";
import {
  approvedReportForForward,
  readStoredReportByCase,
  reportDepositWork,
} from "./report-intake";
import { ADMIN_ROUTINE_LIMITS, runRoutineDecisions } from "./routine-decisions";

const ORIGIN = "https://slop.test";
const START = "2026-11-21T12:00:00.000Z";
const PROJECT = "deposit-program";
const REPOSITORY = "example/deposit-program";
const OWNER = { githubId: "730000001", githubLogin: "owner" };
const ADMIN = { githubId: "730000009", githubLogin: "admin" };
const MODERATOR = { githubId: "730000008", githubLogin: "moderator" };
const ALICE = { githubId: "730000002", githubLogin: "alice" };
const BOB = { githubId: "730000003", githubLogin: "bob" };
const CAROL = { githubId: "730000004", githubLogin: "carol" };
const RATE = "78.908929";
const AMOUNT = reportDepositAmount(RATE) as string;
const PHISHING_LINE = SECURITY_DEFAULT_EXCLUSIONS[3];
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Actor = typeof OWNER;
type Deposit = { state: string; amount: string; payPath: string } | null;
type Body = Record<string, unknown> & {
  error?: string;
  case?: Record<string, unknown> & { deposit?: Deposit; nextStep?: string };
  cases?: (Record<string, unknown> & { id: string; deposit?: Deposit })[];
  submission?: Record<string, unknown> & {
    id: string;
    caseId: string;
    deposit?: Deposit;
    intake: Record<string, unknown> & { revision: number; state: string };
  };
  submissions?: (Record<string, unknown> & {
    id: string;
    caseId: string;
    deposit?: Deposit;
  })[];
};

const answer = (
  fields: Partial<SecurityRoutineProposal> = {},
): SecurityRoutineProposal => ({
  lossOfFundsPlausible: false,
  duplicateOfCaseId: null,
  doesNotQualifyLine: null,
  proof: "present",
  missing: [],
  severity: "medium",
  ...fields,
});

function fixture(options: { mode?: ReportDepositMode; rate?: boolean } = {}) {
  const { db, sqlite } = sqliteD1();
  const manifest = applicationManifest(PROJECT, REPOSITORY, {
    status: "active",
    securityBounty: {
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
      approvers: { technical: [OWNER], financial: [], dispute: [] },
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
        excludedFindings: [],
      },
    },
  });
  const store = (value: unknown) => {
    const text = JSON.stringify(value);
    return {
      text,
      digest: createHash("sha256").update(text).digest("hex"),
    };
  };
  const first = store(manifest);
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(PROJECT, 1, first.text, first.digest, "Fixture terms", START);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(PROJECT, first.text, first.digest, START, START);
  if (options.rate !== false)
    sqlite
      .query(
        "INSERT INTO submission_fee_rates(effective_at,slop_per_usd,source,created_at) VALUES(?,?,?,?)",
      )
      .run("2026-11-20T23:00:00.000Z", RATE, "fixture", START);
  const objects = new Map<
    string,
    { bytes: Uint8Array; customMetadata: Record<string, string> }
  >();
  const storage: R2Bucket = {
    async put(key, bytes, put) {
      if (!objects.has(key))
        objects.set(key, {
          bytes: bytes.slice(),
          customMetadata: put.customMetadata,
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
      if (!object) return null;
      const body = new Response(new Uint8Array(object.bytes).buffer).body;
      if (!body) throw new Error("Fixture body is missing");
      return {
        size: object.bytes.byteLength,
        customMetadata: object.customMetadata,
        body,
      };
    },
  };
  let actor: Actor | null = ALICE;
  let clock = Date.parse(START);
  let sequence = 0;
  const answers = new Map<
    string,
    (input: SecurityRoutineInput) => SecurityRoutineProposal[]
  >();
  const callsBySummary = new Map<string, number>();
  /** Summaries the screening fixture read, in order. */
  const screened: string[] = [];
  const analyzed: string[] = [];
  const spamSummaries = new Set<string>();
  const analyzer: SecurityAnalyzer = {
    provider: "deterministic-fixture",
    model: "fixture-deposit",
    async analyze(input) {
      analyzed.push(input.report.summary);
      return {
        summary: `Summary of ${input.report.summary}`,
        severity: "high",
        potentialLoss: "unclear",
        duplicateCaseIds: [],
        rootCauseKey: "fixture-root-cause",
        remediation: "Review the isolated reproduction privately.",
      };
    },
    async screen(input) {
      screened.push(input.report.summary);
      return spamSummaries.has(input.report.summary)
        ? { decision: "spam", reason: "Generated text without a finding." }
        : {
            decision: "legitimate",
            reason: "Concrete isolated reproduction merits human review.",
          };
    },
    async decideRoutine(input) {
      const index = callsBySummary.get(input.report.summary) ?? 0;
      callsBySummary.set(input.report.summary, index + 1);
      const pair = answers.get(input.report.summary)?.(input) ?? [
        answer(),
        answer(),
      ];
      return pair[index % 2];
    },
  };
  const deposit = {
    mode: options.mode ?? ("live" as ReportDepositMode),
    adminGithubIds: new Set([ADMIN.githubId]),
  };
  const deps: SecurityApiDependencies = {
    db,
    now: () => new Date(clock),
    randomId: () => `deposit${String(++sequence).padStart(12, "0")}`,
    sessionActor: async () => actor,
    reportStorage: storage,
    analyzer,
    reportingRead: async () => ({ kind: "unavailable" }),
    moderatorGithubIds: new Set([MODERATOR.githubId]),
    routineDecisions: {
      mode: "live",
      adminGithubIds: new Set([ADMIN.githubId]),
    },
    reportDeposit: deposit,
  };
  const call = async (
    as: Actor | null,
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
      deps,
    );
    if (!response) throw new Error("Unhandled fixture route");
    return { status: response.status, body: (await response.json()) as Body };
  };
  const report = async (
    as: Actor,
    summary: string,
    description = `${summary}. At commit abc a local test with synthetic funds shows it.`,
  ) => {
    const created = await call(as, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: `deposit-key-${String(++sequence).padStart(8, "0")}`,
      origin: "slop",
      report: { summary, description },
    });
    expect([created.status, created.body.error]).toEqual([201, undefined]);
    const submission = created.body.submission;
    if (!submission) throw new Error("Fixture submission is missing");
    clock += 1000;
    return {
      caseId: submission.caseId,
      submissionId: submission.id,
      submission,
    };
  };
  const row = (caseId: string) =>
    sqlite
      .query("SELECT * FROM security_report_deposits WHERE case_id=?")
      .get(caseId) as {
      case_id: string;
      project_id: string;
      item: string;
      mode: string;
      slop_amount: string;
      slop_per_usd: string;
      asked_at: string;
      paid_at: string | null;
      outcome: string | null;
      outcome_reason: string | null;
      outcome_at: string | null;
    } | null;
  const caseRow = (caseId: string) =>
    sqlite
      .query(
        "SELECT receipt_state, appeal_state, revision FROM security_cases WHERE id=?",
      )
      .get(caseId) as {
      receipt_state: string;
      appeal_state: string;
      revision: number;
    };
  const intake = (caseId: string) =>
    sqlite
      .query(
        "SELECT screening_state, report_version, revision FROM security_submission_intake WHERE case_id=?",
      )
      .get(caseId) as {
      screening_state: string;
      report_version: number;
      revision: number;
    };
  let depositId = 0;
  /** The Worker's write when it sees an accepted deposit. */
  const pay = (caseId: string) => {
    const result = sqlite
      .query(
        "UPDATE security_report_deposits SET paid_at=?, paid_network='robinhood-mainnet', paid_deposit_id=? WHERE case_id=? AND mode='asked' AND paid_at IS NULL AND outcome IS NULL",
      )
      .run(new Date(clock).toISOString(), ++depositId, caseId);
    return result.changes;
  };
  const sweep = () => runReportDepositSweep(deps, reportDepositWork(deps));
  const routine = {
    db: deps.db,
    now: deps.now,
    analyzer: deps.analyzer,
    readReport: (caseId: string, version: number) =>
      readStoredReportByCase(deps, caseId, version),
  };
  const pass = () => {
    clock += 4 * MINUTE;
    return runRoutineDecisions(routine, {
      mode: "live",
      source: "admin",
      limits: ADMIN_ROUTINE_LIMITS,
    });
  };
  const notices = (as: Actor) =>
    (
      sqlite
        .query(
          "SELECT event_key FROM notifications WHERE recipient_github_id=? AND kind='security_case'",
        )
        .all(as.githubId) as { event_key: string }[]
    ).map((entry) => entry.event_key);
  const act = (as: Actor, caseId: string, fields: Record<string, unknown>) =>
    call(as, "POST", `security-cases/${caseId}/actions`, {
      expectedRevision: caseRow(caseId).revision,
      idempotencyKey: `deposit-act-${String(++sequence).padStart(8, "0")}`,
      ...fields,
    });
  let projectRevision = 1;
  /** An owner revision that changes only the deposit setting. */
  const setProject = (security: unknown) => {
    const next = store({ ...manifest, security });
    projectRevision++;
    const at = new Date(clock).toISOString();
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(PROJECT, projectRevision, next.text, next.digest, "Setting", at);
    sqlite
      .query(
        "UPDATE projects SET manifest=?, manifest_sha256=?, revision=?, updated_at=? WHERE id=?",
      )
      .run(next.text, next.digest, projectRevision, at, PROJECT);
  };
  const publicRead = async (caseId: string) => {
    const response = await handleSubmissionFeeApi(
      new Request(`${ORIGIN}/api/v1/submission-fee/reports/${caseId}`),
      { db, now: deps.now },
    );
    if (!response) throw new Error("Unhandled fee route");
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  return {
    sqlite,
    deps,
    call,
    report,
    row,
    caseRow,
    intake,
    pay,
    sweep,
    pass,
    notices,
    act,
    setProject,
    publicRead,
    answers,
    screened,
    analyzed,
    spamSummaries,
    setMode: (mode: ReportDepositMode) => {
      deposit.mode = mode;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    now: () => new Date(clock),
  };
}

const facts = (
  fields: Partial<ReportDepositFacts> = {},
): ReportDepositFacts => ({
  mode: "live",
  projectOn: true,
  paidAt: START,
  receiptState: "received",
  appealState: "none",
  routineRequest: false,
  routedByMaintainer: false,
  requestAnswered: false,
  closedAt: null,
  spamByPerson: false,
  ...fields,
});
const at = (days: number, extraMs = 0) =>
  new Date(Date.parse(START) + days * DAY + extraMs);

describe("the outcome rule of a paid report deposit", () => {
  test("the mode is off unless it is exactly dry_run or live", () => {
    expect(reportDepositMode("dry_run")).toBe("dry_run");
    expect(reportDepositMode("live")).toBe("live");
    for (const value of [undefined, "", "on", "LIVE", "dry-run", " live"])
      expect(reportDepositMode(value)).toBe("off");
  });

  test("an unanswered report waits 14 days, then the deposit is sent back as silent", () => {
    expect(reportDepositOutcome(facts(), at(0))).toBeNull();
    expect(reportDepositOutcome(facts(), at(14, -1))).toBeNull();
    expect(reportDepositOutcome(facts(), at(14))).toEqual({
      outcome: "refund_due",
      reason: "silent",
    });
  });

  test("a first response that is not a keeping close sends it back at once", () => {
    const responded = {
      outcome: "refund_due" as const,
      reason: "responded" as const,
    };
    for (const receiptState of ["triaging", "confirmed"])
      expect(reportDepositOutcome(facts({ receiptState }), at(0))).toEqual(
        responded,
      );
    // A maintainer's routing approval of the saved report is a response.
    expect(
      reportDepositOutcome(facts({ routedByMaintainer: true }), at(0)),
    ).toEqual(responded);
    // A person's request for information counts once the reporter answered.
    expect(
      reportDepositOutcome(
        facts({ receiptState: "needs-information" }),
        at(30),
      ),
    ).toBeNull();
    expect(
      reportDepositOutcome(
        facts({ receiptState: "needs-information", requestAnswered: true }),
        at(0),
      ),
    ).toEqual(responded);
    // The routine request for proof waits for the pass's own result, even
    // after a new version arrived.
    expect(
      reportDepositOutcome(
        facts({
          receiptState: "needs-information",
          routineRequest: true,
          requestAnswered: true,
        }),
        at(30),
      ),
    ).toBeNull();
  });

  test("a rejection is sent back unless a person marked it spam", () => {
    // "No proof received" and any other rejection: a routine one or a
    // person's without the spam mark.
    expect(
      reportDepositOutcome(
        facts({ receiptState: "rejected", closedAt: START }),
        at(0),
      ),
    ).toEqual({ outcome: "refund_due", reason: "responded" });
    const spam = facts({
      receiptState: "rejected",
      closedAt: START,
      spamByPerson: true,
    });
    expect(reportDepositOutcome(spam, at(7, -1))).toBeNull();
    expect(reportDepositOutcome(spam, at(7))).toEqual({
      outcome: "kept_due",
      reason: "spam",
    });
  });

  test("a duplicate or out-of-scope close keeps the deposit only after it stood 7 days with no open appeal", () => {
    for (const receiptState of ["duplicate", "out-of-scope"] as const) {
      const closed = facts({ receiptState, closedAt: START });
      expect(reportDepositOutcome(closed, at(0))).toBeNull();
      expect(reportDepositOutcome(closed, at(7, -1))).toBeNull();
      expect(reportDepositOutcome(closed, at(7))).toEqual({
        outcome: "kept_due",
        reason: receiptState,
      });
      // No recorded decision, no keep.
      expect(reportDepositOutcome(facts({ receiptState }), at(30))).toBeNull();
      // An upheld appeal restarts the clock at the reviewer's decision.
      const upheld = facts({
        receiptState,
        appealState: "upheld",
        closedAt: at(5).toISOString(),
      });
      expect(reportDepositOutcome(upheld, at(8))).toBeNull();
      expect(reportDepositOutcome(upheld, at(12))).toEqual({
        outcome: "kept_due",
        reason: receiptState,
      });
      // A stale appeal flag never keeps.
      expect(
        reportDepositOutcome({ ...closed, appealState: "open" }, at(30)),
      ).toBeNull();
    }
  });

  test("an open appeal and a report returned to the owner wait for the final decision", () => {
    expect(
      reportDepositOutcome(
        facts({
          receiptState: "disputed",
          appealState: "open",
          closedAt: START,
        }),
        at(60),
      ),
    ).toBeNull();
    expect(
      reportDepositOutcome(
        facts({ receiptState: "triaging", appealState: "returned" }),
        at(60),
      ),
    ).toBeNull();
    // The owner's final decision then follows the ordinary rule.
    expect(
      reportDepositOutcome(
        facts({ receiptState: "confirmed", appealState: "returned" }),
        at(60),
      ),
    ).toEqual({ outcome: "refund_due", reason: "responded" });
    expect(
      reportDepositOutcome(
        facts({
          receiptState: "duplicate",
          appealState: "returned",
          closedAt: at(60).toISOString(),
        }),
        at(67),
      ),
    ).toEqual({ outcome: "kept_due", reason: "duplicate" });
  });

  test("with the server switch not live or the project's setting off, every state is sent back and none is kept", () => {
    const states = [
      "received",
      "needs-information",
      "triaging",
      "confirmed",
      "duplicate",
      "out-of-scope",
      "rejected",
      "disputed",
    ];
    for (const receiptState of states)
      for (const off of [
        { mode: "off" as const },
        { mode: "dry_run" as const },
        { projectOn: false },
      ])
        expect(
          reportDepositOutcome(
            facts({
              receiptState,
              closedAt: START,
              spamByPerson: true,
              ...off,
            }),
            at(30),
          ),
        ).toEqual({ outcome: "refund_due", reason: "turned-off" });
  });

  test("no combination of facts keeps a deposit without a recorded close that stood 7 days", () => {
    // Exhaustive over the rule's inputs at a time long after payment.
    const states = [
      "received",
      "needs-information",
      "triaging",
      "confirmed",
      "duplicate",
      "out-of-scope",
      "rejected",
      "disputed",
      "unknown",
    ];
    const flags = [false, true];
    let kept = 0;
    for (const receiptState of states)
      for (const appealState of ["none", "open", "upheld", "returned"])
        for (const routineRequest of flags)
          for (const routedByMaintainer of flags)
            for (const requestAnswered of flags)
              for (const spamByPerson of flags)
                for (const closedAt of [null, START, at(25).toISOString()]) {
                  const result = reportDepositOutcome(
                    facts({
                      receiptState,
                      appealState,
                      routineRequest,
                      routedByMaintainer,
                      requestAnswered,
                      spamByPerson,
                      closedAt,
                    }),
                    at(30),
                  );
                  if (result?.outcome !== "kept_due") continue;
                  kept++;
                  expect(closedAt).toBe(START);
                  expect(appealState).not.toBe("open");
                  expect(
                    receiptState === "duplicate" ||
                      receiptState === "out-of-scope" ||
                      (receiptState === "rejected" && spamByPerson),
                  ).toBe(true);
                  expect(result.reason as string).toBe(
                    receiptState === "rejected" ? "spam" : receiptState,
                  );
                }
    expect(kept).toBeGreaterThan(0);
  });
});

describe("the report deposit through the security API", () => {
  test("live: a new report is asked a fixed SLOP amount and nothing else happens to it", async () => {
    const t = fixture();
    const filed = await t.report(ALICE, "Share rounding drains the vault");
    // The row: asked, the amount at the rate in force, the contract's item.
    expect(t.row(filed.caseId)).toMatchObject({
      project_id: PROJECT,
      item: reportDepositItem(filed.caseId),
      mode: "asked",
      slop_amount: AMOUNT,
      slop_per_usd: RATE,
      paid_at: null,
      outcome: null,
    });
    expect(AMOUNT).toBe("395000000000000000000");
    // Accepted and stored at once, with its time, and never screened.
    expect(t.caseRow(filed.caseId).receipt_state).toBe("received");
    expect(t.intake(filed.caseId).screening_state).toBe("queued");
    expect(t.screened).toEqual([]);
    expect(t.analyzed).toEqual([]);
    // The reporter sees it with the deposit needed and the pay path.
    const needed = {
      state: "needed",
      amount: AMOUNT,
      payPath: `/fee/report/${filed.caseId}`,
    };
    expect(filed.submission.deposit).toEqual(needed);
    const inbox = await t.call(ALICE, "GET", "security-submissions");
    expect(inbox.body.submissions?.map((entry) => entry.deposit)).toEqual([
      needed,
    ]);
    const own = await t.call(ALICE, "GET", `security-cases/${filed.caseId}`);
    expect(own.status).toBe(200);
    expect(own.body.case?.deposit).toEqual(needed);
    expect(own.body.case?.nextStep).toBe(
      "Deposit needed: 395 SLOP. Your report is saved and waits for its deposit.",
    );
    const ownList = await t.call(ALICE, "GET", "security-cases");
    expect(ownList.body.cases?.map((entry) => entry.deposit)).toEqual([needed]);
    // The owner is not notified, does not see it in either list, and cannot
    // read or decide it.
    expect(t.notices(OWNER)).toEqual([]);
    expect(
      (await t.call(OWNER, "GET", "security-submissions")).body.submissions,
    ).toEqual([]);
    expect((await t.call(OWNER, "GET", "security-cases")).body.cases).toEqual(
      [],
    );
    expect(
      (await t.call(OWNER, "GET", `security-cases/${filed.caseId}`)).status,
    ).toBe(404);
    expect(
      (await t.call(OWNER, "GET", `security-submissions/${filed.submissionId}`))
        .status,
    ).toBe(404);
    const decided = await t.act(OWNER, filed.caseId, {
      action: "decide",
      outcome: "rejected",
      severity: "informational",
      loss: "not-verified",
      inScope: false,
      relatedParty: false,
      reason: "A decision on a held report must be refused.",
    });
    expect(decided.status).toBe(404);
    // The routine pass never reads it, and the admin count leaves it out.
    expect(await t.pass()).toMatchObject({ examined: 0, recorded: 0 });
    expect((await t.call(ADMIN, "GET", "security-routine")).body.received).toBe(
      0,
    );
    // The reporter's own retry cannot start screening either.
    const retry = await t.call(
      ALICE,
      "POST",
      `security-submissions/${filed.submissionId}/screen`,
      { expectedRevision: t.intake(filed.caseId).revision },
    );
    expect(retry.status).toBe(409);
    expect(retry.body.error).toBe("deposit_required");
    // GitHub forwarding refuses with the plain reason.
    await expect(
      approvedReportForForward(t.deps, filed.submissionId),
    ).rejects.toMatchObject({ code: "deposit_required", status: 409 });
    // A sweep changes nothing while the deposit is unpaid, however long.
    t.advance(40 * DAY);
    expect(await t.sweep()).toEqual({ released: 0, decided: 0, started: 0 });
    // Long after the screening wait has passed, the routine pass still does
    // not read it.
    expect(await t.pass()).toMatchObject({ examined: 0, recorded: 0 });
    expect(t.screened).toEqual([]);
    expect(t.caseRow(filed.caseId).receipt_state).toBe("received");
    expect(t.row(filed.caseId)).toMatchObject({ mode: "asked", outcome: null });
  });

  test("once the deposit is recorded, the next sweep starts the held screening and the owner hears", async () => {
    const t = fixture();
    const filed = await t.report(ALICE, "Share rounding drains the vault");
    expect(t.pay(filed.caseId)).toBe(1);
    // Paid, not yet swept: the hold is already gone for readers.
    const paid = await t.call(ALICE, "GET", `security-cases/${filed.caseId}`);
    expect(paid.body.case?.deposit).toMatchObject({ state: "paid" });
    expect(await t.sweep()).toMatchObject({ started: 1, decided: 0 });
    expect(t.screened).toEqual(["Share rounding drains the vault"]);
    expect(t.intake(filed.caseId).screening_state).toBe("legitimate");
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(
      (await t.call(OWNER, "GET", "security-cases")).body.cases?.map(
        (entry) => entry.id,
      ),
    ).toEqual([filed.caseId]);
    // The owner's view never carries the reporter's deposit.
    expect(
      (await t.call(OWNER, "GET", `security-cases/${filed.caseId}`)).body.case
        ?.deposit,
    ).toBeUndefined();
    // A repeat sweep starts nothing twice.
    expect(await t.sweep()).toMatchObject({ started: 0 });
    expect(t.screened).toHaveLength(1);
    // The routine pass now reads it; an acknowledgement is a first response.
    expect(await t.pass()).toMatchObject({ examined: 1, recorded: 1 });
    expect(t.caseRow(filed.caseId).receipt_state).toBe("triaging");
    expect(await t.sweep()).toMatchObject({ decided: 1 });
    expect(t.row(filed.caseId)).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "responded",
      outcome_at: t.now().toISOString(),
    });
    expect(
      (await t.call(ALICE, "GET", `security-cases/${filed.caseId}`)).body.case
        ?.deposit,
    ).toMatchObject({ state: "refund_due" });
  });

  test("dry_run records a row, asks nobody and holds nothing", async () => {
    const t = fixture({ mode: "dry_run" });
    const filed = await t.report(ALICE, "Share rounding drains the vault");
    expect(t.row(filed.caseId)).toMatchObject({
      mode: "recorded",
      slop_amount: AMOUNT,
      paid_at: null,
    });
    // Exactly as today: screened at once, the owner hears, no deposit shown.
    expect(t.screened).toEqual(["Share rounding drains the vault"]);
    expect(t.intake(filed.caseId).screening_state).toBe("legitimate");
    expect(t.notices(OWNER)).toHaveLength(1);
    expect(filed.submission.deposit).toBeNull();
    expect(
      (await t.call(ALICE, "GET", `security-cases/${filed.caseId}`)).body.case
        ?.deposit,
    ).toBeNull();
    expect((await t.publicRead(filed.caseId)).status).toBe(404);
    // A recorded row can never be marked paid or get an outcome.
    expect(t.pay(filed.caseId)).toBe(0);
    // The sweep never touches a record-only report, even one whose
    // screening has not started: it proceeds exactly as without a deposit.
    t.sqlite
      .query(
        "UPDATE security_submission_intake SET screening_state='queued', routed_at=NULL, revision=revision+1 WHERE case_id=?",
      )
      .run(filed.caseId);
    t.advance(30 * DAY);
    expect(await t.sweep()).toEqual({ released: 0, decided: 0, started: 0 });
    expect(t.screened).toHaveLength(1);
    t.sqlite
      .query(
        "UPDATE security_submission_intake SET screening_state='legitimate', revision=revision+1 WHERE case_id=?",
      )
      .run(filed.caseId);
    expect(t.row(filed.caseId)?.outcome_reason).toBeNull();
    expect(t.row(filed.caseId)).toMatchObject({
      mode: "recorded",
      outcome: null,
    });
    // Going live later never turns a recorded row into an ask.
    t.setMode("live");
    await t.sweep();
    expect(t.row(filed.caseId)?.mode).toBe("recorded");
    expect(await t.pass()).toMatchObject({ examined: 1 });
  });

  test("off writes nothing; without a SLOP rate nobody is asked", async () => {
    const off = fixture({ mode: "off" });
    const first = await off.report(ALICE, "Share rounding drains the vault");
    expect(off.row(first.caseId)).toBeNull();
    expect(off.screened).toHaveLength(1);
    const unrated = fixture({ rate: false });
    const second = await unrated.report(ALICE, "Share rounding drains it");
    expect(unrated.row(second.caseId)).toBeNull();
    expect(unrated.screened).toHaveLength(1);
    expect(second.submission.deposit).toBeNull();
  });

  test("a failed read while asking never blocks the report: it is accepted and nobody is asked", async () => {
    const t = fixture();
    // A stored rate the rule cannot read.
    t.sqlite
      .query(
        "INSERT INTO submission_fee_rates(effective_at,slop_per_usd,source,created_at) VALUES(?,?,?,?)",
      )
      .run("2026-11-21T00:00:00.000Z", "not-a-rate", "fixture", START);
    const filed = await t.report(ALICE, "Share rounding drains the vault");
    expect(t.row(filed.caseId)).toBeNull();
    expect(t.caseRow(filed.caseId).receipt_state).toBe("received");
    expect(t.screened).toHaveLength(1);
  });

  test("the owner, a named approver, a moderator and an admin are never asked", async () => {
    const t = fixture();
    for (const [index, exempt] of [OWNER, MODERATOR, ADMIN].entries()) {
      const filed = await t.report(exempt, `Exempt report ${index}`);
      expect(t.row(filed.caseId)).toBeNull();
      expect(filed.submission.deposit).toBeNull();
    }
    expect(t.screened).toHaveLength(3);
    // Anyone else is asked.
    const asked = await t.report(BOB, "An outside report");
    expect(t.row(asked.caseId)?.mode).toBe("asked");
  });

  test("a project that turned the deposit off asks nobody; turning it off later releases and sends back", async () => {
    const t = fixture();
    const unpaid = await t.report(ALICE, "First outside report");
    const paid = await t.report(BOB, "Second outside report");
    expect(t.pay(paid.caseId)).toBe(1);
    t.setProject({ reportDeposit: false });
    // New reports are no longer asked.
    const later = await t.report(CAROL, "Third outside report");
    expect(t.row(later.caseId)).toBeNull();
    // The unpaid ask is released and screened; the paid one is sent back.
    expect(await t.sweep()).toEqual({ released: 1, decided: 1, started: 2 });
    expect(t.row(unpaid.caseId)).toMatchObject({
      mode: "recorded",
      outcome: null,
    });
    expect(t.intake(unpaid.caseId).screening_state).toBe("legitimate");
    expect(t.row(paid.caseId)).toMatchObject({
      mode: "asked",
      outcome: "refund_due",
      outcome_reason: "turned-off",
    });
    expect(t.intake(paid.caseId).screening_state).toBe("legitimate");
    // Turning it on again never asks a report that already has a row.
    t.setProject({ reportDeposit: true });
    await t.sweep();
    expect(t.row(unpaid.caseId)?.mode).toBe("recorded");
    expect(t.row(later.caseId)).toBeNull();
    const next = await t.report(CAROL, "Fourth outside report");
    expect(t.row(next.caseId)?.mode).toBe("asked");
  });

  test("setting the mode to dry_run or off releases every held report", async () => {
    for (const mode of ["dry_run", "off"] as const) {
      const t = fixture();
      const held = [
        await t.report(ALICE, "First held report"),
        await t.report(BOB, "Second held report"),
        await t.report(CAROL, "Third held report"),
      ];
      const paid = await t.report(ALICE, "A paid report");
      expect(t.pay(paid.caseId)).toBe(1);
      expect(t.screened).toEqual([]);
      t.setMode(mode);
      // Every held report is released at once; a sweep starts three pieces
      // of held work and the next sweep takes the next.
      expect(await t.sweep()).toEqual({ released: 3, decided: 1, started: 3 });
      expect(await t.sweep()).toEqual({ released: 0, decided: 0, started: 1 });
      for (const entry of held) {
        // A released ask keeps why and when, with no outcome.
        expect(t.row(entry.caseId)).toMatchObject({
          mode: "recorded",
          outcome: null,
          outcome_reason: "turned-off",
          paid_at: null,
        });
        expect(t.intake(entry.caseId).screening_state).toBe("legitimate");
      }
      // A paid deposit is never kept once the switch is not live.
      expect(t.row(paid.caseId)).toMatchObject({
        outcome: "refund_due",
        outcome_reason: "turned-off",
      });
      expect(t.screened).toHaveLength(4);
      // The owner sees all four now.
      expect(
        (await t.call(OWNER, "GET", "security-cases")).body.cases,
      ).toHaveLength(4);
      expect(await t.sweep()).toEqual({ released: 0, decided: 0, started: 0 });
    }
  });

  test("reports that exist before the switch-on are never asked, whatever happens to them later", async () => {
    const t = fixture({ mode: "off" });
    const existing = await t.report(ALICE, "A report from before");
    t.spamSummaries.add("A second report from before");
    const revisable = await t.report(BOB, "A second report from before");
    expect(t.intake(revisable.caseId).screening_state).toBe("spam");
    t.setMode("live");
    await t.sweep();
    // A new version of an old report is not asked.
    const revised = await t.call(
      BOB,
      "POST",
      `security-submissions/${revisable.submissionId}/report`,
      {
        expectedRevision: t.intake(revisable.caseId).revision,
        report: {
          summary: "A second report from before, with detail",
          description: "Now with reproduction steps at commit abc.",
        },
      },
    );
    expect(revised.status).toBe(200);
    await t.pass();
    await t.sweep();
    expect(t.row(existing.caseId)).toBeNull();
    expect(t.row(revisable.caseId)).toBeNull();
    expect(
      t.sqlite
        .query("SELECT COUNT(*) AS rows FROM security_report_deposits")
        .get(),
    ).toEqual({ rows: 0 });
    // Both were screened as today.
    expect(t.screened).toEqual([
      "A report from before",
      "A second report from before",
      "A second report from before, with detail",
    ]);
  });

  test("a held report can take a new version; it stays held, is not asked again and is not screened", async () => {
    const t = fixture();
    const filed = await t.report(ALICE, "A thin first version");
    expect(filed.submission.intake.canRevise).toBe(true);
    const revised = await t.call(
      ALICE,
      "POST",
      `security-submissions/${filed.submissionId}/report`,
      {
        expectedRevision: t.intake(filed.caseId).revision,
        report: {
          summary: "A fuller second version",
          description: "Reproduction steps at commit abc with synthetic funds.",
        },
      },
    );
    expect(revised.status).toBe(200);
    expect(t.intake(filed.caseId)).toMatchObject({
      report_version: 2,
      screening_state: "queued",
    });
    expect(t.screened).toEqual([]);
    expect(t.row(filed.caseId)).toMatchObject({
      mode: "asked",
      slop_amount: AMOUNT,
    });
    expect(
      t.sqlite
        .query("SELECT COUNT(*) AS rows FROM security_report_deposits")
        .get(),
    ).toEqual({ rows: 1 });
    // After payment the current version is the one screened.
    t.pay(filed.caseId);
    await t.sweep();
    expect(t.screened).toEqual(["A fuller second version"]);
  });

  test("a held report never makes a later paid report a duplicate", async () => {
    const t = fixture();
    const unpaid = await t.report(ALICE, "The same bytes twice");
    const paid = await t.report(BOB, "The same bytes twice");
    t.pay(paid.caseId);
    await t.sweep();
    // Screening did not hold it as matching evidence, and the routine pass
    // does not close it against the unpaid copy.
    expect(t.intake(paid.caseId).screening_state).toBe("legitimate");
    await t.pass();
    expect(t.caseRow(paid.caseId).receipt_state).toBe("triaging");
    expect(t.caseRow(unpaid.caseId).receipt_state).toBe("received");
  });

  test("a duplicate close keeps the deposit only after 7 days; an appeal in that time stops the clock and the final decision decides", async () => {
    const t = fixture();
    const original = await t.report(ALICE, "Share rounding drains the vault");
    const copy = await t.report(BOB, "Share rounding drains the vault");
    const second = await t.report(CAROL, "Share rounding drains the vault");
    for (const entry of [original, copy, second]) t.pay(entry.caseId);
    await t.sweep();
    await t.pass();
    expect(t.caseRow(copy.caseId).receipt_state).toBe("duplicate");
    expect(t.caseRow(second.caseId).receipt_state).toBe("duplicate");
    await t.sweep();
    // The acknowledged original is sent back; the closes wait.
    expect(t.row(original.caseId)?.outcome).toBe("refund_due");
    expect(t.row(copy.caseId)?.outcome).toBeNull();
    t.advance(6 * DAY);
    await t.sweep();
    expect(t.row(copy.caseId)?.outcome).toBeNull();
    // One reporter appeals on day six: the report returns to the owner.
    const appealed = await t.act(CAROL, second.caseId, {
      action: "appeal",
      reason: "This is a different root cause from the earlier report.",
    });
    expect(appealed.status).toBe(200);
    expect(t.caseRow(second.caseId)).toMatchObject({
      receipt_state: "triaging",
      appeal_state: "returned",
    });
    t.advance(2 * DAY);
    await t.sweep();
    // The unappealed close stood 7 days: kept. The appealed one waits.
    expect(t.row(copy.caseId)).toMatchObject({
      outcome: "kept_due",
      outcome_reason: "duplicate",
    });
    expect(t.row(second.caseId)?.outcome).toBeNull();
    t.advance(30 * DAY);
    await t.sweep();
    expect(t.row(second.caseId)?.outcome).toBeNull();
    // The owner's final decision accepts it: sent back.
    const confirmed = await t.act(OWNER, second.caseId, {
      action: "decide",
      outcome: "confirmed",
      severity: "high",
      loss: "verified-potential",
      inScope: true,
      relatedParty: false,
      rootCauseKey: "second-root-cause",
      reason: "A separate root cause, confirmed on review.",
    });
    expect(confirmed.status).toBe(200);
    await t.sweep();
    expect(t.row(second.caseId)).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "responded",
    });
  });

  test("an out-of-scope close keeps the deposit after 7 days; a report closed for missing proof is sent back", async () => {
    const t = fixture();
    const phishing = await t.report(ALICE, "The website can be cloned");
    const thin = await t.report(BOB, "Something is wrong somewhere");
    t.answers.set("The website can be cloned", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: PHISHING_LINE }),
    ]);
    t.answers.set("Something is wrong somewhere", () => [
      answer({ proof: "missing", missing: ["reproduction-steps"] }),
      answer({ proof: "missing", missing: ["reproduction-steps"] }),
    ]);
    t.pay(phishing.caseId);
    t.pay(thin.caseId);
    await t.sweep();
    await t.pass();
    await t.pass();
    expect(t.caseRow(phishing.caseId).receipt_state).toBe("out-of-scope");
    expect(t.caseRow(thin.caseId).receipt_state).toBe("needs-information");
    await t.sweep();
    expect(t.row(phishing.caseId)?.outcome).toBeNull();
    // The request for proof alone decides nothing.
    expect(t.row(thin.caseId)?.outcome).toBeNull();
    t.advance(7 * DAY);
    await t.sweep();
    expect(t.row(phishing.caseId)).toMatchObject({
      outcome: "kept_due",
      outcome_reason: "out-of-scope",
    });
    expect(t.row(thin.caseId)?.outcome).toBeNull();
    // The 14-day proof clock runs out: closed as no proof received.
    t.advance(8 * DAY);
    await t.pass();
    expect(t.caseRow(thin.caseId).receipt_state).toBe("rejected");
    await t.sweep();
    expect(t.row(thin.caseId)).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "responded",
    });
  });

  test("a model's spam verdict alone never keeps a deposit; a person's rejection marked spam does", async () => {
    const t = fixture();
    t.spamSummaries.add("Generated filler report");
    t.spamSummaries.add("Another generated filler report");
    const screenedSpam = await t.report(ALICE, "Generated filler report");
    const closedSpam = await t.report(BOB, "Another generated filler report");
    const plain = await t.report(CAROL, "A wrong but honest report");
    for (const entry of [screenedSpam, closedSpam, plain]) t.pay(entry.caseId);
    await t.sweep();
    expect(t.intake(screenedSpam.caseId).screening_state).toBe("spam");
    expect(t.intake(closedSpam.caseId).screening_state).toBe("spam");
    // A person rejects one as spam and one without the mark.
    const decide = (as: Actor, caseId: string, spam?: boolean) =>
      t.act(as, caseId, {
        action: "decide",
        outcome: "rejected",
        severity: "informational",
        loss: "not-verified",
        inScope: false,
        relatedParty: false,
        reason: "Rejected after reading the saved report.",
        ...(spam === undefined ? {} : { spam }),
      });
    expect((await decide(OWNER, closedSpam.caseId, true)).status).toBe(200);
    expect((await decide(OWNER, plain.caseId)).status).toBe(200);
    // The spam mark belongs to a rejection only.
    const confirmedSpam = await t.act(OWNER, screenedSpam.caseId, {
      action: "decide",
      outcome: "confirmed",
      severity: "low",
      loss: "not-verified",
      inScope: true,
      relatedParty: false,
      rootCauseKey: "not-spam",
      reason: "A confirmed finding cannot be spam.",
      spam: true,
    });
    expect(confirmedSpam.status).toBe(400);
    await t.sweep();
    // The plain rejection is a response: sent back at once.
    expect(t.row(plain.caseId)).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "responded",
    });
    expect(t.row(closedSpam.caseId)?.outcome).toBeNull();
    t.advance(7 * DAY);
    await t.sweep();
    expect(t.row(closedSpam.caseId)).toMatchObject({
      outcome: "kept_due",
      outcome_reason: "spam",
    });
    // The report only a model called spam is never kept: after 14 silent
    // days its deposit is sent back.
    expect(t.row(screenedSpam.caseId)?.outcome).toBeNull();
    t.advance(7 * DAY);
    await t.sweep();
    expect(t.row(screenedSpam.caseId)).toMatchObject({
      outcome: "refund_due",
      outcome_reason: "silent",
    });
    expect(t.caseRow(screenedSpam.caseId).receipt_state).toBe("received");
  });

  test("a kept outcome is not written when an appeal lands between the read and the write", async () => {
    const t = fixture();
    const original = await t.report(ALICE, "Share rounding drains the vault");
    const copy = await t.report(BOB, "Share rounding drains the vault");
    t.pay(original.caseId);
    t.pay(copy.caseId);
    await t.sweep();
    await t.pass();
    t.advance(8 * DAY);
    // The sweep read the closed case; the appeal commits before its write.
    const db = t.deps.db;
    let appealed = false;
    t.deps.db = {
      ...db,
      batch: (statements) => db.batch(statements),
      prepare: (sql) => {
        const statement = db.prepare(sql);
        if (!sql.includes("SET outcome = ?1") || appealed) return statement;
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              ...bound,
              run: async () => {
                if (!appealed && values[3] === copy.caseId) {
                  appealed = true;
                  t.deps.db = db;
                  const result = await t.act(BOB, copy.caseId, {
                    action: "appeal",
                    reason: "This is a different root cause from the first.",
                  });
                  expect(result.status).toBe(200);
                }
                return bound.run();
              },
            } as typeof bound;
          },
        } as typeof statement;
      },
    };
    await t.sweep();
    t.deps.db = db;
    expect(appealed).toBe(true);
    expect(t.row(copy.caseId)?.outcome).toBeNull();
    expect(t.caseRow(copy.caseId).appeal_state).toBe("returned");
  });

  test("the public read names no project, reporter or text, lists the one way to pay, and is empty once paid", async () => {
    const t = fixture();
    const filed = await t.report(ALICE, "PRIVATE-TITLE-SENTINEL drains it");
    expect((await t.publicRead("sc_doesnotexist00")).status).toBe(404);
    expect((await t.publicRead("not-a-case")).status).toBe(404);
    const asked = await t.publicRead(filed.caseId);
    expect(asked.status).toBe(200);
    expect(asked.cache).toBe("no-store");
    expect(asked.body).toEqual({
      schema: "slop-report-deposit-v1",
      caseId: filed.caseId,
      item: reportDepositItem(filed.caseId),
      askedAt: t.row(filed.caseId)?.asked_at,
      due: [
        {
          network: "robinhood-mainnet",
          chainId: 4663,
          token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop,
          symbol: "SLOP",
          decimals: 18,
          amount: AMOUNT,
          contract: SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"],
          keptTo: SUBMISSION_FEE_BURN,
        },
      ],
      paid: null,
      outcome: null,
      outcomeReason: null,
      outcomeAt: null,
      resolveTransaction: null,
    });
    const text = JSON.stringify(asked.body);
    for (const secret of [
      PROJECT,
      ALICE.githubLogin,
      ALICE.githubId,
      "PRIVATE-TITLE-SENTINEL",
      filed.submissionId,
    ])
      expect(text).not.toContain(secret);
    // Paid: the Worker's deposit record supplies the payment facts.
    t.pay(filed.caseId);
    t.sqlite
      .query(
        "INSERT INTO submission_fee_deposits (network, deposit_id, item, payer, token, amount, kept_to, tx_hash, block_number, block_time, state) VALUES ('robinhood-mainnet', 1, ?, ?, ?, ?, ?, ?, 1, ?, 'open')",
      )
      .run(
        reportDepositItem(filed.caseId),
        `0x${"a".repeat(40)}`,
        SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop as string,
        AMOUNT,
        SUBMISSION_FEE_BURN,
        `0x${"b".repeat(64)}`,
        START,
      );
    const paid = await t.publicRead(filed.caseId);
    expect(paid.body).toMatchObject({
      due: [],
      paid: {
        at: t.row(filed.caseId)?.paid_at,
        network: "robinhood-mainnet",
        depositId: 1,
        token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop,
        amount: AMOUNT,
        transaction: `0x${"b".repeat(64)}`,
        finalized: false,
      },
      outcome: null,
    });
    // A released ask is no longer an ask.
    const released = await t.report(BOB, "A second outside report");
    t.setMode("off");
    await t.sweep();
    expect((await t.publicRead(released.caseId)).status).toBe(404);
    expect((await t.publicRead(filed.caseId)).body).toMatchObject({
      outcome: "refund_due",
      outcomeReason: "turned-off",
    });
  });
});
