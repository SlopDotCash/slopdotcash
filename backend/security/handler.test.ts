// Runs the security case API against the real migrations. GitHub's private
// vulnerability reports and the analysis model are injected, and a
// concurrent writer can run between the case read and the write batch,
// which a browser test cannot schedule deterministically.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { AdvisoryReader, GithubPrivateReport } from "./advisories";
import type {
  SecurityAnalysisInput,
  SecurityAnalyzer,
  SecurityAppealInput,
} from "./analysis";
import {
  handleSecurityApi,
  pvrState,
  type SecurityD1Database,
} from "./handler";

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ORIGIN = "https://slop.test";
const PROJECT = "bounty";
const REPOSITORY = "example/bounty";
const MAINTAINER = { githubId: "900000101", githubLogin: "maintainer" };
const REPORTER = { githubId: "900000102", githubLogin: "reporter" };
const TRIAGER = { githubId: "900000103", githubLogin: "triager" };
const FINANCE = { githubId: "900000104", githubLogin: "finance" };
const FINANCE_2 = { githubId: "900000107", githubLogin: "finance-two" };
const DISPUTE = { githubId: "900000105", githubLogin: "dispute" };
const DISPUTE_2 = { githubId: "900000106", githubLogin: "dispute-two" };
const DISPUTE_3 = { githubId: "900000108", githubLogin: "dispute-three" };
const DISPUTE_4 = { githubId: "900000109", githubLogin: "dispute-four" };
const DISPUTE_5 = { githubId: "900000110", githubLogin: "dispute-five" };
const OTHER = { githubId: "900000111", githubLogin: "other-reporter" };
const REVISION_AT = "2026-10-19T09:00:00.000Z";
const SECRET_DETAIL = "Synthetic exploit narrative that must stay private.";

type Account = typeof MAINTAINER;
type CaseReply = {
  id: string;
  revision: number;
  submissionState: string;
  receivedAt: string | null;
  receivedAtSource: string | null;
  awardState: string;
  receiptState: string;
  appealState: string;
  viewerRoles: string[];
  allowedActions: string[];
  nextStep: string;
  award: {
    grossMinor: string;
    researcherMinor: string;
    slopMinor: string;
  } | null;
  analysis?: {
    state: string;
    summary: string | null;
    duplicateCaseIds: string[];
    retryable: boolean;
  } | null;
  awardFunds?: { availableMinor: string } | null;
};
type Reply = {
  error?: string;
  replayed?: boolean;
  state?: string;
  received?: number;
  submission?: {
    id: string;
    state: string;
    lastCheck: string | null;
    caseId: string | null;
  };
  submissions?: { id: string }[];
  cases?: CaseReply[];
  case: CaseReply;
};

const VAULT = `0x${"b".repeat(40)}`;
const ASSET = `0x${"a".repeat(40)}`;
// Slop moderators decide escalated appeals and related-party reviews.
const MODERATORS = new Set(
  [DISPUTE, DISPUTE_2, DISPUTE_3, DISPUTE_4, DISPUTE_5].map((a) => a.githubId),
);

// An open paid program of 1.000000 USDC per finding. Its bounty vault holds
// a finalized free balance of two awards (see `fund`).
const OPEN_PROGRAM = {
  status: "open",
  intake: { repository: REPOSITORY },
  amount: {
    currency: "USDC",
    decimals: 6,
    network: "base",
    grossMinor: "1000000",
  },
  settlement: {
    chain: "base",
    deployments: [{ network: "base-sepolia", vault: VAULT, asset: ASSET }],
  },
  funding: {
    state: "verified-available",
    evidence: "synthetic-funding-evidence",
    verifiedAt: REVISION_AT,
  },
  sponsor: { name: "Slop", githubId: null },
  approvers: {
    technical: [MAINTAINER],
    financial: [FINANCE, FINANCE_2],
    dispute: [DISPUTE, DISPUTE_2, DISPUTE_3, DISPUTE_4, DISPUTE_5],
  },
  capacity: { awards: 2, closesAt: null },
  responseTargets: {
    acknowledgeHours: 24,
    triageBusinessDays: 3,
    updateIntervalDays: 7,
  },
  scope: {
    includedAssets: ["Vault deposits"],
    severityRubric: "Critical means loss of covered funds.",
    lossDefinition: "Unauthorized loss of covered assets.",
  },
};

function programManifest(
  securityBounty: Record<string, unknown>,
  listingTier = "community",
): string {
  return JSON.stringify({
    id: PROJECT,
    status: listingTier === "retired" ? "paused" : "active",
    listingTier,
    repositories: [{ id: REPOSITORY }],
    authority: { repositoryId: "123", repositoryNodeId: "R_kgDO123" },
    securityBounty,
  });
}

let ghsaCount = 0;
const GHSA_CHARS = "23456789cfghjmpqrvwx";
function report(
  author: Account,
  createdAt: string,
  ghsa = `GHSA-2c3f-4g5h-${GHSA_CHARS[Math.floor(ghsaCount / GHSA_CHARS.length) % GHSA_CHARS.length]}${GHSA_CHARS[ghsaCount++ % GHSA_CHARS.length]}9m`,
): GithubPrivateReport {
  return {
    ghsa,
    createdAt,
    state: "triage",
    author: { githubId: author.githubId, githubLogin: author.githubLogin },
    summary: "Vault share rounding",
    description: SECRET_DETAIL,
    referenceLines: [],
    severity: "critical",
    cweIds: ["CWE-682"],
    packages: ["npm:vault"],
  };
}

function open(securityBounty: Record<string, unknown> = OPEN_PROGRAM) {
  const { db, sqlite } = sqliteD1(migrations);
  const manifest = programManifest(securityBounty);
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'test', ?)",
    )
    .run(PROJECT, manifest, digest, REVISION_AT);
  sqlite
    .query(
      "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)",
    )
    .run(PROJECT, manifest, digest, REVISION_AT, REVISION_AT);
  let actor = MAINTAINER;
  let ids = 0;
  let clock = Date.parse("2026-10-19T10:00:00.000Z");
  /** A current finalized snapshot of the bounty vault's free balance. */
  const fund = (freeMinor: string) =>
    sqlite
      .query(
        `INSERT INTO security_vault_snapshots(project_id,network,chain,vault,asset_address,asset_decimals,total_deposited,total_paid,total_payout_fees,total_gross_withdrawn,total_withdrawal_fees,total_service_fees,free_balance,reserved_principal,reserved_fees,accrued_fees,reserved,block_number,block_time,observed_at) VALUES(?, 'base-sepolia', 'base', ?, ?, 6, ?, '0', '0', '0', '0', '0', ?, NULL, NULL, NULL, '0', '64', ?, ?)
        ON CONFLICT(project_id,network,vault) DO UPDATE SET free_balance = excluded.free_balance, total_deposited = excluded.total_deposited, block_number = CAST(CAST(block_number AS INTEGER) + 1 AS TEXT), observed_at = excluded.observed_at`,
      )
      .run(
        PROJECT,
        VAULT,
        ASSET,
        freeMinor,
        freeMinor,
        new Date(clock).toISOString(),
        new Date(clock).toISOString(),
      );
  fund("2000000");
  // Runs before the next write batch, after the handler read the case.
  let beforeBatch: (() => void) | null = null;
  const securityDb = db as unknown as SecurityD1Database;
  let statements = 0;
  const wrapped: SecurityD1Database = {
    prepare: (sql) => {
      statements += 1;
      return securityDb.prepare(sql);
    },
    batch: async (statements) => {
      const hook = beforeBatch;
      beforeBatch = null;
      hook?.();
      return securityDb.batch(statements);
    },
  };
  // GitHub: private reporting readiness and the repository's private reports.
  let intake: "enabled" | "disabled" | "forbidden" = "enabled";
  const reports: GithubPrivateReport[] = [];
  let reportsAvailable = true;
  const advisories: AdvisoryReader = {
    privateReports: async (repository) =>
      reportsAvailable && repository === REPOSITORY
        ? { state: "ok", reports: [...reports] }
        : { state: "unavailable" },
    privateReport: async (_repository, ghsa) => {
      const found = reports.find((entry) => entry.ghsa === ghsa);
      return found && reportsAvailable
        ? { state: "found", report: found }
        : { state: "unavailable" };
    },
  };
  const analyzed: SecurityAnalysisInput[] = [];
  const appealInputs: SecurityAppealInput[] = [];
  let analyzerFails = false;
  let analyzerConfigured = true;
  const analyzer: SecurityAnalyzer = {
    provider: "fixture",
    model: "fixture-model",
    triageAppeal: async (input) => {
      appealInputs.push(input);
      return {
        proposedOutcome: "return",
        rationale: "Review the receipt-time scope.",
        confidence: 0.95,
      };
    },
    analyze: async (input) => {
      analyzed.push(input);
      if (analyzerFails) throw new Error("provider down");
      return {
        summary: "Rounding lets a depositor withdraw more than deposited.",
        severity: "critical",
        potentialLoss: "likely",
        duplicateCaseIds: input.priorCases.map((entry) => entry.id),
        rootCauseKey: "vault-share-rounding",
        remediation: "Round shares down on withdrawal.",
      };
    },
  };
  const call = async (
    as: Account,
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
        now: () => new Date(clock),
        randomId: () => {
          ids += 1;
          return `case${String(ids).padStart(8, "0")}`;
        },
        sessionActor: async () => actor,
        reportingRead: async (target) =>
          intake === "forbidden"
            ? { kind: "unavailable" }
            : {
                kind: "verified",
                enabled: intake === "enabled",
                repositoryId: target.repositoryId!,
                repositoryNodeId: target.repositoryNodeId!,
              },
        advisories,
        analyzer: analyzerConfigured ? analyzer : null,
        moderatorGithubIds: MODERATORS,
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
  // Inbox rows one account received for a case (NOT-01, SEC-09).
  const inbox = (account: Account, caseId: string) =>
    (
      sqlite
        .query(
          "SELECT event_key FROM notifications WHERE recipient_github_id = ? AND event_key LIKE ? ORDER BY event_key",
        )
        .all(account.githubId, `security-case:${caseId}:%`) as {
        event_key: string;
      }[]
    ).map((row) => row.event_key);
  const act = async (
    as: Account,
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
  /** GitHub received a report; the maintainer imports it into Slop. */
  const receive = async (author: Account, createdAt: string) => {
    const entry = report(author, createdAt);
    reports.push(entry);
    const imported = await call(MAINTAINER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(imported.body).toMatchObject({ state: "ok", received: 1 });
    const row = sqlite
      .query("SELECT id FROM security_cases WHERE advisory_ghsa = ?")
      .get(entry.ghsa) as { id: string };
    return row.id;
  };
  const decide = (
    id: string,
    rootCauseKey: string,
    fields: Record<string, unknown> = {},
  ) =>
    act(MAINTAINER, id, {
      action: "decide",
      outcome: "confirmed",
      severity: "critical",
      loss: "verified-potential",
      inScope: true,
      reason: "Reproduced on an isolated local fork.",
      relatedParty: false,
      rootCauseKey,
      ...fields,
    });
  const award = (id: string, grossMinor: string, as: Account = MAINTAINER) =>
    act(as, id, {
      action: "award",
      decision: "amount",
      grossMinor,
      paymentDeadline: "2026-11-30T00:00:00.000Z",
      confirmation: true,
      reason: "Owner award for a confirmed vault finding.",
    });
  const reservations = () =>
    sqlite
      .query(
        "SELECT case_id, gross_minor FROM security_award_reservations ORDER BY case_id",
      )
      .all() as { case_id: string; gross_minor: string }[];
  const ban = (account: Account) =>
    seedParticipationBan(sqlite, account, DISPUTE, REVISION_AT);
  let enforcementSequence = 0;
  const restrictProgram = (
    action: "quarantine" | "ban" = "quarantine",
    applied = false,
  ) => {
    enforcementSequence += 1;
    const before = sqlite
      .query(
        "SELECT revision, manifest_sha256, manifest FROM projects WHERE id = ?",
      )
      .get(PROJECT) as {
      revision: number;
      manifest_sha256: string;
      manifest: string;
    };
    if (applied) retireProgram();
    const after = applied
      ? (sqlite
          .query("SELECT revision, manifest_sha256 FROM projects WHERE id = ?")
          .get(PROJECT) as { revision: number; manifest_sha256: string })
      : null;
    const result = applied
      ? "revision_appended"
      : JSON.parse(before.manifest).listingTier === "retired"
        ? "no_revision_needed"
        : "revision_pending";
    sqlite
      .query(
        `INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
        VALUES (?,?,?, ?, ?, 'none','Synthetic program restriction','private-fixture','123','["example/bounty"]',?,?,NULL,'project-moderator','admin-panel',?,?,?,?,?,?)`,
      )
      .run(
        `enf_${PROJECT}_${enforcementSequence}`,
        PROJECT,
        enforcementSequence,
        action,
        action === "ban" ? "banned" : "quarantined",
        DISPUTE.githubId,
        DISPUTE.githubLogin,
        before.revision,
        before.manifest_sha256,
        after?.revision ?? null,
        after?.manifest_sha256 ?? null,
        result,
        REVISION_AT,
      );
  };
  const reinstateProgram = () => {
    enforcementSequence += 1;
    sqlite
      .query(
        `INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
        VALUES (?,?,?,'reinstate','clear','granted','Synthetic program reinstatement','private-fixture','123','["example/bounty"]',?,?,NULL,'project-moderator','admin-panel',1,?,NULL,NULL,'no_revision_needed',?)`,
      )
      .run(
        `enf_${PROJECT}_${enforcementSequence}`,
        PROJECT,
        enforcementSequence,
        DISPUTE_2.githubId,
        DISPUTE_2.githubLogin,
        digest,
        REVISION_AT,
      );
  };
  const retireProgram = () => {
    const retired = programManifest(securityBounty, "retired");
    const retiredDigest = createHash("sha256").update(retired).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 2, ?, ?, 'Retire program', ?)",
      )
      .run(PROJECT, retired, retiredDigest, REVISION_AT);
    sqlite
      .query(
        "UPDATE projects SET status = 'paused', revision = 2, manifest = ?, manifest_sha256 = ?, updated_at = ? WHERE id = ?",
      )
      .run(retired, retiredDigest, REVISION_AT, PROJECT);
  };
  /** A link from before automatic receipt, as the old claim flow stored it. */
  const claim = (id: string, ghsa: string, account: Account) =>
    sqlite
      .query(
        "INSERT INTO security_cases (id, project_id, advisory_repository, advisory_ghsa, reporter_github_id, reporter_github_login, submission_state, receipt_state, remediation_state, award_state, payment_state, disclosure_state, recognition, appeal_state, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'claimed', 'received', 'not-started', 'not-applicable', 'not-applicable', 'embargoed', 'private', 'none', 1, ?, ?)",
      )
      .run(
        id,
        PROJECT,
        REPOSITORY,
        ghsa,
        account.githubId,
        account.githubLogin,
        REVISION_AT,
        REVISION_AT,
      );
  const checkPvr = () =>
    pvrState(
      {
        db: wrapped,
        now: () => new Date(clock),
        reportingRead: async (target) =>
          intake === "forbidden"
            ? { kind: "unavailable" }
            : {
                kind: "verified",
                enabled: intake === "enabled",
                repositoryId: target.repositoryId ?? "123",
                repositoryNodeId: target.repositoryNodeId ?? "R_kgDO123",
              },
      },
      PROJECT,
    );
  return {
    db,
    ban,
    restrictProgram,
    reinstateProgram,
    retireProgram,
    claim,
    checkPvr,
    sqlite,
    fund,
    call,
    statements: () => statements,
    resetStatements: () => {
      statements = 0;
    },
    key,
    act,
    receive,
    decide,
    award,
    inbox,
    reports,
    analyzed,
    appealInputs,
    reservations,
    setIntake: (state: typeof intake) => {
      intake = state;
    },
    setReportsAvailable: (available: boolean) => {
      reportsAvailable = available;
    },
    setAnalyzerFails: (fails: boolean) => {
      analyzerFails = fails;
    },
    setAnalyzerConfigured: (configured: boolean) => {
      analyzerConfigured = configured;
    },
    advance: (ms: number) => {
      clock += ms;
    },
    setBeforeBatch: (hook: () => void) => {
      beforeBatch = hook;
    },
  };
}

describe("automatic private intake", () => {
  test("only a maintainer can verify or reject a claimed private report", async () => {
    const env = open();
    env.setAnalyzerConfigured(false);
    const verifiedId = "sc_manualverify";
    const rejectedId = "sc_manualreject";
    env.claim(verifiedId, "GHSA-2c3f-4g5h-6j7m", REPORTER);
    env.claim(rejectedId, "GHSA-3c4f-5g6h-7j8m", REPORTER);
    const verification = {
      action: "verify-link",
      confirmation: true,
      receivedAt: "2026-10-19T09:10:00.000Z",
    };
    expect((await env.decide(verifiedId, "unverified-report")).body.error).toBe(
      "not_verified",
    );
    const request = {
      ...verification,
      expectedRevision: 1,
      idempotencyKey: env.key(),
    };
    const verified = await env.call(
      MAINTAINER,
      "POST",
      `security-cases/${verifiedId}/actions`,
      request,
    );
    expect(verified.status).toBe(200);
    expect(verified.body.case).toMatchObject({
      revision: 2,
      submissionState: "verified",
      receivedAt: verification.receivedAt,
      receivedAtSource: "maintainer-attested",
      awardState: "pending",
    });
    const replay = await env.call(
      MAINTAINER,
      "POST",
      `security-cases/${verifiedId}/actions`,
      request,
    );
    expect(replay.body).toMatchObject({
      replayed: true,
      case: { revision: 2 },
    });
    expect(
      (await env.act(MAINTAINER, verifiedId, verification)).body.error,
    ).toBe("action_not_allowed");

    expect((await env.act(REPORTER, rejectedId, verification)).status).toBe(
      403,
    );
    expect(
      (
        await env.act(REPORTER, rejectedId, {
          action: "reject-link",
          reason: "This report is not from the claimed reporter.",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await env.act(MAINTAINER, rejectedId, {
          ...verification,
          confirmation: false,
        })
      ).body.error,
    ).toBe("confirmation_required");

    const rejected = await env.act(MAINTAINER, rejectedId, {
      action: "reject-link",
      reason: "This report is not from the claimed reporter.",
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.case).toMatchObject({
      revision: 2,
      submissionState: "link-rejected",
    });
    expect(
      (await env.act(MAINTAINER, rejectedId, verification)).body.error,
    ).toBe("action_not_allowed");
    expect(env.reservations()).toEqual([]);
    env.sqlite.close();
  });

  // Reporter submission, OAuth and uncertain-send recovery are exercised
  // by submissions.test.ts against the canonical automatic intake route.
  test("a maintainer imports direct GitHub reports and settles older links", async () => {
    const env = open();
    const linked = report(REPORTER, "2026-10-19T09:10:00.000Z");
    const wrongAuthor = report(REPORTER, "2026-10-19T09:20:00.000Z");
    const direct = report(OTHER, "2026-10-19T09:30:00.000Z");
    env.claim("sc_legacyclaim1", linked.ghsa, REPORTER);
    env.claim("sc_legacyclaim2", wrongAuthor.ghsa, OTHER);
    env.claim("sc_legacyclaim3", "GHSA-9c9f-9g9h-9j9m", REPORTER);
    env.reports.push(linked, wrongAuthor, direct);
    const notMaintainer = await env.call(TRIAGER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(notMaintainer.status).toBe(403);
    env.setReportsAvailable(false);
    expect(
      (
        await env.call(MAINTAINER, "POST", "security-cases", {
          mode: "import",
          projectId: PROJECT,
        })
      ).body,
    ).toMatchObject({ state: "unavailable", received: 0 });
    expect(
      env.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM security_cases WHERE submission_state = 'claimed'",
        )
        .get(),
    ).toEqual({ n: 3 });
    env.setReportsAvailable(true);
    const imported = await env.call(MAINTAINER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(imported.body).toMatchObject({ state: "ok", received: 3 });
    const rows = env.sqlite
      .query(
        "SELECT id, advisory_ghsa, reporter_github_id, submission_state, received_at, received_at_source, revision FROM security_cases ORDER BY created_at, id",
      )
      .all() as Record<string, unknown>[];
    // The older link by the true author became that case.
    expect(rows.find((row) => row.id === "sc_legacyclaim1")).toMatchObject({
      submission_state: "verified",
      received_at: linked.createdAt,
      received_at_source: "github-verified",
      revision: 2,
    });
    // GitHub names someone else, or no such private report exists.
    for (const id of ["sc_legacyclaim2", "sc_legacyclaim3"])
      expect(rows.find((row) => row.id === id)).toMatchObject({
        submission_state: "link-rejected",
        revision: 2,
      });
    for (const entry of [wrongAuthor, direct])
      expect(
        rows.find(
          (row) =>
            row.advisory_ghsa === entry.ghsa &&
            row.submission_state === "verified",
        ),
      ).toMatchObject({ reporter_github_id: entry.author.githubId });
    expect(
      env.sqlite
        .query(
          "SELECT kind FROM security_case_events WHERE case_id = 'sc_legacyclaim3'",
        )
        .all(),
    ).toEqual([{ kind: "receipt-mismatch" }]);
    // Importing again records nothing twice.
    expect(
      (
        await env.call(MAINTAINER, "POST", "security-cases", {
          mode: "import",
          projectId: PROJECT,
        })
      ).body,
    ).toMatchObject({ state: "ok", received: 0 });
    // Each new case got its private analysis; later ones compared earlier.
    expect(env.analyzed).toHaveLength(3);
    expect(env.analyzed[2].priorCases.map((entry) => entry.id)).toHaveLength(2);
  });

  test("listing cases records only the cases disclosed and refuses an unaudited response", async () => {
    const env = open();
    const first = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const second = await env.receive(REPORTER, "2026-10-19T09:20:00.000Z");
    const reads = () =>
      env.sqlite
        .query(
          "SELECT case_id, actor_github_id, actor_role FROM security_case_access_log WHERE action = 'read' ORDER BY case_id",
        )
        .all();
    const listed = await env.call(REPORTER, "GET", "security-cases");
    expect(listed.status).toBe(200);
    expect(listed.body.cases).toHaveLength(2);
    expect(reads()).toEqual(
      [first, second].sort().map((id) => ({
        case_id: id,
        actor_github_id: REPORTER.githubId,
        actor_role: "reporter",
      })),
    );
    const outsider = await env.call(TRIAGER, "GET", "security-cases");
    expect(outsider.status).toBe(200);
    expect(reads()).toHaveLength(2);
    env.sqlite.exec(
      "CREATE TRIGGER refuse_access_read BEFORE INSERT ON security_case_access_log BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
    );
    const unavailable = await env.call(REPORTER, "GET", "security-cases");
    expect(unavailable.status).toBe(500);
    expect(unavailable.body).not.toHaveProperty("cases");
    expect(reads()).toHaveLength(2);
  });

  test("listing dozens of cases stays inside the browser deadline when each read is slow", async () => {
    const env = open();
    const ids: string[] = [];
    for (let i = 0; i < 24; i++) {
      ids.push(
        await env.receive(
          REPORTER,
          `2026-10-19T09:${String(10 + i).padStart(2, "0")}:00.000Z`,
        ),
      );
      env.advance(60_000);
    }
    // Production D1 answers every statement over the network. A few
    // milliseconds per read turns a sequential walk over the viewer's cases
    // into seconds; the browser abandons the list after 15 seconds.
    const DELAY_MS = 4;
    type Statement = ReturnType<SecurityD1Database["prepare"]>;
    const wait = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    const raw = new WeakMap<Statement, Statement>();
    const slowStatement = (statement: Statement): Statement => {
      const wrapped: Statement = {
        bind: (...values: unknown[]) =>
          slowStatement(statement.bind(...values)),
        first: async <T>() => {
          await wait();
          return statement.first<T>();
        },
        all: async <T>() => {
          await wait();
          return statement.all<T>();
        },
        run: async () => {
          await wait();
          return statement.run();
        },
      };
      raw.set(wrapped, statement);
      return wrapped;
    };
    let projectReads = 0;
    const slow: SecurityD1Database = {
      prepare: (sql) => {
        if (sql === "SELECT manifest, revision FROM projects WHERE id = ?")
          projectReads++;
        return slowStatement(env.db.prepare(sql));
      },
      batch: (statements) =>
        env.db.batch(statements.map((entry) => raw.get(entry) ?? entry)),
    };
    const started = performance.now();
    const response = await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/security-cases`),
      {
        db: slow,
        now: () => new Date("2026-10-19T10:00:00.000Z"),
        randomId: () => "unused",
        sessionActor: async () => REPORTER,
        reportingRead: async () => ({ kind: "unavailable" }),
        moderatorGithubIds: MODERATORS,
      },
    );
    const elapsed = performance.now() - started;
    expect(projectReads).toBe(1);
    expect(response?.status).toBe(200);
    const body = (await response?.json()) as Reply;
    expect(body.cases?.map((entry) => entry.id)).toEqual([...ids].reverse());
    // Sequential: 24 cases x several reads x 4 ms is well over a second.
    expect(Math.round(elapsed)).toBeLessThan(250);
    expect(
      env.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM security_case_access_log WHERE action = 'read' AND actor_github_id = ?",
        )
        .get(REPORTER.githubId),
    ).toEqual({ n: 24 });
    env.sqlite.close();
  });

  test("a failed or missing analysis can be run again by the owner", async () => {
    const env = open();
    env.setAnalyzerConfigured(false);
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const read = () => env.call(MAINTAINER, "GET", `security-cases/${id}`);
    expect((await read()).body.case.analysis).toMatchObject({
      state: "unavailable",
      retryable: true,
    });
    expect((await read()).body.case.allowedActions).toContain("analyze");
    // The reporter cannot run it.
    expect((await env.act(REPORTER, id, { action: "analyze" })).status).toBe(
      409,
    );
    env.setAnalyzerConfigured(true);
    env.setAnalyzerFails(true);
    const failed = await env.act(MAINTAINER, id, { action: "analyze" });
    expect(failed.status).toBe(200);
    expect(failed.body.case.analysis).toMatchObject({
      state: "failed",
      retryable: true,
    });
    env.setAnalyzerFails(false);
    const complete = await env.act(MAINTAINER, id, { action: "analyze" });
    expect(complete.body.case.analysis).toMatchObject({
      state: "complete",
      retryable: false,
    });
    const again = await env.act(MAINTAINER, id, { action: "analyze" });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("analysis_running");
  });

  test("a stale triager change grants or revokes nothing", async () => {
    const env = open();
    const { call, key, sqlite, setBeforeBatch, inbox } = env;
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    // Another maintainer moves the case two revisions ahead while this
    // request is in flight, so its event guard skips instead of colliding.
    const advance = (revisions: number[]) => () => {
      for (const revision of revisions) {
        sqlite
          .query(
            "UPDATE security_cases SET revision = ?, updated_at = ? WHERE id = ?",
          )
          .run(revision, REVISION_AT, id);
        sqlite
          .query(
            "INSERT INTO security_case_events (case_id, case_revision, kind, actor_github_id, actor_role, idempotency_key, detail, at) VALUES (?, ?, 'remediation', ?, 'security-maintainer', ?, '{}', ?)",
          )
          .run(id, revision, MAINTAINER.githubId, key(), REVISION_AT);
      }
    };
    const members = () =>
      sqlite
        .query(
          "SELECT github_id, revoked_at FROM security_case_members WHERE case_id = ?",
        )
        .all(id) as { github_id: string; revoked_at: string | null }[];
    setBeforeBatch(advance([2, 3]));
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
    expect(inbox(TRIAGER, id)).toEqual([]);
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
    expect(inbox(TRIAGER, id)).toEqual([`security-case:${id}:4`]);
    setBeforeBatch(advance([5, 6]));
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
  });
});

describe("discretionary awards", () => {
  test("a banned researcher keeps funded awards and appeals but receives no new bounty award", async () => {
    const env = open();
    const funded = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(funded, "funded-root");
    expect((await env.award(funded, "1000000")).status).toBe(200);
    const pending = await env.receive(REPORTER, "2026-10-19T09:20:00.000Z");
    await env.decide(pending, "pending-root");
    env.ban(REPORTER);
    const refused = await env.award(pending, "1000000");
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("participation_banned");
    expect(env.reservations()).toEqual([
      { case_id: funded, gross_minor: "1000000" },
    ]);
    const existing = await env.call(
      REPORTER,
      "GET",
      `security-cases/${funded}`,
    );
    expect(existing.status).toBe(200);
    expect(existing.body.case.award?.researcherMinor).toBe("750000");
    expect(
      (
        await env.act(MAINTAINER, pending, {
          action: "award",
          decision: "none",
          reason: "Account ban prevents a new award",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await env.act(REPORTER, pending, {
          action: "appeal",
          reason: "Please review this ban",
        })
      ).status,
    ).toBe(200);
  });

  for (const relatedParty of [false, true])
    for (const racing of [false, true])
      test(`a banned maintainer cannot create a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => {
        const env = open();
        const pending = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
        await env.decide(pending, "maintainer-ban-root", { relatedParty });
        if (racing) env.setBeforeBatch(() => env.ban(MAINTAINER));
        else env.ban(MAINTAINER);
        const result = await env.award(pending, "1000000");
        expect(result.status).toBe(racing ? 409 : 403);
        expect(env.reservations()).toEqual([]);
      });

  test("a ban that arrives during bounty approval prevents its reservation", async () => {
    const env = open();
    const pending = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(pending, "racing-root");
    env.setBeforeBatch(() => env.ban(REPORTER));
    expect((await env.award(pending, "1000000")).status).toBe(409);
    expect(env.reservations()).toEqual([]);
  });

  test("large program balances keep every minor unit after approved awards", async () => {
    const env = open({
      ...OPEN_PROGRAM,
      amount: { ...OPEN_PROGRAM.amount, grossMinor: "1000000000000000" },
      capacity: { awards: 40, closesAt: null },
    });
    env.fund("40000000000000000");
    let last = "";
    for (let i = 0; i < 37; i += 1) {
      last = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
      expect((await env.decide(last, `large-finding-${i}`)).status).toBe(200);
      expect((await env.award(last, "999999999999996")).status).toBe(200);
    }
    const view = await env.call(MAINTAINER, "GET", `security-cases/${last}`);
    expect(view.body.case.awardFunds?.availableMinor).toBe("3000000000000148");
    env.sqlite.close();
  });

  test("the owner chooses the amount, and approval reserves exactly that amount", async () => {
    const env = open();
    const first = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const second = await env.receive(REPORTER, "2026-10-19T09:20:00.000Z");
    // A high-severity finding with unverified loss is not barred: severity
    // and loss are priority guidance, not eligibility.
    const decided = await env.decide(first, "vault-drain", {
      severity: "high",
      loss: "not-verified",
    });
    expect(decided.status).toBe(200);
    expect(decided.body.case).toMatchObject({
      awardState: "pending",
      nextStep: "Choose an award amount or no award.",
    });
    expect(decided.body.case.allowedActions).toContain("award");
    // Nothing is reserved by a technical decision.
    expect(env.reservations()).toEqual([]);
    const inexact = await env.award(first, "1000002");
    expect(inexact.status).toBe(400);
    expect(inexact.body.error).toBe("invalid_amount");
    // Only the owner decides awards; finance cannot even see the case yet,
    // and the reporter cannot award their own report.
    expect(
      (
        await env.call(FINANCE, "POST", `security-cases/${first}/actions`, {
          action: "award",
          expectedRevision: 2,
          idempotencyKey: env.key(),
          decision: "amount",
          grossMinor: "1500000",
          paymentDeadline: "2026-11-30T00:00:00.000Z",
          confirmation: true,
          reason: "Finance trying to award directly.",
        })
      ).status,
    ).toBe(404);
    expect((await env.award(first, "1500000", REPORTER)).status).toBe(403);
    const approved = await env.award(first, "1500000");
    expect(approved.status).toBe(200);
    expect(approved.body.case).toMatchObject({
      awardState: "approved",
      award: {
        grossMinor: "1500000",
        researcherMinor: "1125000",
        slopMinor: "375000",
      },
    });
    expect(env.reservations()).toEqual([
      { case_id: first, gross_minor: "1500000" },
    ]);
    // Both finance approvers learn of the approved award.
    for (const payer of [FINANCE, FINANCE_2])
      expect(env.inbox(payer, first)).toEqual([`security-case:${first}:3`]);
    // The second finding decides and awards in one step; 500,000 remains.
    const tooMuch = await env.decide(second, "oracle-skew", {
      award: {
        decision: "amount",
        grossMinor: "600000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
      },
    });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toBe("insufficient_funds");
    const unchanged = await env.call(
      MAINTAINER,
      "GET",
      `security-cases/${second}`,
    );
    expect(unchanged.body.case).toMatchObject({
      revision: 1,
      receiptState: "received",
    });
    expect(unchanged.body.case.awardFunds).toMatchObject({
      availableMinor: "500000",
    });
    const fits = await env.decide(second, "oracle-skew", {
      award: {
        decision: "amount",
        grossMinor: "500000",
        paymentDeadline: "2026-11-30T00:00:00.000Z",
        confirmation: true,
      },
    });
    expect(fits.status).toBe(200);
    expect(fits.body.case.awardState).toBe("approved");
    // A reserved obligation cannot be redecided or withdrawn.
    expect(
      (
        await env.act(MAINTAINER, first, {
          action: "award",
          decision: "none",
          reason: "Changing my mind after approval.",
        })
      ).status,
    ).toBe(409);
  });

  test("no award is a decision the reporter can appeal", async () => {
    const env = open();
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(id, "vault-drain");
    const none = await env.act(MAINTAINER, id, {
      action: "award",
      decision: "none",
      reason: "Already known and mitigated before the report.",
    });
    expect(none.status).toBe(200);
    expect(none.body.case.awardState).toBe("ineligible");
    expect(env.reservations()).toEqual([]);
    const reporter = await env.call(REPORTER, "GET", `security-cases/${id}`);
    expect(reporter.body.case.allowedActions).toContain("appeal");
    const appealed = await env.act(REPORTER, id, {
      action: "appeal",
      reason: "The mitigation did not cover the path I reported.",
    });
    expect(appealed.body.case.appealState).toBe("open");
    for (const reviewer of [DISPUTE, DISPUTE_2])
      expect(env.inbox(reviewer, id)).toEqual([`security-case:${id}:4`]);
    // A returned appeal reopens the award decision.
    const returned = await env.act(DISPUTE, id, {
      action: "decide-appeal",
      outcome: "return",
      reason: "Decide the award again with the new evidence.",
    });
    expect(returned.body.case).toMatchObject({
      receiptState: "triaging",
      awardState: "pending",
    });
  });

  test("a concurrent reservation cannot overspend the program", async () => {
    const env = open();
    const first = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const second = await env.receive(REPORTER, "2026-10-19T09:20:00.000Z");
    await env.decide(first, "vault-drain");
    await env.decide(second, "oracle-skew");
    // Another owner request reserves 1,500,000 after this request read the
    // available funds and before its batch commits.
    env.setBeforeBatch(() => {
      env.sqlite
        .query(
          "INSERT INTO security_award_reservations (case_id, project_id, root_cause_key, policy_revision, gross_minor, currency, reserved_at) VALUES (?, ?, 'oracle-skew', 1, '1500000', 'USDC', ?)",
        )
        .run(second, PROJECT, REVISION_AT);
    });
    const raced = await env.award(first, "1000000");
    expect(raced.status).toBe(409);
    expect(raced.body.error).toBe("insufficient_funds");
    expect(env.reservations()).toEqual([
      { case_id: second, gross_minor: "1500000" },
    ]);
    expect(
      env.sqlite
        .query("SELECT award_state, revision FROM security_cases WHERE id = ?")
        .get(first),
    ).toEqual({ award_state: "pending", revision: 2 });
    // The same root cause never reserves twice.
    const third = await env.receive(REPORTER, "2026-10-19T09:30:00.000Z");
    const duplicate = await env.decide(third, "oracle-skew");
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toBe("root_cause_reserved");
    expect(
      (
        await env.decide(third, "oracle-skew", {
          outcome: "duplicate",
          duplicateOf: second,
        })
      ).body.case.awardState,
    ).toBe("ineligible");
  });

  test("reservations follow the vault's finalized free balance, not the published terms", async () => {
    // Published terms promise 2 x 1,000,000; the vault holds 1,200,000.
    const env = open();
    env.fund("1200000");
    const first = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const second = await env.receive(REPORTER, "2026-10-19T09:20:00.000Z");
    await env.decide(first, "vault-drain");
    await env.decide(second, "oracle-skew");
    // The scanner refreshes the balance after the read and before the write.
    env.setBeforeBatch(() => env.fund("0"));
    const changed = await env.award(first, "1000000");
    expect(changed.status).toBe(409);
    expect(changed.body.error).toBe("insufficient_funds");
    expect(env.reservations()).toEqual([]);
    env.fund("1200000");
    expect((await env.award(first, "1000000")).status).toBe(200);
    expect((await env.award(second, "1000000")).body.error).toBe(
      "insufficient_funds",
    );
    // The owner commits the first award on chain. Once a newer finalized
    // snapshot shows the vault without it, it no longer counts twice.
    env.sqlite
      .query(
        `INSERT INTO security_settlements (case_id, obligation_id, source_digest, network, vault, asset, asset_decimals, gross_base, fee_base, reporter_github_id, approved_by, approved_at, case_revision, deployment) VALUES (?, 'obligation-1', ?, 'base-sepolia', ?, ?, 6, '1000000', '250000', ?, ?, ?, 3, '{}')`,
      )
      .run(
        first,
        "c".repeat(64),
        VAULT,
        ASSET,
        REPORTER.githubId,
        MAINTAINER.githubId,
        REVISION_AT,
      );
    env.sqlite
      .query(
        `INSERT INTO security_payment_obligations (id, project_id, github_user_id, network, chain, vault, asset_address, asset_decimals, gross_base, fee_base, source_digest, state, created_at) VALUES ('obligation-1', ?, ?, 'base-sepolia', 'base', ?, ?, 6, '1000000', '250000', ?, 'reserved', ?)`,
      )
      .run(
        PROJECT,
        REPORTER.githubId,
        VAULT,
        ASSET,
        "c".repeat(64),
        "2026-10-19T10:00:00.000Z",
      );
    env.advance(60_000);
    env.fund("200000");
    const read = await env.call(MAINTAINER, "GET", `security-cases/${second}`);
    expect(read.body.case.awardFunds).toMatchObject({
      availableMinor: "200000",
    });
    // A deposit raises the free balance; a stale snapshot proves nothing.
    env.fund("1200000");
    env.advance(31 * 60_000);
    expect((await env.award(second, "1000000")).body.error).toBe(
      "funds_unavailable",
    );
    env.fund("1200000");
    expect((await env.award(second, "1000000")).status).toBe(200);
    env.sqlite.close();
  });

  test("a pledge reserves nothing", async () => {
    const env = open({ ...OPEN_PROGRAM, funding: { state: "pledged" } });
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(id, "vault-drain");
    const refused = await env.award(id, "1000000");
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("funds_unavailable");
    expect(env.reservations()).toEqual([]);
  });

  test("an award reserved before discretionary awards is approved at its amount", async () => {
    const env = open();
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(id, "vault-drain");
    // The older flow reserved the program amount at the technical decision.
    env.sqlite
      .query(
        "INSERT INTO security_award_reservations (case_id, project_id, root_cause_key, policy_revision, gross_minor, currency, reserved_at) VALUES (?, ?, 'vault-drain', 1, '1000000', 'USD', ?)",
      )
      .run(id, PROJECT, REVISION_AT);
    env.sqlite
      .query("UPDATE security_cases SET award_state = 'reserved' WHERE id = ?")
      .run(id);
    expect((await env.award(id, "800000")).body.error).toBe(
      "award_obligation_exists",
    );
    env.ban(MAINTAINER);
    const approved = await env.award(id, "1000000");
    expect(approved.status).toBe(200);
    expect(approved.body.case.awardState).toBe("approved");
    expect(env.reservations()).toEqual([
      { case_id: id, gross_minor: "1000000" },
    ]);
  });
});

describe("related-party awards", () => {
  test("a proposed related-party award reserves only after independent approval", async () => {
    const env = open();
    const related = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const sameCause = await env.receive(OTHER, "2026-10-19T09:20:00.000Z");
    await env.decide(related, "shared-cause", { relatedParty: true });
    const proposed = await env.award(related, "800000");
    expect(proposed.status).toBe(200);
    expect(proposed.body.case).toMatchObject({
      awardState: "pending",
      award: { grossMinor: "800000" },
    });
    expect(env.reservations()).toEqual([]);
    // The dispute reviewers learn that a review waits; finance learns
    // nothing before an award is approved.
    for (const reviewer of [DISPUTE, DISPUTE_2])
      expect(env.inbox(reviewer, related)).toEqual([
        `security-case:${related}:3`,
      ]);
    expect(env.inbox(FINANCE, related)).toEqual([]);
    // The pending review holds its root cause.
    expect((await env.decide(sameCause, "shared-cause")).body.error).toBe(
      "root_cause_reserved",
    );
    const approved = await env.act(DISPUTE, related, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Approved after independent review.",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.case.awardState).toBe("approved");
    expect(env.reservations()).toEqual([
      { case_id: related, gross_minor: "800000" },
    ]);
    expect(env.inbox(FINANCE, related)).toEqual([`security-case:${related}:4`]);
    // The reviewer is never notified of its own action.
    expect(env.inbox(DISPUTE, related)).toEqual([`security-case:${related}:3`]);
  });

  test("an appealed related-party refusal cannot be re-reviewed by the same reviewers", async () => {
    const env = open();
    const { act } = env;
    const related = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const propose = async () => {
      expect(
        (await env.decide(related, "insider-cause", { relatedParty: false }))
          .status,
      ).toBe(200);
      return env.award(related, "800000");
    };
    await env.decide(related, "insider-cause", { relatedParty: true });
    expect((await env.award(related, "800000")).body.case.awardState).toBe(
      "pending",
    );
    const refuse = (reviewer: Account) =>
      act(reviewer, related, {
        action: "decide-related-party",
        outcome: "refuse",
        reason: "Refused after independent review.",
      });
    const appealAndReturn = async (reviewer: Account) => {
      expect(
        (
          await act(REPORTER, related, {
            action: "appeal",
            reason: "The related-party refusal used the wrong facts.",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await act(reviewer, related, {
            action: "decide-appeal",
            outcome: "return",
            reason: "Return for a new decision.",
          })
        ).status,
      ).toBe(200);
    };
    expect((await refuse(DISPUTE)).body.case.awardState).toBe("ineligible");
    await appealAndReturn(DISPUTE_2);
    // A redecision that declares no related party still needs a review.
    expect((await propose()).body.case.awardState).toBe("pending");
    expect(
      env.sqlite
        .query(
          "SELECT related_party, related_party_review, related_party_reviewer_github_id FROM security_cases WHERE id = ?",
        )
        .get(related),
    ).toEqual({
      related_party: "related",
      related_party_review: "pending",
      related_party_reviewer_github_id: DISPUTE.githubId,
    });
    for (const prior of [DISPUTE, DISPUTE_2]) {
      const reused = await act(prior, related, {
        action: "decide-related-party",
        outcome: "approve",
        reason: "Approved after independent review.",
      });
      expect(reused.status).toBe(403);
      expect(reused.body.error).toBe("conflicted");
    }
    expect((await refuse(DISPUTE_3)).body.case.awardState).toBe("ineligible");
    expect(
      (
        await act(REPORTER, related, {
          action: "appeal",
          reason: "The related-party refusal used the wrong facts.",
        })
      ).status,
    ).toBe(200);
    // Earlier related-party and appeal reviewers stay conflicted on a later
    // appeal even after related_party_reviewer_github_id was overwritten.
    for (const prior of [DISPUTE, DISPUTE_2, DISPUTE_3]) {
      const reused = await act(prior, related, {
        action: "decide-appeal",
        outcome: "uphold",
        reason: "Trying to decide a later appeal on the same case.",
      });
      expect(reused.status).toBe(403);
      expect(reused.body.error).toBe("conflicted");
    }
    expect(
      (
        await act(DISPUTE_4, related, {
          action: "decide-appeal",
          outcome: "return",
          reason: "Return for a new decision.",
        })
      ).status,
    ).toBe(200);
    expect((await propose()).body.case.awardState).toBe("pending");
    for (const prior of [DISPUTE, DISPUTE_2, DISPUTE_3, DISPUTE_4]) {
      const reused = await act(prior, related, {
        action: "decide-related-party",
        outcome: "approve",
        reason: "Approved after independent review.",
      });
      expect(reused.status).toBe(403);
    }
    const approved = await act(DISPUTE_5, related, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Approved after independent review.",
    });
    expect(approved.status).toBe(200);
    expect(approved.body.case.awardState).toBe("approved");
  });

  test("a co-maintainer who decides an award or an earlier technical decision cannot review the case as dispute", async () => {
    const env = open({
      ...OPEN_PROGRAM,
      approvers: {
        ...OPEN_PROGRAM.approvers,
        technical: [MAINTAINER, DISPUTE],
      },
    });
    const separateAward = await env.receive(
      REPORTER,
      "2026-10-19T09:10:00.000Z",
    );
    await env.decide(separateAward, "award-decider-conflict", {
      relatedParty: true,
    });
    // DISPUTE proposes the related-party award after MAINTAINER confirmed the
    // finding, so technical_decider_github_id remains MAINTAINER.
    expect((await env.award(separateAward, "800000", DISPUTE)).status).toBe(
      200,
    );
    const selfApproved = await env.act(DISPUTE, separateAward, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Trying to approve my own related-party award proposal.",
    });
    expect(selfApproved.status).toBe(403);
    expect(selfApproved.body.error).toBe("conflicted");

    const withheldAward = await env.receive(OTHER, "2026-10-19T09:20:00.000Z");
    await env.decide(withheldAward, "withheld-award-conflict");
    expect(
      (
        await env.act(DISPUTE, withheldAward, {
          action: "award",
          decision: "none",
          reason: "Withholding award as a technical approver.",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await env.act(OTHER, withheldAward, {
          action: "appeal",
          reason: "Appealing the withheld award decision.",
        })
      ).status,
    ).toBe(200);
    const selfUpheld = await env.act(DISPUTE, withheldAward, {
      action: "decide-appeal",
      outcome: "uphold",
      reason: "Trying to uphold my own award refusal.",
    });
    expect(selfUpheld.status).toBe(403);
    expect(selfUpheld.body.error).toBe("conflicted");
  });
});

test("report analysis and appeal triage keep the scope recorded at receipt", async () => {
  const env = open();
  const changed = programManifest({
    ...OPEN_PROGRAM,
    scope: {
      includedAssets: ["A different asset added after the report"],
      severityRubric: "A later rubric",
      lossDefinition: "A later loss definition",
    },
  });
  const digest = createHash("sha256").update(changed).digest("hex");
  env.sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,2,?,?,'Later scope','2026-10-19T09:30:00.000Z')",
    )
    .run(PROJECT, changed, digest);
  env.sqlite
    .query(
      "UPDATE projects SET revision=2,manifest=?,manifest_sha256=?,updated_at='2026-10-19T09:30:00.000Z' WHERE id=?",
    )
    .run(changed, digest, PROJECT);
  const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
  expect(env.analyzed[0].scope).toEqual(OPEN_PROGRAM.scope);
  expect((await env.decide(id, "receipt-time-scope")).status).toBe(200);
  expect(
    (
      await env.act(MAINTAINER, id, {
        action: "award",
        decision: "none",
        reason: "Owner decision for review",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await env.act(REPORTER, id, {
        action: "appeal",
        reason: "Review the scope that applied at receipt",
      })
    ).status,
  ).toBe(200);
  expect(env.appealInputs).toHaveLength(1);
  expect(env.appealInputs[0].scope).toEqual(OPEN_PROGRAM.scope);
  await env.receive(OTHER, "2026-10-19T08:59:00.000Z");
  expect(env.analyzed[1].scope).toBeNull();
  env.sqlite.close();
});

describe("restricted programs", () => {
  test("a pending-revision quarantine blocks new awards but preserves reporting until reinstated", async () => {
    const env = open();
    const unrelated = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    const related = await env.receive(OTHER, "2026-10-19T09:20:00.000Z");
    await env.decide(unrelated, "unrelated-finding");
    await env.decide(related, "related-finding", { relatedParty: true });
    expect((await env.award(related, "800000")).status).toBe(200);
    expect(await env.checkPvr()).toBe("ready");
    expect(
      (await env.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .status,
    ).toBe(200);

    env.restrictProgram("quarantine");
    expect(await env.checkPvr()).toBe("ready");
    expect(
      (await env.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .status,
    ).toBe(200);
    expect(
      (
        await env.call(MAINTAINER, "POST", "security-cases", {
          mode: "import",
          projectId: PROJECT,
        })
      ).status,
    ).toBe(200);

    const refusedAward = await env.award(unrelated, "1000000");
    expect(refusedAward.status).toBe(409);
    expect(refusedAward.body.error).toBe("program_restricted");
    const refusedReview = await env.act(DISPUTE, related, {
      action: "decide-related-party",
      outcome: "approve",
      reason: "Trying to approve while the program is quarantined.",
    });
    expect(refusedReview.status).toBe(409);
    expect(refusedReview.body.error).toBe("program_restricted");
    expect(env.reservations()).toEqual([]);

    env.reinstateProgram();
    expect(await env.checkPvr()).toBe("ready");
    expect(
      (await env.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .status,
    ).toBe(200);
    expect((await env.award(unrelated, "1000000")).status).toBe(200);
    expect(
      (
        await env.act(DISPUTE, related, {
          action: "decide-related-party",
          outcome: "approve",
          reason: "Approved after program reinstatement.",
        })
      ).status,
    ).toBe(200);
    expect(env.reservations()).toEqual(
      [
        { case_id: unrelated, gross_minor: "1000000" },
        { case_id: related, gross_minor: "800000" },
      ].sort((a, b) => a.case_id.localeCompare(b.case_id)),
    );
    env.sqlite.close();
  });

  for (const relatedParty of [false, true])
    for (const racing of [false, true])
      test(`a restricted or retired program cannot start a new bounty award (race: ${racing}, related: ${relatedParty})`, async () => {
        const env = open();
        const pending = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
        await env.decide(pending, "program-restriction-root", { relatedParty });
        if (racing) env.setBeforeBatch(() => env.restrictProgram("ban"));
        else if (relatedParty) env.retireProgram();
        else env.restrictProgram("ban");
        const result = await env.award(pending, "1000000");
        expect(result.status).toBe(409);
        expect(result.body.error).toBe("program_restricted");
        expect(env.reservations()).toEqual([]);
        expect(env.inbox(DISPUTE, pending)).toEqual([]);
        expect(
          env.sqlite
            .query(
              "SELECT award_state, related_party_review, revision FROM security_cases WHERE id = ?",
            )
            .get(pending),
        ).toEqual({
          award_state: "pending",
          related_party_review: "not-applicable",
          revision: 2,
        });
        env.sqlite.close();
      });
});

describe("quarantined private cases", () => {
  test("private reporting remains available for a registered quarantined project", async () => {
    const env = open();
    expect(
      (await env.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .status,
    ).toBe(200);
    env.restrictProgram("quarantine");
    const result = await env.call(
      REPORTER,
      "GET",
      `security-programs/${PROJECT}/intake`,
    );
    expect(result.status).toBe(200);
  });
  test.each(["pending", "applied", "unproved"])(
    "existing appeal triage follows quarantine revision evidence: %s",
    async (revision) => {
      const env = open();
      const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
      await env.decide(id, "appeal-root");
      expect(
        (
          await env.act(MAINTAINER, id, {
            action: "award",
            decision: "none",
            reason: "Owner decision for review",
          })
        ).status,
      ).toBe(200);
      env.setAnalyzerConfigured(false);
      expect(
        (
          await env.act(REPORTER, id, {
            action: "appeal",
            reason:
              "Review the scope and decision that applied to this private report",
          })
        ).status,
      ).toBe(200);
      expect(
        env.sqlite
          .query("SELECT state FROM security_appeal_triages WHERE case_id = ?")
          .get(id),
      ).toEqual({ state: "unavailable" });
      env.setAnalyzerConfigured(true);
      // An applied quarantine retains its exact before/after revision evidence.
      env.restrictProgram("quarantine", revision === "applied");
      if (revision === "unproved") env.retireProgram();
      const result = await env.act(DISPUTE, id, { action: "triage-appeal" });
      expect(result.status).toBe(revision === "unproved" ? 404 : 200);
    },
  );
  test.each(["none", "quarantine", "ban"] as const)(
    "an owner retirement closes a failed appeal triage retry after %s",
    async (restriction) => {
      const env = open();
      const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
      await env.decide(id, "appeal-root");
      expect(
        (
          await env.act(MAINTAINER, id, {
            action: "award",
            decision: "none",
            reason: "Owner decision for review",
          })
        ).status,
      ).toBe(200);
      env.setAnalyzerConfigured(false);
      expect(
        (
          await env.act(REPORTER, id, {
            action: "appeal",
            reason:
              "Review the scope and decision that applied to this private report",
          })
        ).status,
      ).toBe(200);
      env.setAnalyzerConfigured(true);
      env.retireProgram();
      if (restriction !== "none") env.restrictProgram(restriction);
      const result = await env.act(DISPUTE, id, { action: "triage-appeal" });
      expect(result.status).toBe(404);
    },
  );
  test("a receipt check imports no new report after an applied quarantine", async () => {
    const env = open();
    const linked = report(REPORTER, "2026-10-19T09:10:00.000Z");
    env.claim("sc_legacyclaim1", linked.ghsa, REPORTER);
    env.restrictProgram("quarantine", true);
    env.reports.push(linked, report(OTHER, "2026-10-19T09:20:00.000Z"));
    for (const account of [MAINTAINER, REPORTER])
      expect(
        (await env.act(account, "sc_legacyclaim1", { action: "check-receipt" }))
          .status,
      ).toBe(404);
    expect(
      env.sqlite.query("SELECT id, submission_state FROM security_cases").all(),
    ).toEqual([{ id: "sc_legacyclaim1", submission_state: "claimed" }]);
    expect(env.analyzed).toEqual([]);
  });
  test("a previously funded award remains accessible while quarantined", async () => {
    const env = open();
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(id, "funded-root");
    expect((await env.award(id, "1000000")).status).toBe(200);
    env.restrictProgram("quarantine");
    const result = await env.call(REPORTER, "GET", `security-cases/${id}`);
    expect(result.status).toBe(200);
    expect(result.body.case.awardState).toBe("approved");
    expect(env.reservations()).toEqual([
      { case_id: id, gross_minor: "1000000" },
    ]);
  });
});

for (const identity of ["id", "path"] as const)
  for (const racing of [false, true])
    for (const relatedParty of [false, true])
      test(`repository-bound ${identity} restriction blocks a new award (race: ${racing}, related: ${relatedParty})`, async () => {
        const env = open();
        const pending = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
        await env.decide(pending, "shared-repository-root", { relatedParty });
        const other = "other-bounty";
        // One control matches the permanent ID after a rename; the other
        // matches a historical path despite a different permanent ID.
        const repositoryId = identity === "id" ? "123" : "456";
        const repository = identity === "id" ? "renamed/bounty" : REPOSITORY;
        const manifest = JSON.stringify({
          ...JSON.parse(programManifest(OPEN_PROGRAM)),
          id: other,
          repositories: [{ id: repository }],
          authority: { repositoryId, repositoryNodeId: `R_${repositoryId}` },
        });
        const digest = createHash("sha256").update(manifest).digest("hex");
        env.sqlite
          .query(
            "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,'fixture',?)",
          )
          .run(other, manifest, digest, REVISION_AT);
        env.sqlite
          .query(
            "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)",
          )
          .run(other, manifest, digest, REVISION_AT, REVISION_AT);
        const restrict = () =>
          env.sqlite
            .query(`INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
        VALUES ('enf_shared_bounty',?,1,'quarantine','quarantined','none','Synthetic restriction','private-fixture',?,?,?, ?,NULL,'project-moderator','admin-panel',1,?,NULL,NULL,'revision_pending',?)`)
            .run(
              other,
              repositoryId,
              JSON.stringify([repository]),
              DISPUTE.githubId,
              DISPUTE.githubLogin,
              digest,
              REVISION_AT,
            );
        if (racing) env.setBeforeBatch(restrict);
        else restrict();
        const result = await env.award(pending, "1000000");
        expect(result.status).toBe(409);
        expect(result.body.error).toBe("program_restricted");
        expect(env.reservations()).toEqual([]);
        // The actual journal's explicit reinstatement permits a fresh attempt.
        env.sqlite
          .query(`INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
        VALUES ('enf_shared_reinstate',?,2,'reinstate','clear','granted','Synthetic reinstatement','private-fixture',?,?,?, ?,NULL,'project-moderator','admin-panel',1,?,NULL,NULL,'no_revision_needed',?)`)
          .run(
            other,
            repositoryId,
            JSON.stringify([repository]),
            DISPUTE_2.githubId,
            DISPUTE_2.githubLogin,
            digest,
            REVISION_AT,
          );
        expect((await env.award(pending, "1000000")).status).toBe(200);
        if (relatedParty) {
          expect(env.reservations()).toEqual([]);
          expect(
            (
              await env.act(DISPUTE, pending, {
                action: "decide-related-party",
                outcome: "approve",
                reason: "Independent approval after repository reinstatement.",
              })
            ).status,
          ).toBe(200);
        }
        expect(env.reservations()).toEqual([
          { case_id: pending, gross_minor: "1000000" },
        ]);
        env.sqlite.close();
      });

for (const fault of ["failed", "missing", "partial"] as const)
  test(`an ${fault} enforcement read cannot approve an award and can retry`, async () => {
    const env = open();
    const id = await env.receive(REPORTER, "2026-10-19T09:10:00.000Z");
    await env.decide(id, "read-failure-root");
    env.restrictProgram();
    env.reinstateProgram();
    const prepare = env.db.prepare;
    env.db.prepare = (sql) => {
      const statement = prepare(sql);
      if (
        !sql.startsWith("SELECT id, project_id, sequence, action, state_after")
      )
        return statement;
      return {
        ...statement,
        all: async <T>() => {
          const result = await statement.all<T>();
          if (fault === "failed") return { ...result, success: false };
          // Cloudflare always returns rows; this proves the read still fails closed.
          if (fault === "missing") return { success: true } as typeof result;
          // Omitting the older row would otherwise leave a valid clear state.
          return { ...result, results: result.results?.slice(-1) };
        },
      };
    };
    const result = await env.award(id, "1000000");
    expect(result.status).toBe(fault === "partial" ? 409 : 500);
    expect(env.reservations()).toEqual([]);
    expect(env.inbox(FINANCE, id)).toEqual([]);
    env.db.prepare = prepare;
    expect((await env.award(id, "1000000")).status).toBe(200);
    expect(env.reservations()).toEqual([
      { case_id: id, gross_minor: "1000000" },
    ]);
    env.sqlite.close();
  });

test("the case list reads every visible case in a bounded number of statements", async () => {
  const env = open();
  const listed = async (count: number) => {
    for (let index = 0; index < count; index += 1)
      await env.receive(
        REPORTER,
        `2026-10-19T09:${String(10 + index).padStart(2, "0")}:00.000Z`,
      );
    env.resetStatements();
    const response = await env.call(REPORTER, "GET", "security-cases");
    expect(response.status).toBe(200);
    return { cases: response.body.cases ?? [], statements: env.statements() };
  };
  const one = await listed(1);
  const many = await listed(10);
  expect(many.cases).toHaveLength(11);
  // Six reads per case before the batch: events, settlement, project,
  // reservation, intake and the access-log statement the list already batches.
  const perCase = (many.statements - one.statements) / 9;
  expect(perCase).toBeLessThanOrEqual(2);
  // The payload is unchanged: one entry per case, each with its own roles.
  expect(new Set(many.cases.map((entry) => entry.id)).size).toBe(11);
  expect(many.cases[0].viewerRoles).toEqual(["reporter"]);
});
