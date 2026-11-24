/**
 * The private security queue route (operator decision, 24 November 2026; PRD
 * section 8), against real migrated SQLite and the deployed Pages router.
 * The analyzer is a deterministic stand-in: these tests prove which report
 * the job picks and the limits around it, not the quality of an analysis.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { onRequest } from "../../functions/api/v1/[[path]]";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Database, D1QueryStatement } from "../d1";
import type {
  AnalysisDependencies,
  SecurityAnalysisReport,
  SecurityAnalyzer,
} from "./analysis";
import {
  DAILY_ATTEMPT_LIMIT,
  handleSecurityQueue,
  SECURITY_QUEUE_PATH,
  SECURITY_QUEUE_SCHEMA,
} from "./operator-queue";

const TOKEN = "queue-token-0123456789abcdef0123456789abcdef";
const URL_ = `https://slop.cash${SECURITY_QUEUE_PATH}`;
const NOW = "2026-11-24T12:00:00.000Z";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const REPORTER = "730000002";

const REPORT: SecurityAnalysisReport = {
  summary: "Fixture finding",
  description: "A synthetic report body used only by this test.",
  severity: "high",
  cvss: null,
  cweIds: [],
  packages: [],
};

const before = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

function fixture(options: { analyzerFails?: boolean } = {}) {
  const { db, sqlite } = sqliteD1();
  const database = db as unknown as D1Database<D1QueryStatement>;
  let ghsa = 0;
  const project = (id: string) => {
    const text = JSON.stringify(
      applicationManifest(id, `example/${id}`, { status: "active" }),
    );
    const digest = createHash("sha256").update(text).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, 1, text, digest, "Fixture terms", NOW);
    sqlite
      .query(
        "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
      )
      .run(id, text, digest, NOW, NOW);
  };
  const addCase = (
    id: string,
    projectId: string,
    createdAt: string,
    receiptState = "received",
  ) => {
    ghsa += 1;
    const code = String(ghsa).padStart(4, "a");
    sqlite
      .query(
        `INSERT INTO security_cases (id,project_id,advisory_repository,advisory_ghsa,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at)
         VALUES (?,?,?,?,?,'reporter','verified',?,?,'1',?,'not-started','not-applicable','not-applicable','embargoed','private','none',1,?,?)`,
      )
      .run(
        id,
        projectId,
        `example/${projectId}`,
        `GHSA-${code}-bbbb-cccc`,
        REPORTER,
        createdAt,
        createdAt,
        receiptState,
        createdAt,
        createdAt,
      );
  };
  const addAttempt = (
    caseId: string,
    attempt: number,
    state: "running" | "failed" | "unavailable" | "complete",
    startedAt: string,
  ) =>
    sqlite
      .query(
        `INSERT INTO security_case_analyses (case_id,attempt,state,prompt_revision,started_at,finished_at,summary)
         VALUES (?,?,?,'fixture',?,?,?)`,
      )
      .run(
        caseId,
        attempt,
        state,
        startedAt,
        state === "running" ? null : startedAt,
        state === "complete" ? "Done" : null,
      );
  const holdDeposit = (caseId: string, projectId: string) =>
    sqlite
      .query(
        `INSERT INTO security_report_deposits (case_id,project_id,item,mode,slop_amount,slop_per_usd,asked_at)
         VALUES (?,?,?,'asked','1','1',?)`,
      )
      .run(caseId, projectId, `item-${caseId}`, NOW);
  const analyzed: string[] = [];
  const analyzer: SecurityAnalyzer = {
    provider: "fixture",
    model: "fixture-model",
    async analyze(input) {
      analyzed.push(input.report.summary);
      if (options.analyzerFails) throw new Error("provider failed");
      return {
        summary: "Fixture analysis",
        severity: "high",
        potentialLoss: "unclear",
        duplicateCaseIds: [],
        rootCauseKey: null,
        remediation: "Fix the fixture.",
      };
    },
  };
  const reportsRead: string[] = [];
  const analysis: AnalysisDependencies = {
    db: database,
    now: () => new Date(NOW),
    advisories: null,
    analyzer,
    storedReport: async (caseId) => {
      reportsRead.push(caseId);
      return REPORT;
    },
  };
  const attempts = (caseId: string) =>
    sqlite
      .query(
        "SELECT attempt, state FROM security_case_analyses WHERE case_id=? ORDER BY attempt",
      )
      .all(caseId) as { attempt: number; state: string }[];
  const request = (method: string, authorization?: string) =>
    handleSecurityQueue(
      new Request(URL_, {
        method,
        headers: authorization ? { authorization } : {},
        ...(method === "POST" ? { body: "{}" } : {}),
      }),
      { token: TOKEN, analysis },
    );
  return {
    sqlite,
    project,
    addCase,
    addAttempt,
    holdDeposit,
    attempts,
    analyzed,
    reportsRead,
    request,
  };
}

describe("operator security queue", () => {
  test("a missing, wrong or unset token is not this route", async () => {
    const t = fixture();
    expect(await t.request("GET")).toBeNull();
    expect(await t.request("GET", "Bearer wrong")).toBeNull();
    expect(await t.request("POST", "Bearer wrong")).toBeNull();
    const unset = await handleSecurityQueue(
      new Request(URL_, { headers: { authorization: `Bearer ${TOKEN}` } }),
      {
        token: undefined,
        analysis: {
          db: t.sqlite as never,
          now: () => new Date(NOW),
          advisories: null,
          analyzer: null,
        },
      },
    );
    expect(unset).toBeNull();
    const other = await t.request("DELETE", `Bearer ${TOKEN}`);
    expect(other?.status).toBe(405);
  });

  test("GET returns per-project counts and never a case id", async () => {
    const t = fixture();
    t.project("alpha");
    t.project("beta");
    // alpha: one never analyzed, one failed, one complete, one old, one held,
    // one decided (not open).
    t.addCase("sc_alpha00001", "alpha", before(10 * DAY));
    t.addCase("sc_alpha00002", "alpha", before(2 * DAY), "triaging");
    t.addAttempt("sc_alpha00002", 1, "failed", before(DAY));
    t.addCase("sc_alpha00003", "alpha", before(DAY));
    t.addAttempt("sc_alpha00003", 1, "complete", before(DAY));
    t.addCase("sc_alpha00004", "alpha", before(3 * DAY));
    t.holdDeposit("sc_alpha00004", "alpha");
    t.addCase("sc_alpha00005", "alpha", before(20 * DAY), "rejected");
    // beta: one with a lost running attempt (stale), one running now.
    t.addCase("sc_beta000001", "beta", before(DAY));
    t.addAttempt("sc_beta000001", 1, "running", before(60 * MINUTE));
    t.addCase("sc_beta000002", "beta", before(DAY / 2));
    t.addAttempt("sc_beta000002", 1, "running", before(MINUTE));
    const response = await t.request("GET", `Bearer ${TOKEN}`);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    const text = await (response as Response).text();
    expect(text).not.toContain("sc_");
    expect(text).not.toContain("GHSA");
    expect(text).not.toContain(REPORTER);
    expect(JSON.parse(text)).toEqual({
      schema: SECURITY_QUEUE_SCHEMA,
      generatedAt: NOW,
      projects: [
        {
          projectId: "alpha",
          open: 3,
          withoutAnalysis: 1,
          analysisFailed: 1,
          undecidedOver7Days: 1,
          oldestOpenAt: before(10 * DAY),
        },
        {
          projectId: "beta",
          open: 2,
          withoutAnalysis: 0,
          analysisFailed: 1,
          undecidedOver7Days: 0,
          oldestOpenAt: before(DAY),
        },
      ],
    });
  });

  test("POST analyzes the oldest eligible report once, with the full limit", async () => {
    const t = fixture();
    t.project("alpha");
    t.addCase("sc_alpha00002", "alpha", before(2 * DAY));
    t.addCase("sc_alpha00001", "alpha", before(5 * DAY));
    t.addCase("sc_alpha00003", "alpha", before(9 * DAY));
    t.holdDeposit("sc_alpha00003", "alpha");
    const response = await t.request("POST", `Bearer ${TOKEN}`);
    const body = await (response as Response).json();
    expect(body).toEqual({
      ran: true,
      state: "complete",
      remainingEligible: 1,
    });
    expect(JSON.stringify(body)).not.toContain("sc_");
    // The held report is skipped; the oldest other one ran, and only it.
    expect(t.reportsRead).toEqual(["sc_alpha00001"]);
    expect(t.attempts("sc_alpha00001")).toEqual([
      { attempt: 1, state: "complete" },
    ]);
    expect(t.attempts("sc_alpha00002")).toEqual([]);
    expect(t.attempts("sc_alpha00003")).toEqual([]);
  });

  test("POST waits 30 minutes between attempts and stops after four", async () => {
    const t = fixture({ analyzerFails: true });
    t.project("alpha");
    // Failed 10 minutes ago: too soon.
    t.addCase("sc_alpha00001", "alpha", before(9 * DAY));
    t.addAttempt("sc_alpha00001", 1, "failed", before(10 * MINUTE));
    // Four failed attempts already: no more.
    t.addCase("sc_alpha00002", "alpha", before(8 * DAY));
    for (const attempt of [1, 2, 3, 4])
      t.addAttempt("sc_alpha00002", attempt, "failed", before(DAY));
    // Running and not stale: the owner or another caller holds it.
    t.addCase("sc_alpha00003", "alpha", before(7 * DAY));
    t.addAttempt("sc_alpha00003", 1, "running", before(5 * MINUTE));
    // Complete: never retried.
    t.addCase("sc_alpha00004", "alpha", before(6 * DAY));
    t.addAttempt("sc_alpha00004", 1, "complete", before(DAY));
    // Decided: not open.
    t.addCase("sc_alpha00005", "alpha", before(10 * DAY), "duplicate");
    expect(await (await t.request("POST", `Bearer ${TOKEN}`))?.json()).toEqual({
      ran: false,
      reason: "none-eligible",
    });
    // Three failed attempts, the last 40 minutes ago: retried, and recorded.
    t.addCase("sc_alpha00006", "alpha", before(DAY));
    for (const attempt of [1, 2, 3])
      t.addAttempt(
        "sc_alpha00006",
        attempt,
        "unavailable",
        before(40 * MINUTE),
      );
    expect(await (await t.request("POST", `Bearer ${TOKEN}`))?.json()).toEqual({
      ran: true,
      state: "failed",
      remainingEligible: 0,
    });
    expect(t.attempts("sc_alpha00006").at(-1)).toEqual({
      attempt: 4,
      state: "failed",
    });
    expect(t.analyzed).toEqual([REPORT.summary]);
  });

  test("POST refuses once the day's attempts reach the ceiling", async () => {
    const t = fixture();
    t.project("alpha");
    t.addCase("sc_alpha00001", "alpha", before(9 * DAY));
    t.addCase("sc_busy000001", "alpha", before(9 * DAY), "confirmed");
    for (let attempt = 1; attempt <= DAILY_ATTEMPT_LIMIT; attempt++)
      t.addAttempt("sc_busy000001", attempt, "failed", before(MINUTE));
    expect(await (await t.request("POST", `Bearer ${TOKEN}`))?.json()).toEqual({
      ran: false,
      reason: "daily-limit",
    });
    expect(t.attempts("sc_alpha00001")).toEqual([]);
  });

  test("through the router, a wrong or missing token is the same answer as a path that does not exist", async () => {
    const d1 = sqliteD1();
    const routed = async (
      env: Record<string, string>,
      method: string,
      authorization?: string,
    ) => {
      const response = await onRequest({
        request: new Request(`https://slop.cash${SECURITY_QUEUE_PATH}`, {
          method,
          headers: authorization ? { authorization } : {},
        }),
        env: {
          SLOP_DB: d1.db,
          PAYMENT_NETWORKS: "[]",
          TRACE_AUTH_SECRET: "test-only-trace-rate-limit-secret-long-enough",
          ...env,
        },
      } as never);
      return {
        status: response.status,
        body: await response.text(),
        headers: [...response.headers].sort(),
      };
    };
    const unknown = await routed({}, "GET");
    expect(unknown.status).toBe(404);
    const env = { OPERATOR_FEED_TOKEN: TOKEN };
    for (const answer of [
      await routed({}, "GET", `Bearer ${TOKEN}`),
      await routed(env, "GET"),
      await routed(env, "GET", "Bearer wrong"),
      await routed(env, "POST", "Bearer wrong"),
    ])
      expect(answer).toEqual(unknown);
    const allowed = await routed(env, "GET", `Bearer ${TOKEN}`);
    expect(allowed.status).toBe(200);
    expect(JSON.parse(allowed.body).projects).toEqual([]);
    const run = await routed(env, "POST", `Bearer ${TOKEN}`);
    expect(JSON.parse(run.body)).toEqual({
      ran: false,
      reason: "none-eligible",
    });
  });
});
