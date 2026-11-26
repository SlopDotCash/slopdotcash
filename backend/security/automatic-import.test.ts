/**
 * The automatic import of a program's GitHub private reports (operator
 * decision, 25 November 2026; PRD section 8), against the real migrations.
 * GitHub's report list and the analysis model are injected.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { AdvisoryReader, GithubPrivateReport } from "./advisories";
import type { SecurityD1Database } from "./case-store";
import { importGithubReports } from "./handler";

const NOW = "2026-11-25T12:00:00.000Z";
const SECRET = "Synthetic exploit narrative that must stay private.";
const REVIEWER = { githubId: "900000101", githubLogin: "reviewer" };
const REPORTER = { githubId: "900000102", githubLogin: "reporter" };

function program(repository: string) {
  return {
    status: "open",
    intake: { repository },
    amount: {
      currency: "USDC",
      decimals: 6,
      network: "base",
      grossMinor: "1000000",
    },
    settlement: { chain: "base", deployments: [] },
    funding: { state: "pledged", evidence: null, verifiedAt: null },
    sponsor: { name: "Fixture", githubId: null },
    approvers: { technical: [REVIEWER], financial: [REVIEWER], dispute: [] },
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
}

function report(ghsa: string, createdAt: string): GithubPrivateReport {
  return {
    ghsa,
    createdAt,
    state: "triage",
    author: REPORTER,
    summary: "Vault share rounding",
    description: SECRET,
    referenceLines: [],
    severity: "high",
    cweIds: [],
    packages: [],
  };
}

function fixture() {
  const { db, sqlite } = sqliteD1();
  const project = (
    id: string,
    options: { program?: boolean; status?: string } = {},
  ) => {
    const repository = `example/${id}`;
    const status = options.status ?? "active";
    const manifest = JSON.stringify({
      id,
      status,
      listingTier: "community",
      repositories: [{ id: repository }],
      authority: { repositoryId: "123", repositoryNodeId: "R_kgDO123" },
      ...(options.program === false
        ? {}
        : { securityBounty: program(repository) }),
    });
    const digest = createHash("sha256").update(manifest).digest("hex");
    sqlite
      .query(
        "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at) VALUES (?, 1, ?, ?, 'test', ?)",
      )
      .run(id, manifest, digest, "2026-10-01T00:00:00.000Z");
    sqlite
      .query(
        "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)",
      )
      .run(
        id,
        status,
        manifest,
        digest,
        "2026-10-01T00:00:00.000Z",
        "2026-10-01T00:00:00.000Z",
      );
    return repository;
  };
  const github = new Map<string, GithubPrivateReport[] | "unavailable">();
  const listed: string[] = [];
  const advisories: AdvisoryReader = {
    privateReports: async (repository) => {
      listed.push(repository);
      const reports = github.get(repository);
      return reports === undefined || reports === "unavailable"
        ? { state: "unavailable" }
        : { state: "ok", reports: [...reports] };
    },
    privateReport: async () => ({ state: "unavailable" }),
  };
  let ids = 0;
  const run = () =>
    importGithubReports({
      db: db as unknown as SecurityD1Database,
      now: () => new Date(NOW),
      randomId: () => {
        ids += 1;
        return `auto${String(ids).padStart(8, "0")}`;
      },
      sessionActor: async () => null,
      reportingRead: async () => ({ kind: "unavailable" }),
      advisories,
      analyzer: null,
      moderatorGithubIds: new Set(),
    });
  const cases = () =>
    sqlite
      .query(
        "SELECT project_id, advisory_ghsa, reporter_github_id, submission_state, receipt_state, received_at, received_at_source FROM security_cases ORDER BY advisory_ghsa",
      )
      .all();
  return { sqlite, project, github, listed, run, cases };
}

describe("automatic import of GitHub private reports", () => {
  test("each listed report's GitHub state is kept and follows GitHub", async () => {
    const t = fixture();
    const repository = t.project("alpha");
    const first = report("GHSA-2c3f-4g5h-239m", "2026-11-20T08:00:00.000Z");
    const second = report("GHSA-3c4f-5g6h-34pq", "2026-11-21T08:00:00.000Z");
    t.github.set(repository, [first, second]);
    await t.run();
    const states = () =>
      t.sqlite
        .query(
          "SELECT repository, ghsa, state FROM security_advisory_states ORDER BY ghsa",
        )
        .all();
    expect(states()).toEqual([
      { repository, ghsa: first.ghsa, state: "triage" },
      { repository, ghsa: second.ghsa, state: "triage" },
    ]);
    // A maintainer closes one on GitHub; an unknown state is never kept.
    t.github.set(repository, [
      { ...first, state: "closed" },
      { ...second, state: "something-new" },
    ]);
    await t.run();
    expect(states()).toEqual([
      { repository, ghsa: first.ghsa, state: "closed" },
      { repository, ghsa: second.ghsa, state: "triage" },
    ]);
    // An unreadable list changes nothing.
    t.github.set(repository, "unavailable");
    await t.run();
    expect(states()).toHaveLength(2);
  });

  test("a program's unrecorded reports become verified cases, once, with no deposit asked", async () => {
    const t = fixture();
    const repository = t.project("alpha");
    t.github.set(repository, [
      report("GHSA-2c3f-4g5h-239m", "2026-11-20T08:00:00.000Z"),
      report("GHSA-2c3f-4g5h-249m", "2026-11-21T08:00:00.000Z"),
    ]);
    expect(await t.run()).toEqual({ programs: 1, received: 2, unavailable: 0 });
    expect(t.cases()).toEqual([
      {
        project_id: "alpha",
        advisory_ghsa: "GHSA-2c3f-4g5h-239m",
        reporter_github_id: REPORTER.githubId,
        submission_state: "verified",
        receipt_state: "received",
        received_at: "2026-11-20T08:00:00.000Z",
        received_at_source: "github-verified",
      },
      {
        project_id: "alpha",
        advisory_ghsa: "GHSA-2c3f-4g5h-249m",
        reporter_github_id: REPORTER.githubId,
        submission_state: "verified",
        receipt_state: "received",
        received_at: "2026-11-21T08:00:00.000Z",
        received_at_source: "github-verified",
      },
    ]);
    // The journal names the automatic actor, never a person.
    expect(
      t.sqlite
        .query(
          "SELECT DISTINCT actor_github_id, kind FROM security_case_events",
        )
        .all(),
    ).toEqual([{ actor_github_id: "slop", kind: "receive" }]);
    // An import asks nobody for a deposit.
    expect(
      t.sqlite
        .query("SELECT COUNT(*) AS n FROM security_report_deposits")
        .get(),
    ).toEqual({ n: 0 });
    // The program's reviewer is told about each new case.
    expect(
      t.sqlite
        .query(
          "SELECT COUNT(*) AS n FROM notifications WHERE recipient_github_id = ? AND kind = 'security_case'",
        )
        .get(REVIEWER.githubId),
    ).toEqual({ n: 2 });
    // A second run finds nothing new.
    expect(await t.run()).toEqual({ programs: 1, received: 0, unavailable: 0 });
    expect(t.cases()).toHaveLength(2);
    // No report text is stored in the case or its journal.
    const stored = JSON.stringify([
      t.cases(),
      t.sqlite.query("SELECT * FROM security_case_events").all(),
      t.sqlite.query("SELECT * FROM notifications").all(),
    ]);
    expect(stored).not.toContain(SECRET);
  });

  test("only active projects with a program are read, and an unreadable list writes nothing", async () => {
    const t = fixture();
    const open = t.project("alpha");
    const plain = t.project("plain", { program: false });
    const paused = t.project("paused", { status: "paused" });
    t.github.set(open, "unavailable");
    t.github.set(plain, [report("GHSA-2c3f-4g5h-259m", NOW)]);
    t.github.set(paused, [report("GHSA-2c3f-4g5h-269m", NOW)]);
    expect(await t.run()).toEqual({ programs: 1, received: 0, unavailable: 1 });
    expect(t.listed).toEqual([open]);
    expect(t.cases()).toEqual([]);
  });

  test("one program that throws does not stop the others", async () => {
    const t = fixture();
    const first = t.project("alpha");
    const second = t.project("beta");
    t.github.set(second, [report("GHSA-2c3f-4g5h-279m", NOW)]);
    const original = t.github.get.bind(t.github);
    t.github.get = ((repository: string) => {
      if (repository === first) throw new Error("GitHub failed");
      return original(repository);
    }) as typeof t.github.get;
    expect(await t.run()).toEqual({ programs: 2, received: 1, unavailable: 1 });
    expect(t.cases()).toHaveLength(1);
  });
});
