// Routine decisions through the real API, migrations and case journal. The
// routine answers, screening answers and storage are deterministic fixtures:
// these tests prove the controls around the model calls (agreement, guards,
// clocks, dry run, appeal), not the quality of any model's answers. The
// release qualifies the real provider in scripts/qualify-security-routine.ts.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  routineClosingExclusions,
  SECURITY_DEFAULT_EXCLUSIONS,
} from "../../src/lib/security-bounty.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import {
  parseRoutineProposal,
  type SecurityAnalyzer,
  type SecurityRoutineInput,
  type SecurityRoutineProposal,
} from "./analysis";
import type { SecurityApiDependencies } from "./case-store";
import { handleSecurityApi } from "./handler";
import { readStoredReportByCase } from "./report-intake";
import {
  ADMIN_ROUTINE_LIMITS,
  combineRoutineCalls,
  ROUTINE_PROOF_WINDOW_MS,
  routineDecisionSweep,
  routineMode,
  runRoutineDecisions,
} from "./routine-decisions";

const ORIGIN = "https://slop.test";
const START = "2026-11-17T12:00:00.000Z";
const PROJECT = "routine-program";
const REPOSITORY = "example/routine-program";
const OWNER = { githubId: "720000001", githubLogin: "owner" };
const ADMIN = { githubId: "720000009", githubLogin: "admin" };
const MODERATOR = { githubId: "720000008", githubLogin: "moderator" };
const REPORTERS = [2, 3, 4, 5, 6, 7].map((n) => ({
  githubId: `72000000${n}`,
  githubLogin: `reporter${n}`,
}));
const [ALICE, BOB, CAROL] = REPORTERS;
const OWNER_LINE = "Rounding dust below one cent in the fixture vault";
const PHISHING_LINE = SECURITY_DEFAULT_EXCLUSIONS[3];
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Actor = typeof OWNER;
type Body = Record<string, unknown> & {
  case?: Record<string, unknown> & { events?: Record<string, unknown>[] };
  submission?: { id: string; caseId: string; intake: { revision: number } };
  submissions?: { id: string; caseId: string }[];
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

function fixture() {
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
        excludedFindings: [OWNER_LINE],
      },
    },
  });
  const text = JSON.stringify(manifest);
  const digest = createHash("sha256").update(text).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(PROJECT, 1, text, digest, "Fixture terms", START);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
    )
    .run(PROJECT, text, digest, START, START);
  const objects = new Map<
    string,
    { bytes: Uint8Array; customMetadata: Record<string, string> }
  >();
  const storage: R2Bucket = {
    async put(key, bytes, options) {
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
  /** The fixture's two answers per report, chosen by the report summary. */
  const answers = new Map<
    string,
    (input: SecurityRoutineInput) => SecurityRoutineProposal[]
  >();
  const routineInputs: SecurityRoutineInput[] = [];
  let routineFails = false;
  let duringRoutine: (() => Promise<void>) | null = null;
  const callsBySummary = new Map<string, number>();
  const analyzer: SecurityAnalyzer = {
    provider: "deterministic-fixture",
    model: "fixture-routine",
    async analyze(input) {
      return {
        summary: `Summary of ${input.report.summary}`,
        severity: "high",
        potentialLoss: "unclear",
        duplicateCaseIds: [],
        rootCauseKey: "fixture-root-cause",
        remediation: "Review the isolated reproduction privately.",
      };
    },
    async screen() {
      return {
        decision: "legitimate",
        reason: "Concrete isolated reproduction merits human review.",
      };
    },
    async decideRoutine(input) {
      routineInputs.push(input);
      if (duringRoutine) {
        const callback = duringRoutine;
        duringRoutine = null;
        await callback();
      }
      if (routineFails) throw new Error("PRIVATE-PROVIDER-ERROR-SENTINEL");
      const index = callsBySummary.get(input.report.summary) ?? 0;
      callsBySummary.set(input.report.summary, index + 1);
      const pair = answers.get(input.report.summary)?.(input) ?? [
        answer(),
        answer(),
      ];
      return pair[index % 2];
    },
  };
  const deps: SecurityApiDependencies = {
    db,
    now: () => new Date(clock),
    randomId: () => `routine${String(++sequence).padStart(12, "0")}`,
    sessionActor: async () => actor,
    reportStorage: storage,
    analyzer,
    reportingRead: async () => ({ kind: "unavailable" }),
    moderatorGithubIds: new Set([MODERATOR.githubId]),
    routineDecisions: {
      mode: "live",
      adminGithubIds: new Set([ADMIN.githubId]),
    },
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
  /** Saves one report through the real intake route; returns its case id. */
  const report = async (
    as: Actor,
    summary: string,
    description = `${summary}. At commit abc a local test with synthetic funds shows it.`,
    extra: Record<string, unknown> = {},
  ) => {
    const created = await call(as, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: `routine-key-${++sequence}`.padEnd(20, "0"),
      origin: "slop",
      report: { summary, description, ...extra },
    });
    expect(created.status).toBe(201);
    const submission = created.body.submission;
    if (!submission) throw new Error("Fixture submission is missing");
    // Later reports are received later.
    clock += 1000;
    return { caseId: submission.caseId, submissionId: submission.id };
  };
  const routine = {
    db: deps.db,
    now: deps.now,
    analyzer: deps.analyzer,
    readReport: (caseId: string, version: number) =>
      readStoredReportByCase(deps, caseId, version),
  };
  /** One pass; the clock first moves past the minimum interval. */
  const pass = (mode: "dry_run" | "live" = "live") => {
    clock += 4 * MINUTE;
    return runRoutineDecisions(routine, {
      mode,
      source: "admin",
      limits: ADMIN_ROUTINE_LIMITS,
    });
  };
  const caseRow = (caseId: string) =>
    sqlite
      .query(
        "SELECT receipt_state, appeal_state, award_state, duplicate_of, revision, next_action_due_at FROM security_cases WHERE id=?",
      )
      .get(caseId) as {
      receipt_state: string;
      appeal_state: string;
      award_state: string;
      duplicate_of: string | null;
      revision: number;
      next_action_due_at: string | null;
    };
  const decisions = (caseId: string) =>
    sqlite
      .query(
        "SELECT mode, outcome, basis, hold_reason, exclusion_line, duplicate_of, applied, model_calls, calls, prompt_revision FROM security_routine_decisions WHERE case_id=? ORDER BY id",
      )
      .all(caseId) as Record<string, unknown>[];
  const notices = (as: Actor) =>
    sqlite
      .query(
        "SELECT event_key FROM notifications WHERE recipient_github_id=? AND kind='security_case'",
      )
      .all(as.githubId) as { event_key: string }[];
  const view = async (as: Actor, caseId: string) => {
    const read = await call(as, "GET", `security-cases/${caseId}`);
    if (!read.body.case) throw new Error("Fixture case is missing");
    return read.body.case;
  };
  const act = async (
    as: Actor,
    caseId: string,
    fields: Record<string, unknown>,
  ) =>
    call(as, "POST", `security-cases/${caseId}/actions`, {
      expectedRevision: caseRow(caseId).revision,
      idempotencyKey: `routine-act-${++sequence}`.padEnd(20, "0"),
      ...fields,
    });
  return {
    sqlite,
    deps,
    call,
    report,
    pass,
    caseRow,
    decisions,
    notices,
    view,
    act,
    answers,
    routineInputs,
    failRoutine: (value: boolean) => {
      routineFails = value;
    },
    duringRoutine: (callback: () => Promise<void>) => {
      duringRoutine = callback;
    },
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
    now: () => new Date(clock),
  };
}

describe("routine decisions on private reports", () => {
  test("the mode is off unless it is exactly dry_run or live", () => {
    expect(routineMode("dry_run")).toBe("dry_run");
    expect(routineMode("live")).toBe("live");
    for (const value of [undefined, "", "on", "LIVE", "dry-run", " live"])
      expect(routineMode(value)).toBe("off");
  });

  test("a dry run stores the decisions it would make and changes no case and notifies nobody", async () => {
    const t = fixture();
    const first = await t.report(
      ALICE,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    const copy = await t.report(
      BOB,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    const phishing = await t.report(
      CAROL,
      "The website can be cloned for phishing",
    );
    t.answers.set("The website can be cloned for phishing", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: PHISHING_LINE }),
    ]);
    const before = [first, copy, phishing].map((entry) =>
      t.caseRow(entry.caseId),
    );
    const noticesBefore = [ALICE, BOB, CAROL, OWNER].map(
      (person) => t.notices(person).length,
    );
    const run = await t.pass("dry_run");
    expect(run).toMatchObject({ mode: "dry_run", examined: 3, recorded: 3 });
    expect(
      [first, copy, phishing].map((entry) => t.caseRow(entry.caseId)),
    ).toEqual(before);
    expect(
      [ALICE, BOB, CAROL, OWNER].map((person) => t.notices(person).length),
    ).toEqual(noticesBefore);
    expect(t.decisions(first.caseId)).toMatchObject([
      {
        mode: "dry_run",
        outcome: "acknowledged",
        basis: "two-calls",
        applied: 0,
      },
    ]);
    expect(t.decisions(copy.caseId)).toMatchObject([
      {
        mode: "dry_run",
        outcome: "duplicate",
        basis: "digest",
        duplicate_of: first.caseId,
        applied: 0,
        model_calls: 0,
      },
    ]);
    expect(t.decisions(phishing.caseId)).toMatchObject([
      {
        mode: "dry_run",
        outcome: "does-not-qualify",
        exclusion_line: PHISHING_LINE,
        applied: 0,
        model_calls: 2,
        prompt_revision: "slop-security-routine-decision-2",
      },
    ]);
    // A repeat pass decides nothing twice.
    expect(await t.pass("dry_run")).toMatchObject({ examined: 0, recorded: 0 });
    // The admin route returns counts only.
    const summary = await t.call(ADMIN, "GET", "security-routine");
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ mode: "live", received: 3 });
    expect(JSON.stringify(summary.body)).not.toContain(first.caseId);
    expect(JSON.stringify(summary.body)).not.toContain(ALICE.githubLogin);
    expect(
      (summary.body.decisions as Record<string, unknown>[]).map((row) => [
        row.mode,
        row.outcome,
        row.cases,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["dry_run", "acknowledged", 1],
        ["dry_run", "duplicate", 1],
        ["dry_run", "does-not-qualify", 1],
      ]),
    );
    expect((await t.call(OWNER, "GET", "security-routine")).status).toBe(404);
    expect(
      (await t.call(OWNER, "POST", "security-routine", { action: "run" }))
        .status,
    ).toBe(404);
    // An admin starts one pass by hand; a second inside the interval waits.
    t.advance(4 * MINUTE);
    const manual = await t.call(ADMIN, "POST", "security-routine", {
      action: "run",
    });
    expect(manual.status).toBe(200);
    expect(manual.body).toMatchObject({ mode: "live", examined: 3 });
    expect(
      (await t.call(ADMIN, "POST", "security-routine", { action: "run" }))
        .status,
    ).toBe(409);
  });

  test("the same report bytes close as a duplicate without naming the earlier report or its reporter", async () => {
    const t = fixture();
    const first = await t.report(
      ALICE,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    const copy = await t.report(
      BOB,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    await t.pass();
    expect(t.caseRow(copy.caseId)).toMatchObject({
      receipt_state: "duplicate",
      duplicate_of: first.caseId,
      award_state: "ineligible",
    });
    expect(t.decisions(copy.caseId)).toMatchObject([
      { mode: "live", outcome: "duplicate", basis: "digest", applied: 1 },
    ]);
    // The first report is read, acknowledged and never closed by the copy.
    expect(t.caseRow(first.caseId).receipt_state).toBe("triaging");
    const reporterView = await t.view(BOB, copy.caseId);
    expect(reporterView).toMatchObject({
      view: "reporter",
      receiptState: "duplicate",
    });
    expect(reporterView.allowedActions).toContain("appeal");
    const text = JSON.stringify(reporterView);
    expect(text).toContain("duplicate of an earlier report");
    expect(text).not.toContain(first.caseId);
    expect(text).not.toContain(ALICE.githubLogin);
    expect(t.notices(BOB).map((row) => row.event_key)).toContain(
      `security-case:${copy.caseId}:2`,
    );
    // The owner's journal names the automation and the earlier case.
    const ownerView = await t.view(OWNER, copy.caseId);
    expect(ownerView.events?.at(-1)).toMatchObject({
      kind: "decide",
      actorGithubId: "slop",
      detail: {
        automatic: true,
        routine: {
          outcome: "duplicate",
          basis: "digest",
          duplicateOf: first.caseId,
        },
      },
    });
  });

  test("a report closes on a published line only when both calls name the same line and neither finds loss of funds plausible", async () => {
    const t = fixture();
    const agreed = await t.report(
      ALICE,
      "The website can be cloned for phishing",
    );
    const ownerLine = await t.report(
      BOB,
      "One cent of rounding dust stays in the vault",
    );
    const split = await t.report(
      CAROL,
      "Email spoofing of the support address",
    );
    const loss = await t.report(
      REPORTERS[3],
      "Phishing page that drains the vault through a real approval bug",
    );
    t.answers.set("The website can be cloned for phishing", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: PHISHING_LINE }),
    ]);
    t.answers.set("One cent of rounding dust stays in the vault", () => [
      answer({ doesNotQualifyLine: OWNER_LINE }),
      answer({ doesNotQualifyLine: OWNER_LINE }),
    ]);
    t.answers.set("Email spoofing of the support address", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: SECURITY_DEFAULT_EXCLUSIONS[4] }),
    ]);
    t.answers.set(
      "Phishing page that drains the vault through a real approval bug",
      () => [
        answer({ doesNotQualifyLine: PHISHING_LINE }),
        answer({
          doesNotQualifyLine: PHISHING_LINE,
          lossOfFundsPlausible: true,
        }),
      ],
    );
    await t.pass();
    await t.pass();
    expect(t.caseRow(agreed.caseId).receipt_state).toBe("out-of-scope");
    expect((await t.view(ALICE, agreed.caseId)).events?.at(-1)?.reason).toBe(
      `Slop's screening closed this report because it matches the program's published "Does not qualify" list: "${PHISHING_LINE}". If you think this is wrong, you can appeal once and the project owner will review the report.`,
    );
    expect(t.caseRow(ownerLine.caseId).receipt_state).toBe("out-of-scope");
    expect(t.decisions(ownerLine.caseId)).toMatchObject([
      { outcome: "does-not-qualify", exclusion_line: OWNER_LINE, applied: 1 },
    ]);
    expect(t.caseRow(split.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(split.caseId)).toMatchObject([
      { outcome: "acknowledged", hold_reason: "calls-disagreed" },
    ]);
    expect(t.caseRow(loss.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(loss.caseId)).toMatchObject([
      { outcome: "acknowledged", hold_reason: "loss-plausible" },
    ]);
    // The calls never see the proof or duplicate lines as closing lines, and
    // the second call reads the lines in the opposite order.
    const [first, second] = t.routineInputs;
    expect(first.doesNotQualify).toEqual(
      routineClosingExclusions({ excludedFindings: [OWNER_LINE] }),
    );
    expect(first.doesNotQualify).not.toContain(SECURITY_DEFAULT_EXCLUSIONS[0]);
    expect(first.doesNotQualify).not.toContain(SECURITY_DEFAULT_EXCLUSIONS[7]);
    expect(first.doesNotQualify).not.toContain(SECURITY_DEFAULT_EXCLUSIONS[9]);
    expect(second.doesNotQualify).toEqual([...first.doesNotQualify].reverse());
  });

  test("two calls naming the same earlier report close a duplicate; one call alone does not", async () => {
    const t = fixture();
    const original = await t.report(ALICE, "Withdraw skips the owner check");
    const reworded = await t.report(BOB, "Anyone can withdraw another account");
    const unsure = await t.report(CAROL, "Withdraw has an access control gap");
    t.answers.set("Anyone can withdraw another account", (input) => {
      // The earlier report reaches the call as Slopbot's summary only.
      expect(input.earlierReports).toEqual([
        {
          id: original.caseId,
          summary: "Summary of Withdraw skips the owner check",
        },
      ]);
      return [
        answer({ duplicateOfCaseId: original.caseId }),
        answer({ duplicateOfCaseId: original.caseId }),
      ];
    });
    t.answers.set("Withdraw has an access control gap", () => [
      answer({ duplicateOfCaseId: original.caseId }),
      answer(),
    ]);
    await t.pass();
    expect(t.caseRow(reworded.caseId)).toMatchObject({
      receipt_state: "duplicate",
      duplicate_of: original.caseId,
    });
    expect(t.decisions(reworded.caseId)).toMatchObject([
      { outcome: "duplicate", basis: "two-calls", model_calls: 2 },
    ]);
    expect(t.caseRow(unsure.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(unsure.caseId)).toMatchObject([
      { outcome: "acknowledged", hold_reason: "calls-disagreed" },
    ]);
  });

  test("a later report with proof is not closed as a duplicate of an earlier report that was refused or still waits for proof", async () => {
    const t = fixture();
    // An earlier report without proof: the pass asks for proof (clock).
    const vague = await t.report(ALICE, "The vault withdraw may be drainable");
    t.answers.set("The vault withdraw may be drainable", () => [
      answer({ proof: "missing", missing: ["runnable-proof"] }),
      answer({ proof: "missing", missing: ["runnable-proof"] }),
    ]);
    // An earlier report the owner closes as out of scope, then appealed.
    const appealed = await t.report(
      BOB,
      "Withdraw rounding leaves dust in the vault",
    );
    // An earlier report the owner rejects after a later report was closed
    // as its duplicate.
    const original = await t.report(CAROL, "Deposit skips the cap check");
    // An earlier report the owner asks a question about: still open, so a
    // later report of the same finding is its duplicate.
    const asked = await t.report(BOB, "Anyone can flip the fee switch");
    await t.pass();
    await t.pass();
    expect(t.caseRow(vague.caseId).receipt_state).toBe("needs-information");
    const copy = await t.report(REPORTERS[3], "Deposits can exceed the cap");
    t.answers.set("Deposits can exceed the cap", () => [
      answer({ duplicateOfCaseId: original.caseId }),
      answer({ duplicateOfCaseId: original.caseId }),
    ]);
    await t.pass();
    expect(t.caseRow(copy.caseId)).toMatchObject({
      receipt_state: "duplicate",
      duplicate_of: original.caseId,
    });
    for (const [caseId, outcome] of [
      [appealed.caseId, "out-of-scope"],
      [original.caseId, "rejected"],
    ] as const) {
      const decided = await t.act(OWNER, caseId, {
        action: "decide",
        outcome,
        severity: "low",
        loss: "not-verified",
        inScope: false,
        relatedParty: false,
        reason: "Reviewed by the owner: this report does not qualify.",
      });
      expect(decided.status).toBe(200);
    }
    const question = await t.act(OWNER, asked.caseId, {
      action: "request-information",
      reason: "Which deployment did you test the fee switch on?",
    });
    expect(question.status).toBe(200);
    expect(t.caseRow(asked.caseId)).toMatchObject({
      receipt_state: "needs-information",
      next_action_due_at: null,
    });
    const appeal = await t.act(BOB, appealed.caseId, {
      action: "appeal",
      reason: "The dust is a real loss of covered funds for each user.",
    });
    expect(appeal.status).toBe(200);
    expect(t.caseRow(appealed.caseId).receipt_state).toBe("disputed");

    // Later reports of the same findings, with proof. Both calls name the
    // earlier report (or, for the cap, its closed duplicate) whenever it is
    // supplied.
    const later = [
      {
        reporter: REPORTERS[4],
        summary: "Withdraw drains the vault: runnable test attached",
        earlier: [vague.caseId],
      },
      {
        reporter: REPORTERS[5],
        summary: "Withdraw rounding steals dust: runnable test attached",
        earlier: [appealed.caseId],
      },
      {
        reporter: ALICE,
        summary: "Deposit cap bypass: runnable test attached",
        earlier: [original.caseId, copy.caseId],
      },
      {
        reporter: CAROL,
        summary: "Fee switch has no access check: runnable test attached",
        earlier: [asked.caseId],
      },
    ];
    for (const entry of later)
      t.answers.set(entry.summary, (input) => {
        const named =
          entry.earlier.find((id) =>
            input.earlierReports.some((earlier) => earlier.id === id),
          ) ?? null;
        return [
          answer({ duplicateOfCaseId: named }),
          answer({ duplicateOfCaseId: named }),
        ];
      });
    const readBefore = t.routineInputs.length;
    const filed = [];
    for (const entry of later)
      filed.push(await t.report(entry.reporter, entry.summary));
    await t.pass();
    // The earlier report's clock runs out with no new version.
    t.advance(ROUTINE_PROOF_WINDOW_MS + MINUTE);
    await t.pass();
    expect(t.caseRow(vague.caseId).receipt_state).toBe("rejected");

    // Each later report is the first qualifying report of its finding, so
    // it goes to the owner instead of closing as a duplicate.
    const [askedLater, ...unqualified] = [filed[3], ...filed.slice(0, 3)];
    expect(t.caseRow(askedLater.caseId)).toMatchObject({
      receipt_state: "duplicate",
      duplicate_of: asked.caseId,
    });
    for (const entry of unqualified) {
      expect(t.caseRow(entry.caseId)).toMatchObject({
        receipt_state: "triaging",
        duplicate_of: null,
        award_state: "pending",
      });
      expect(t.decisions(entry.caseId)).toMatchObject([
        { outcome: "acknowledged", hold_reason: null, applied: 1 },
      ]);
    }
    // None of those earlier reports reached a later report's calls.
    const laterInputs = t.routineInputs.slice(readBefore);
    expect(laterInputs).toHaveLength(8);
    const excluded = [vague, appealed, original, copy].map(
      (entry) => entry.caseId,
    );
    for (const input of laterInputs)
      for (const earlier of input.earlierReports)
        expect(excluded).not.toContain(earlier.id);
  });

  test("a report without proof waits 14 days for a new version and closes only when none arrives", async () => {
    const t = fixture();
    const silent = await t.report(
      ALICE,
      "The vault can probably be drained somehow",
    );
    const revised = await t.report(BOB, "Fee math looks wrong in theory");
    const missing = () => [
      answer({ proof: "missing", missing: ["runnable-proof"] }),
      answer({ proof: "missing", missing: ["reproduction-steps"] }),
    ];
    t.answers.set("The vault can probably be drained somehow", missing);
    t.answers.set("Fee math looks wrong in theory", missing);
    await t.pass();
    const due = new Date(
      t.now().getTime() + ROUTINE_PROOF_WINDOW_MS,
    ).toISOString();
    for (const entry of [silent, revised]) {
      expect(t.caseRow(entry.caseId)).toMatchObject({
        receipt_state: "needs-information",
        next_action_due_at: due,
      });
      expect(t.decisions(entry.caseId)).toMatchObject([
        { outcome: "needs-proof", applied: 1 },
      ]);
    }
    const waiting = await t.view(ALICE, silent.caseId);
    expect(waiting).toMatchObject({
      receiptState: "needs-information",
      nextStepDueAt: due,
    });
    expect(JSON.stringify(waiting)).toContain(
      "did not find reproduction steps and a runnable proof",
    );
    expect(waiting.allowedActions).not.toContain("appeal");
    // Before the clock runs out nothing closes.
    t.advance(13 * DAY);
    expect(await t.pass()).toMatchObject({ examined: 0 });
    // One reporter adds a version with proof.
    const stored = await t.call(
      BOB,
      "GET",
      `security-submissions/${revised.submissionId}`,
    );
    const revision = await t.call(
      BOB,
      "POST",
      `security-submissions/${revised.submissionId}/report`,
      {
        expectedRevision: stored.body.submission?.intake.revision,
        report: {
          summary: "Fee math is wrong: runnable test attached",
          description:
            "forge test --match-test testFeeOverflow at commit abc fails as shown.",
        },
      },
    );
    expect(revision.status).toBe(200);
    t.advance(DAY);
    await t.pass();
    // The silent report closes as no proof received and can be appealed.
    expect(t.caseRow(silent.caseId)).toMatchObject({
      receipt_state: "rejected",
      next_action_due_at: null,
    });
    expect(t.decisions(silent.caseId).at(-1)).toMatchObject({
      outcome: "no-proof-received",
      basis: "clock",
      model_calls: 0,
    });
    const closed = await t.view(ALICE, silent.caseId);
    expect(JSON.stringify(closed)).toContain("closed as no proof received");
    expect(closed.allowedActions).toContain("appeal");
    // The revised report was read again and went to the owner.
    expect(t.caseRow(revised.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(revised.caseId).at(-1)).toMatchObject({
      outcome: "acknowledged",
      basis: "two-calls",
      hold_reason: null,
    });
  });

  test("a proof-of-concept file is proof present: the calls read it and no request for proof follows", async () => {
    const t = fixture();
    const proofOfConcept = {
      fileName: "FeeOverflow.t.sol",
      patch:
        "--- a/test/Fee.t.sol\n+++ b/test/Fee.t.sol\n@@ -1 +1,2 @@\n+function testFeeOverflow() public {}\n",
    };
    const filed = await t.report(
      ALICE,
      "Fee math overflows on large deposits",
      "Fee math overflows on large deposits at commit abc; see the attached test.",
      { proofOfConcept },
    );
    t.answers.set("Fee math overflows on large deposits", () => [
      answer({ proof: "missing", missing: ["runnable-proof"] }),
      answer({ proof: "missing", missing: ["reproduction-steps"] }),
    ]);
    await t.pass();
    expect(t.routineInputs.at(-1)?.report.proofOfConcept).toEqual(
      proofOfConcept,
    );
    expect(t.caseRow(filed.caseId)).toMatchObject({
      receipt_state: "triaging",
      next_action_due_at: null,
    });
    expect(t.decisions(filed.caseId)).toMatchObject([
      { outcome: "acknowledged", basis: "two-calls", applied: 1 },
    ]);
    expect(
      t.sqlite
        .query(
          "SELECT proof_present FROM security_routine_decisions WHERE case_id=?",
        )
        .get(filed.caseId),
    ).toEqual({ proof_present: 1 });
  });

  test("a report without proof that a call reads as a plausible loss of funds goes straight to the owner, with no clock", async () => {
    const t = fixture();
    const claim = await t.report(ALICE, "All funds can be stolen");
    t.answers.set("All funds can be stolen", () => [
      answer({ proof: "missing" }),
      answer({ proof: "missing", lossOfFundsPlausible: true }),
    ]);
    await t.pass();
    expect(t.caseRow(claim.caseId)).toMatchObject({
      receipt_state: "triaging",
      next_action_due_at: null,
    });
    expect(t.decisions(claim.caseId)).toMatchObject([
      { outcome: "acknowledged", hold_reason: "loss-plausible" },
    ]);
    t.advance(30 * DAY);
    expect(await t.pass()).toMatchObject({ examined: 0 });
  });

  test("an appeal of a routine close returns the report to the program owner, once, and the pass never reads it again", async () => {
    const t = fixture();
    const closed = await t.report(
      ALICE,
      "The website can be cloned for phishing",
    );
    t.answers.set("The website can be cloned for phishing", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: PHISHING_LINE }),
    ]);
    await t.pass();
    expect(t.caseRow(closed.caseId).receipt_state).toBe("out-of-scope");
    const ownerNotices = t.notices(OWNER).length;
    const appeal = await t.act(ALICE, closed.caseId, {
      action: "appeal",
      reason: "The report shows a contract bug, not a website problem.",
    });
    expect(appeal.status).toBe(200);
    expect(t.caseRow(closed.caseId)).toMatchObject({
      receipt_state: "triaging",
      appeal_state: "returned",
      award_state: "pending",
    });
    // The owner is told; no moderator decision is needed or created.
    expect(t.notices(OWNER).length).toBe(ownerNotices + 1);
    expect(t.notices(MODERATOR)).toEqual([]);
    expect(
      t.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM security_appeal_triages WHERE case_id=?",
        )
        .get(closed.caseId),
    ).toEqual({ n: 0 });
    // The owner now decides as for any open report.
    expect((await t.view(OWNER, closed.caseId)).allowedActions).toEqual(
      expect.arrayContaining(["decide", "request-information"]),
    );
    // The reporter has no second appeal of the routine decision.
    expect((await t.view(ALICE, closed.caseId)).allowedActions).not.toContain(
      "appeal",
    );
    // Even back in an open state, the pass leaves an appealed report alone.
    t.sqlite
      .query(
        "UPDATE security_cases SET receipt_state='received', appeal_state='none' WHERE id=?",
      )
      .run(closed.caseId);
    expect(await t.pass()).toMatchObject({ examined: 0 });
    // A person's close is appealed to a moderator as before.
    t.sqlite
      .query(
        "UPDATE security_cases SET receipt_state='triaging', appeal_state='returned' WHERE id=?",
      )
      .run(closed.caseId);
    const decided = await t.act(OWNER, closed.caseId, {
      action: "decide",
      outcome: "out-of-scope",
      severity: "low",
      loss: "not-verified",
      inScope: false,
      relatedParty: false,
      reason: "Reviewed by the owner: the claimed bug is in the website only.",
    });
    expect(decided.status).toBe(200);
    const second = await t.act(ALICE, closed.caseId, {
      action: "appeal",
      reason: "The owner misread the affected contract function.",
    });
    expect(second.status).toBe(200);
    expect(t.caseRow(closed.caseId)).toMatchObject({
      receipt_state: "disputed",
      appeal_state: "open",
    });
    expect(t.notices(MODERATOR).length).toBe(1);
  });

  test("a failed call decides nothing; after three failed attempts the report goes to the owner undecided", async () => {
    const t = fixture();
    const entry = await t.report(ALICE, "Unreadable by the provider today");
    t.failRoutine(true);
    for (const attempt of [1, 2, 3]) {
      t.advance(7 * 60 * MINUTE);
      await t.pass();
      expect(t.caseRow(entry.caseId).receipt_state).toBe("received");
      expect(t.decisions(entry.caseId).length).toBe(attempt);
    }
    expect(t.decisions(entry.caseId).at(-1)).toMatchObject({
      outcome: "unavailable",
      applied: 0,
      model_calls: 2,
    });
    expect(JSON.stringify(t.decisions(entry.caseId))).not.toContain("SENTINEL");
    // A retry waits: an immediate pass does not call again.
    const callsBefore = t.routineInputs.length;
    await t.pass();
    expect(t.routineInputs.length).toBe(callsBefore);
    t.advance(7 * 60 * MINUTE);
    await t.pass();
    expect(t.routineInputs.length).toBe(callsBefore);
    expect(t.caseRow(entry.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(entry.caseId).at(-1)).toMatchObject({
      outcome: "acknowledged",
      hold_reason: "analysis-unavailable",
      model_calls: 0,
    });
  });

  test("two overlapping passes record one final decision for a case revision", async () => {
    const t = fixture();
    const entry = await t.report(ALICE, "Distinct finding");
    const routine = {
      db: t.deps.db,
      now: t.deps.now,
      analyzer: t.deps.analyzer,
      readReport: (caseId: string, version: number) =>
        readStoredReportByCase(t.deps, caseId, version),
    };
    let inner: unknown;
    // While the first pass waits for its calls, a second pass that ignores
    // the lease reads and records the same report.
    t.duringRoutine(async () => {
      inner = await runRoutineDecisions(routine, {
        mode: "dry_run",
        source: "admin",
        limits: { ...ADMIN_ROUTINE_LIMITS, minIntervalMs: -1 },
      });
    });
    const outer = await t.pass("dry_run");
    expect(inner).toMatchObject({ examined: 1, recorded: 1 });
    expect(outer).toMatchObject({ examined: 1, recorded: 0 });
    expect(t.decisions(entry.caseId)).toMatchObject([
      { mode: "dry_run", outcome: "acknowledged", applied: 0 },
    ]);
  });

  test("a person's action during the calls wins and the routine decision is dropped", async () => {
    const t = fixture();
    const entry = await t.report(
      ALICE,
      "The website can be cloned for phishing",
    );
    t.answers.set("The website can be cloned for phishing", () => [
      answer({ doesNotQualifyLine: PHISHING_LINE }),
      answer({ doesNotQualifyLine: PHISHING_LINE }),
    ]);
    t.duringRoutine(async () => {
      const asked = await t.act(OWNER, entry.caseId, {
        action: "request-information",
        reason: "Which contract function does the page call?",
      });
      expect(asked.status).toBe(200);
    });
    const run = await t.pass();
    expect(run).toMatchObject({ examined: 1, recorded: 0 });
    expect(t.caseRow(entry.caseId)).toMatchObject({
      receipt_state: "needs-information",
      next_action_due_at: null,
    });
    expect(t.decisions(entry.caseId)).toEqual([]);
    // The owner's request has no clock, so the pass never closes it.
    t.advance(30 * DAY);
    expect(await t.pass()).toMatchObject({ examined: 0 });
  });

  test("a report that is on GitHub is acknowledged and never closed", async () => {
    const t = fixture();
    const first = await t.report(
      ALICE,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    const copy = await t.report(
      BOB,
      "Share rounding lets a withdrawal exceed a deposit",
    );
    // The copy was forwarded to GitHub, where a maintainer may be discussing it.
    t.sqlite.exec("DROP TRIGGER IF EXISTS security_submissions_frozen");
    t.sqlite
      .query(
        "UPDATE security_submissions SET advisory_ghsa='GHSA-aaaa-bbbb-cccc' WHERE id=?",
      )
      .run(copy.submissionId);
    await t.pass();
    expect(t.caseRow(first.caseId).receipt_state).toBe("triaging");
    expect(t.caseRow(copy.caseId).receipt_state).toBe("triaging");
    expect(t.decisions(copy.caseId)).toMatchObject([
      {
        outcome: "acknowledged",
        basis: "hold",
        hold_reason: "github-advisory",
      },
    ]);
  });

  test("passes are spaced by the lease and bounded per pass and per day", async () => {
    const t = fixture();
    for (const [index, reporter] of REPORTERS.slice(0, 5).entries())
      await t.report(reporter, `Distinct finding number ${index}`);
    const first = await t.pass();
    // Three model-read reports per admin pass.
    expect(first).toMatchObject({ examined: 5, recorded: 3 });
    // A second pass inside the minimum interval does not start.
    const routine = {
      db: t.deps.db,
      now: t.deps.now,
      analyzer: t.deps.analyzer,
      readReport: async () => null,
    };
    expect(
      await runRoutineDecisions(routine, {
        mode: "live",
        source: "admin",
        limits: ADMIN_ROUTINE_LIMITS,
      }),
    ).toBeNull();
    // With the day's budget spent, a later pass makes no call.
    const calls = t.routineInputs.length;
    t.advance(4 * MINUTE);
    expect(
      await runRoutineDecisions(
        {
          ...routine,
          readReport: (id, v) => readStoredReportByCase(t.deps, id, v),
        },
        {
          mode: "live",
          source: "admin",
          limits: { ...ADMIN_ROUTINE_LIMITS, modelCasesPerDay: 3 },
        },
      ),
    ).toMatchObject({ examined: 2, recorded: 0 });
    expect(t.routineInputs.length).toBe(calls);
    expect(
      t.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM security_routine_runs WHERE finished_at IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 2 });
  });

  test("the owner's list leads with acknowledged reports ranked by plausible severity, then proof, then age", async () => {
    const t = fixture();
    const low = await t.report(ALICE, "Low severity with proof");
    const highNoProof = await t.report(BOB, "High severity without full proof");
    const highProof = await t.report(CAROL, "High severity with proof");
    const unread = await t.report(REPORTERS[3], "Not read by a pass yet");
    t.answers.set("Low severity with proof", () => [
      answer({ severity: "low" }),
      answer({ severity: "low" }),
    ]);
    t.answers.set("High severity without full proof", () => [
      answer({ severity: "high", proof: "missing" }),
      answer({ severity: "medium", proof: "present" }),
    ]);
    t.answers.set("High severity with proof", () => [
      answer({ severity: "high" }),
      answer({ severity: "high" }),
    ]);
    await t.pass();
    expect(t.caseRow(unread.caseId).receipt_state).toBe("received");
    const list = await t.call(OWNER, "GET", "security-submissions");
    expect(list.body.submissions?.map((entry) => entry.caseId)).toEqual([
      highProof.caseId,
      highNoProof.caseId,
      low.caseId,
      unread.caseId,
    ]);
    // A reporter's own list keeps its order.
    const own = await t.call(ALICE, "GET", "security-submissions");
    expect(own.body.submissions?.map((entry) => entry.caseId)).toEqual([
      low.caseId,
    ]);
  });

  test("off runs nothing behind a request, and a request starts at most one background pass a minute", async () => {
    const t = fixture();
    await t.report(ALICE, "Distinct finding");
    const started: Promise<unknown>[] = [];
    t.deps.waitUntil = (work) => {
      started.push(work);
    };
    routineDecisionSweep.nextAt = 0;
    t.deps.routineDecisions = { mode: "off", adminGithubIds: new Set() };
    await t.call(ALICE, "GET", "security-cases");
    expect(started.length).toBe(0);
    t.deps.routineDecisions = { mode: "dry_run", adminGithubIds: new Set() };
    await t.call(ALICE, "GET", "security-cases");
    await t.call(ALICE, "GET", "security-cases");
    await Promise.all(started);
    routineDecisionSweep.nextAt = 0;
    expect(
      t.sqlite.query("SELECT mode, source FROM security_routine_runs").all(),
    ).toEqual([{ mode: "dry_run", source: "request" }]);
  });
});

describe("routine decision answers", () => {
  const input = {
    doesNotQualify: ["Line A", "Line B"],
    earlierReports: [{ id: "sc_earlier00001", summary: "Earlier" }],
  };
  const raw = (fields: Record<string, unknown>) =>
    JSON.stringify({
      lossOfFundsPlausible: false,
      duplicateOfCaseId: null,
      doesNotQualifyIndex: null,
      proof: "present",
      missing: [],
      severity: "low",
      ...fields,
    });

  test("an answer maps an index to its published line and keeps only known missing words", () => {
    expect(
      parseRoutineProposal(
        raw({
          doesNotQualifyIndex: 1,
          proof: "missing",
          missing: ["runnable-proof", "send the reporter a payment"],
        }),
        input,
      ),
    ).toMatchObject({
      doesNotQualifyLine: "Line B",
      missing: ["runnable-proof"],
    });
  });

  test("an earlier case or a line that was not supplied makes the answer invalid", () => {
    for (const fields of [
      { duplicateOfCaseId: "sc_not_supplied1" },
      { doesNotQualifyIndex: 2 },
      { doesNotQualifyIndex: "Line A" },
      { lossOfFundsPlausible: "no" },
      { proof: "maybe" },
      { severity: "catastrophic" },
    ])
      expect(() => parseRoutineProposal(raw(fields), input)).toThrow();
  });

  test("a plausible loss of funds stops every close, whatever else the calls agree on", () => {
    const now = new Date(START);
    const agreed = answer({
      duplicateOfCaseId: "sc_earlier00001",
      doesNotQualifyLine: "Line A",
      proof: "missing",
    });
    expect(
      combineRoutineCalls(
        agreed,
        { ...agreed, lossOfFundsPlausible: true },
        { now, askedForProofBefore: false },
        [],
      ),
    ).toMatchObject({ outcome: "acknowledged", holdReason: "loss-plausible" });
    // A second request for proof never starts a second clock.
    expect(
      combineRoutineCalls(
        answer({ proof: "missing" }),
        answer({ proof: "missing" }),
        { now, askedForProofBefore: true },
        [],
      ),
    ).toMatchObject({
      outcome: "acknowledged",
      holdReason: "proof-still-missing",
    });
  });
});
