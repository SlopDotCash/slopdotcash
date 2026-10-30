// Durable intake through the real API and migrations. The in-memory storage,
// screening answers and unavailable GitHub transport are deterministic fixtures;
// these tests prove controls, not live model quality or provider delivery.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  REWARD_ASSET_NETWORKS,
  rewardAssetChoice,
} from "../../src/lib/reward-asset.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import type { D1QueryStatement } from "../d1";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import type {
  CaseAnalysisView,
  SecurityAnalysisInput,
  SecurityAnalyzer,
  SecurityAppealInput,
  SecurityScreeningProposal,
} from "./analysis";
import {
  handleSecurityApi,
  type SecurityApiDependencies,
  type SecurityD1Database,
} from "./handler";
import { readStoredReportByCase } from "./report-intake";

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
  analysis: CaseAnalysisView | null;
  allowedActions: string[];
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
  cases?: Case[];
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

function fixture(overrides: Record<string, unknown> = {}) {
  const terms = () => ({ ...program(), ...overrides });
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
    securityBounty: terms(),
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
  const analyzed: SecurityAnalysisInput[] = [];
  const analysisTimeouts: number[] = [];
  let beforeAnalysisResult: (() => Promise<void>) | null = null;
  const analyzer: SecurityAnalyzer = {
    provider: "deterministic-fixture",
    model: "fixture-screening",
    async analyze(input, timeoutMs) {
      analyzed.push(input);
      analysisTimeouts.push(timeoutMs);
      if (beforeAnalysisResult) await beforeAnalysisResult();
      return {
        summary: `Assessment ${analyzed.length}: ${input.report.summary}`,
        severity: "high",
        potentialLoss: "unclear",
        duplicateCaseIds: [],
        rootCauseKey: "fixture-private-report",
        remediation: "Review the isolated reproduction privately.",
      };
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
    analyzed,
    analysisTimeouts,
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
    beforeAnalysis: (callback: (() => Promise<void>) | null) => {
      beforeAnalysisResult = callback;
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
          ...terms(),
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
          ...terms(),
          approvers: { technical: [OTHER], financial: [FINANCE], dispute: [] },
        },
      }),
    removePaidTerms: () => {
      const next = { ...manifest };
      delete next.securityBounty;
      publish(next);
    },
    publishProgram: (next: Record<string, unknown>) =>
      publish({ ...manifest, securityBounty: next }),
    fund: () => {
      publish({
        ...manifest,
        securityBounty: {
          ...terms(),
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
  test("an older receipt resolves outside the recent list without reading report text or widening access", async () => {
    const t = fixture();
    t.deps.analyzer = undefined;
    try {
      let first = "";
      for (let n = 0; n < 101; n++) {
        const created = await t.create(
          `old-receipt-${String(n).padStart(8, "0")}`,
        );
        expect(created.status).toBe(201);
        if (n === 0) first = required(created.body.submission).id;
        t.advance(7 * 60 * 1000);
      }
      const list = await t.call(REPORTER, "GET", "security-submissions");
      expect(required(list.body.submissions)).toHaveLength(100);
      expect(
        required(list.body.submissions).some((row) => row.id === first),
      ).toBe(false);
      const path = `security-submissions/${first}?view=receipt`;
      const storage = required(t.deps.reportStorage);
      const get = storage.get;
      storage.get = async () => {
        throw new Error("A receipt read must not fetch technical report text");
      };
      const receipt = await t.call(REPORTER, "GET", path);
      expect(receipt.status).toBe(200);
      expect(receipt.body.recipientGithubId).toBe(REPORTER.githubId);
      expect(required(receipt.body.submission).id).toBe(first);
      expect(receipt.body.report).toBeUndefined();
      expect((await t.call(OTHER, "GET", path)).status).toBe(404);
      expect((await t.call(null, "GET", path)).status).toBe(401);
      expect((await t.call(OWNER, "GET", path)).status).toBe(200);
      t.revokeOwner();
      expect((await t.call(OWNER, "GET", path)).status).toBe(404);
      storage.get = get;
      const full = await t.call(
        REPORTER,
        "GET",
        `security-submissions/${first}`,
      );
      expect(full.status).toBe(200);
      expect(full.body.report).toEqual(REPORT);
    } finally {
      t.sqlite.close();
    }
  });

  test("a changed browser account cannot submit another reporter's prepared draft", async () => {
    const t = fixture();
    const response = await t.call(OTHER, "POST", "security-submissions", {
      projectId: PROJECT,
      origin: "slop",
      idempotencyKey: "bound-reporter-draft-key",
      expectedReporterGithubId: REPORTER.githubId,
      report: REPORT,
    });
    expect(response.status).toBe(403);
    expect(t.objects.size).toBe(0);
    expect(t.screeningCalls()).toBe(0);
    expect(
      t.sqlite
        .query("SELECT COUNT(*) AS count FROM security_submissions")
        .get(),
    ).toEqual({ count: 0 });
    const accepted = await t.call(REPORTER, "POST", "security-submissions", {
      projectId: PROJECT,
      origin: "slop",
      idempotencyKey: "bound-reporter-draft-key",
      expectedReporterGithubId: REPORTER.githubId,
      report: REPORT,
    });
    expect(accepted.status).toBe(201);
    expect(t.objects.size).toBe(1);
  });

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

  test.each([
    {
      eligibility: "critical-loss-of-funds",
      severity: "critical",
      loss: "verified-potential",
    },
    {
      eligibility: "in-scope-security",
      severity: "high",
      loss: "not-verified",
    },
  ])(
    "the first $eligibility receipt keeps priority before and after funding",
    async ({ eligibility, severity, loss }) => {
      const t = fixture({ eligibility });
      const first = required(
        (await t.create("earlier-qualifying-report")).body.submission,
      );
      const decision = {
        action: "decide",
        outcome: "confirmed",
        severity,
        loss,
        inScope: true,
        reason: "The owner independently reproduced this in-scope finding.",
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
    },
  );

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

  test("private receipts freeze native, Robinhood and custom-token award identities", async () => {
    for (const choice of [
      rewardAssetChoice("base", "native", "", ""),
      rewardAssetChoice("solana", "native", "", ""),
      rewardAssetChoice("robinhood", "stablecoin", "", ""),
      rewardAssetChoice("ethereum", "token", `0x${"a".repeat(40)}`, "OPEN"),
    ]) {
      const definition = REWARD_ASSET_NETWORKS[choice.network];
      const decimals =
        choice.kind === "token" ? 18 : definition[choice.kind].decimals;
      const asset = {
        ...choice,
        decimals,
        chainId: definition.chainId,
        cluster: definition.cluster,
        verifiedAt: START,
      };
      const amount = {
        asset,
        currency: asset.symbol,
        decimals,
        network: asset.network,
        grossMinor: (4n * 10n ** BigInt(decimals)).toString(),
      };
      const t = fixture({ amount, settlement: undefined });
      const response = await t.create();
      expect(response.status).toBe(201);
      const submission = required(response.body.submission);
      // Later terms must not change the asset, units or split of this receipt.
      t.publishProgram({ ...program(), amount: program().amount });
      const received = await t.call(
        REPORTER,
        "GET",
        `security-cases/${submission.caseId}`,
      );
      expect(received.status).toBe(200);
      expect(received.body.case?.terms).toMatchObject({
        ...amount,
        researcherMinor: (3n * 10n ** BigInt(decimals)).toString(),
        slopMinor: (10n ** BigInt(decimals)).toString(),
      });
      expect(
        t.sqlite.query("SELECT * FROM security_award_reservations").all(),
      ).toEqual([]);
    }
  });

  test("a slop.cash full-award case pays the whole award and never reserves against a 75/25 vault", async () => {
    const full = {
      split: { researcherBasisPoints: 10000, slopBasisPoints: 0 },
      sponsor: { name: "slop.cash", githubId: null },
      settlement: undefined,
    };
    const t = fixture(full);
    const submission = required((await t.create()).body.submission);
    const received = await t.call(
      REPORTER,
      "GET",
      `security-cases/${submission.caseId}`,
    );
    expect(received.body.case?.terms).toMatchObject({
      grossMinor: "10000000000",
      researcherMinor: "10000000000",
      slopMinor: "0",
    });
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
          rootCauseKey: "vault-drain",
        })
      ).status,
    ).toBe(200);
    // A later revision binds a funded 75/25 bounty vault. The case keeps its
    // frozen full-award terms and must not reserve against that vault.
    t.fund();
    t.publishProgram({
      ...program(),
      funding: {
        state: "verified-available",
        evidence: "fixture-finalized-deposit",
        verifiedAt: START,
      },
    });
    const awarded = await t.caseAction(submission.caseId, {
      action: "award",
      decision: "amount",
      grossMinor: "10000000000",
      paymentDeadline: "2026-11-30T00:00:00.000Z",
      confirmation: true,
      reason: "Award the published platform bounty to the first reporter.",
    });
    expect(awarded.status).toBe(200);
    expect(awarded.body.case).toMatchObject({
      awardState: "pending",
      award: {
        grossMinor: "10000000000",
        researcherMinor: "10000000000",
        slopMinor: "0",
      },
    });
    expect(
      t.sqlite.query("SELECT * FROM security_award_reservations").all(),
    ).toEqual([]);
    // Even an approved full-award case has no payment path: the bounty vault
    // pays 75/25, so preparation fails closed until a full-award rail exists.
    t.sqlite.exec(
      `UPDATE security_cases SET award_state='approved' WHERE id='${submission.caseId}'`,
    );
    const prepared = await t.caseAction(submission.caseId, {
      action: "prepare-payment",
      network: "base",
      confirmation: true,
    });
    expect(prepared.status).toBe(409);
    expect(prepared.body.error).toBe("rail_unavailable");
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
    expect(received.body.case?.analysis).toBeUndefined();
    const assessed = await t.call(
      OWNER,
      "GET",
      `security-cases/${submission.caseId}`,
    );
    expect(assessed.body.case?.analysis).toMatchObject({
      state: "complete",
      sourceReportVersion: 1,
    });
    expect(t.analyzed).toHaveLength(1);
    expect(t.analyzed[0].report.description).toBe(REPORT.description);
    expect(t.analyzed[0].scope).toEqual(program().scope);
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

  test.each(["needs-information", "spam"] as const)(
    "a %s report needs explicit human forwarding before assessment",
    async (decision) => {
      const t = fixture();
      t.decision(decision);
      const submission = required((await t.create()).body.submission);
      expect(t.analyzed).toHaveLength(0);
      const blocked = await t.caseAction(submission.caseId, {
        action: "analyze",
      });
      expect(blocked.status).toBe(409);
      expect(t.analyzed).toHaveLength(0);
      const forwarded = await t.call(
        OWNER,
        "POST",
        `security-submissions/${submission.id}/review`,
        {
          expectedRevision: submission.intake.revision,
          decision: "forward",
          reason: "The private evidence supports technical review.",
        },
      );
      expect(forwarded.status).toBe(200);
      expect(t.analyzed).toHaveLength(1);
      const retry = await t.call(
        OWNER,
        "POST",
        `security-submissions/${submission.id}/screen`,
        {
          expectedRevision: required(forwarded.body.submission).intake.revision,
        },
      );
      expect(retry.status).toBe(200);
      expect(t.analyzed).toHaveLength(1);
      expect(t.screeningCalls()).toBe(1);
    },
  );

  test("a revision hides stale assessment, binds new content and keeps receipt scope", async () => {
    const t = fixture();
    const submission = required(
      (await t.create("assessment-revision")).body.submission,
    );
    const read = () =>
      t.call(OWNER, "GET", `security-cases/${submission.caseId}`);
    const original = required((await read()).body.case).analysis;
    expect(original).toMatchObject({
      state: "complete",
      sourceReportVersion: 1,
    });
    const requested = await t.call(
      OWNER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: submission.intake.revision,
        decision: "request-information",
        reason: "Include a second isolated reproduction.",
      },
    );
    const pending = required(requested.body.submission);
    expect(required((await read()).body.case).analysis).toBeNull();
    const unchanged = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      { expectedRevision: pending.intake.revision, report: REPORT },
    );
    expect(unchanged.status).toBe(409);
    expect(unchanged.body.error).toBe("report_unchanged");
    expect(t.analyzed).toHaveLength(1);
    t.publishProgram({
      ...program(),
      scope: { ...program().scope, includedAssets: ["Later scope"] },
    });
    t.beforeScreen(async () => {
      t.beforeScreen(null);
      const view = required((await read()).body.case);
      expect(view.analysis).toBeNull();
      expect(view.allowedActions).not.toContain("analyze");
      const comparison = await t.create("comparison-during-revision", OTHER);
      expect(comparison.status).toBe(201);
      expect(t.analyzed.at(-1)?.priorCases).toContainEqual({
        id: submission.caseId,
        rootCauseKey: null,
        summary: null,
      });
    });
    const revisedReport = {
      ...REPORT,
      description: `${REPORT.description} Second reproduction attached.`,
    };
    const revised = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      { expectedRevision: pending.intake.revision, report: revisedReport },
    );
    expect(revised.status).toBe(200);
    const current = required((await read()).body.case).analysis;
    expect(current).toMatchObject({
      state: "complete",
      sourceReportVersion: 2,
      attempt: 2,
    });
    expect(current?.advisoryDigest).not.toBe(original?.advisoryDigest);
    expect(t.analyzed.at(-1)?.report.description).toBe(
      revisedReport.description,
    );
    expect(t.analyzed.at(-1)?.scope).toEqual(program().scope);
    expect(
      (await readStoredReportByCase(t.deps, submission.caseId, 1))?.description,
    ).toBe(REPORT.description);
    expect(
      (await readStoredReportByCase(t.deps, submission.caseId, 2))?.description,
    ).toBe(revisedReport.description);
    const before = t.analyzed.length;
    const replay = await t.create("assessment-revision");
    expect(replay.body.replayed).toBe(true);
    expect(t.analyzed).toHaveLength(before);
    expect(
      t.sqlite
        .query(
          "SELECT attempt,report_version,state FROM security_case_analyses WHERE case_id=? ORDER BY attempt",
        )
        .all(submission.caseId),
    ).toEqual([
      { attempt: 1, report_version: 1, state: "complete" },
      { attempt: 2, report_version: 2, state: "complete" },
    ]);
  });

  test("appeal triage does not reuse a completed assessment of an older report version", async () => {
    const t = fixture();
    const appealInputs: SecurityAppealInput[] = [];
    required(t.deps.analyzer).triageAppeal = async (input) => {
      appealInputs.push(input);
      return {
        proposedOutcome: "return",
        rationale: "Review the revised evidence.",
        confidence: 0.95,
      };
    };
    const submission = required((await t.create()).body.submission);
    const review = await t.call(
      OWNER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: submission.intake.revision,
        decision: "request-information",
        reason: "Clarify the affected operation.",
      },
    );
    t.beforeAnalysis(async () => {
      throw new Error("Fixture revised assessment unavailable");
    });
    const revised = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      {
        expectedRevision: required(review.body.submission).intake.revision,
        report: { ...REPORT, summary: "Revised private finding" },
      },
    );
    expect(revised.status).toBe(200);
    expect(
      t.sqlite
        .query(
          "SELECT report_version,state FROM security_case_analyses WHERE case_id=? ORDER BY attempt",
        )
        .all(submission.caseId),
    ).toEqual([
      { report_version: 1, state: "complete" },
      { report_version: 2, state: "failed" },
    ]);
    expect(
      (
        await t.caseAction(submission.caseId, {
          action: "decide",
          outcome: "confirmed",
          severity: "critical",
          loss: "verified-potential",
          inScope: true,
          reason: "The revised reproduction proves the finding.",
          relatedParty: false,
          rootCauseKey: "revised-private-finding",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await t.caseAction(submission.caseId, {
          action: "award",
          decision: "none",
          reason: "The owner declines an award.",
        })
      ).status,
    ).toBe(200);
    const current = required(
      (await t.call(REPORTER, "GET", `security-cases/${submission.caseId}`))
        .body.case,
    );
    const appealed = await t.call(
      REPORTER,
      "POST",
      `security-cases/${submission.caseId}/actions`,
      {
        action: "appeal",
        expectedRevision: current.revision,
        idempotencyKey: "appeal-revised-private-report",
        reason: "Please consider the revised report and award decision.",
      },
    );
    expect(appealed.status).toBe(200);
    expect(appealInputs).toHaveLength(1);
    expect(appealInputs[0].analysisSummary).toBeNull();
    expect(appealInputs[0].scope).toEqual(program().scope);
    expect(
      t.sqlite
        .query("SELECT state FROM security_appeal_triages WHERE case_id=?")
        .get(submission.caseId),
    ).toEqual({ state: "complete" });
  });

  test("a late old assessment cannot replace a completed revision, and shares the background budget", async () => {
    const t = fixture();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pending: Promise<unknown>[] = [];
    t.deps.waitUntil = (task) => {
      pending.push(task);
    };
    t.beforeAnalysis(async () => {
      t.beforeAnalysis(null);
      started.resolve();
      await release.promise;
    });
    const submission = required((await t.create()).body.submission);
    await started.promise;
    await pending[0];
    expect(t.analysisTimeouts[0]).toBeGreaterThan(0);
    expect(t.analysisTimeouts[0]).toBeLessThan(25_000);
    expect(() =>
      t.sqlite
        .query(
          "UPDATE security_case_analyses SET report_version=2 WHERE case_id=? AND attempt=1",
        )
        .run(submission.caseId),
    ).toThrow("an analysis report version is immutable");
    const latest = required(
      (await t.call(REPORTER, "GET", `security-submissions/${submission.id}`))
        .body.submission,
    );
    const review = await t.call(
      OWNER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: latest.intake.revision,
        decision: "request-information",
        reason: "Clarify the affected operation.",
      },
    );
    const from = pending.length;
    const revision = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/report`,
      {
        expectedRevision: required(review.body.submission).intake.revision,
        report: { ...REPORT, summary: "Revised affected operation" },
      },
    );
    expect(revision.status).toBe(200);
    await pending[from];
    await Promise.all(pending.slice(from));
    const read = () =>
      t.call(OWNER, "GET", `security-cases/${submission.caseId}`);
    expect(required((await read()).body.case).analysis).toMatchObject({
      state: "complete",
      sourceReportVersion: 2,
      attempt: 2,
    });
    release.resolve();
    await Promise.all(pending);
    expect(required((await read()).body.case).analysis).toMatchObject({
      state: "complete",
      sourceReportVersion: 2,
      attempt: 2,
    });
    expect(t.analyzed).toHaveLength(2);
  });

  test("reporter screening retries cannot repeat a failed assessment, but the owner can retry", async () => {
    const t = fixture();
    t.beforeAnalysis(async () => {
      throw new Error("Fixture analysis unavailable");
    });
    const submission = required((await t.create()).body.submission);
    expect(submission.intake.state).toBe("legitimate");
    expect(submission.intake.routingState).toBe("routed");
    expect(t.analyzed).toHaveLength(1);
    t.beforeAnalysis(null);
    for (let retry = 0; retry < 3; retry++) {
      const screened = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/screen`,
        { expectedRevision: submission.intake.revision },
      );
      expect(screened.status).toBe(200);
      expect(t.analyzed).toHaveLength(1);
      expect(t.screeningCalls()).toBe(1);
    }
    const before = await t.call(
      OWNER,
      "GET",
      `security-cases/${submission.caseId}`,
    );
    expect(before.body.case?.analysis).toMatchObject({
      state: "failed",
      attempt: 1,
    });
    const recovered = await t.caseAction(submission.caseId, {
      action: "analyze",
    });
    expect(recovered.status).toBe(200);
    expect(recovered.body.case?.analysis).toMatchObject({
      state: "complete",
      attempt: 2,
      sourceReportVersion: 1,
    });
    expect(t.analyzed).toHaveLength(2);
  });

  test("an unreadable saved report records an unavailable owner analysis that can run again", async () => {
    const t = fixture();
    t.beforeAnalysis(async () => {
      throw new Error("Fixture analysis unavailable");
    });
    const submission = required((await t.create()).body.submission);
    // The retained object is gone, as after a private storage fault.
    t.objects.clear();
    const attempts = () =>
      t.sqlite
        .query(
          "SELECT state FROM security_case_analyses WHERE case_id=? ORDER BY attempt",
        )
        .all(submission.caseId);
    const first = await t.caseAction(submission.caseId, { action: "analyze" });
    expect(first.status).toBe(200);
    expect(attempts()).toEqual([{ state: "failed" }, { state: "unavailable" }]);
    expect(
      (first.body.case as unknown as { allowedActions: string[] })
        .allowedActions,
    ).toContain("analyze");
    const again = await t.caseAction(submission.caseId, { action: "analyze" });
    expect(again.status).toBe(200);
    expect(attempts()).toEqual([
      { state: "failed" },
      { state: "unavailable" },
      { state: "unavailable" },
    ]);
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
    for (const [person, revoked] of [
      [OTHER, false],
      [FINANCE, true],
    ] as const)
      t.sqlite
        .prepare(
          "INSERT INTO security_case_members(case_id,github_id,github_login,role,added_by_github_id,added_at,revoked_at,revoked_by_github_id) VALUES (?,?,?,'triager',?,?,?,?)",
        )
        .run(
          submission.caseId,
          person.githubId,
          person.githubLogin,
          OWNER.githubId,
          START,
          revoked ? START : null,
          revoked ? OWNER.githubId : null,
        );
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
    expect(t.notices(OTHER)).toHaveLength(1);
    expect(t.notices(FINANCE)).toHaveLength(0);
    const rescreened = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/screen`,
      { expectedRevision: submission.intake.revision },
    );
    expect(rescreened.status).toBe(200);
    expect(t.notices(OTHER)).toHaveLength(1);
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

  test("a case list reads repository authority once per project, not per case", async () => {
    const t = fixture();
    const ids: string[] = [];
    for (const name of ["first-report", "second-report", "third-report"]) {
      ids.push(required((await t.create(name)).body.submission).caseId);
      t.advance(1000);
    }
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
      reads += 1;
      return access;
    };
    const listed = await t.call(OWNER, "GET", "security-cases");
    expect(listed.status).toBe(200);
    expect(listed.body.authorityUnavailable).toBe(false);
    expect(listed.body.cases?.map((row) => row.id).sort()).toEqual(
      [...ids].sort(),
    );
    // One read selects the project's cases and one decides their roles.
    expect(reads).toBe(2);
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
      expect(
        t
          .notices(REPORTER)
          .filter((notice) =>
            String((notice as { event_key: string }).event_key).startsWith(
              "security-information:",
            ),
          ),
      ).toHaveLength(1);
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

  test("honors a new program's in-scope criteria without imposing a funds-loss gate", async () => {
    const t = fixture({ eligibility: "in-scope-security" });
    const accepted = await t.create();
    const submission = required(accepted.body.submission);
    // A later program edit cannot narrow the terms already accepted at receipt.
    t.publishProgram({ ...program(), eligibility: "critical-loss-of-funds" });
    const decided = await t.caseAction(submission.caseId, {
      action: "decide",
      outcome: "confirmed",
      severity: "high",
      loss: "not-verified",
      inScope: true,
      reason:
        "Reproduced the private data exposure within the published scope.",
      relatedParty: false,
      rootCauseKey: "private-data-exposure",
    });
    expect(decided.status).toBe(200);
    const awarded = await t.caseAction(submission.caseId, {
      action: "award",
      decision: "amount",
      grossMinor: "10000000000",
      paymentDeadline: "2026-11-30T00:00:00.000Z",
      confirmation: true,
      reason: "The report meets the criteria frozen at receipt.",
    });
    expect(awarded.status).toBe(200);
    expect(required(awarded.body.case).award.grossMinor).toBe("10000000000");
    t.sqlite.close();
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
