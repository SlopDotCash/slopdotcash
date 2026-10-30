// Automatic private intake against the real migrations and an in-memory
// GitHub (PRD section 8, SEC-07, SEC-17; issue #910). No request leaves the
// process; the fake answers the HTTP calls the real adapter makes.
import {
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import { FAKE_OAUTH, fakeGithub } from "../../tests/github-advisories.fake";
import { seedParticipationBan } from "../../tests/participation-ban.fixture";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { dispatchSecurityMail } from "../../workers/notify/security";
import { slopbotRepositoryAccess } from "../projects/repository-access";
import type { R2Bucket } from "../trace/cloudflare-persistence";
import { type AdvisoryReader, parsePrivateReport } from "./advisories";
import type { SecurityAnalysisInput, SecurityAnalyzer } from "./analysis";
import {
  handleSecurityApi,
  type SecurityD1Database,
  securityNotificationAccess,
} from "./handler";
import { githubIntakeOAuth, type IntakeConfig } from "./intake-grant";
import { deterministicAnalyzer } from "./report-analysis";
import {
  type ReportingObservation,
  refreshReportingObservation,
  reportingTarget,
} from "./reporting-readiness";
import { RECONCILE_QUIET_MS, SUBMITTED_LIMIT_MS } from "./submissions";

// Several tests build more than one database with every migration.
setDefaultTimeout(30_000);

const migrations = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const ORIGIN = "https://slop.test";
const PROJECT = "bounty";
const REPO = "example/bounty";
const MAINTAINER = { githubId: "900000101", githubLogin: "maintainer" };
const MAINTAINER_2 = { githubId: "900000111", githubLogin: "maintainer-two" };
const REPORTER = { githubId: "900000102", githubLogin: "reporter" };
const OTHER = { githubId: "900000103", githubLogin: "other" };
const ADMIN = { githubId: "900000120", githubLogin: "admin" };
const START = "2026-10-23T10:00:00.000Z";
const SENTINEL = "SENTINEL-PRIVATE-REPORT-7f3a";
const GRANT_KEY = Buffer.alloc(32, 7).toString("base64url");

const PROGRAM = {
  status: "open",
  intake: { repository: REPO },
  amount: {
    currency: "USD",
    decimals: 2,
    network: null,
    grossMinor: "1000000",
  },
  funding: {
    state: "verified-available",
    evidence: "synthetic-funding-evidence",
    verifiedAt: START,
  },
  sponsor: { name: "Slop", githubId: null },
  approvers: {
    technical: [MAINTAINER, MAINTAINER_2],
    financial: [],
    dispute: [],
  },
  capacity: { awards: 1, closesAt: null },
  responseTargets: {
    acknowledgeHours: 24,
    triageBusinessDays: 5,
    updateIntervalDays: 7,
  },
};

type Account = typeof REPORTER;
type Body = Record<string, unknown> & {
  error?: string;
  submission?: Record<string, unknown> & {
    id: string;
    state: string;
    revision: number;
  };
  authorizeUrl?: string;
};

const REPORT = {
  summary: `Vault withdraw skips the owner check ${SENTINEL}`,
  description: `Calling withdraw with a crafted proof drains the vault. ${SENTINEL} Steps: ...`,
  cvssVectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
  cweIds: ["CWE-284"],
};

function setup(
  options: {
    mode?: "on" | "off";
    pvr?: boolean;
    noProgram?: boolean;
    durable?: boolean;
    /** A recorded GitHub rename of REPO: the current repository path. */
    renamedTo?: string;
  } = {},
) {
  const current = options.renamedTo ?? REPO;
  const { db, sqlite } = sqliteD1(migrations);
  const owner = options.noProgram
    ? {
        actorId: "700000050",
        login: "example",
        nodeId: "O_700000050",
        type: "Organization",
      }
    : {
        actorId: MAINTAINER.githubId,
        login: MAINTAINER.githubLogin,
        nodeId: "U_900000101",
        type: "User",
      };
  const manifest = JSON.stringify({
    id: PROJECT,
    status: "active",
    // A recorded rename keeps the original path as the id and publishes the
    // current path as the alias and githubUrl (`assertRepositoryTransition`).
    repositories: [
      options.renamedTo
        ? {
            id: REPO,
            aliases: [current],
            displayName: current,
            githubUrl: `https://github.com/${current}`,
          }
        : { id: REPO, githubUrl: `https://github.com/${REPO}` },
    ],
    authority: { repositoryId: "700000001", repositoryNodeId: "R_700000001" },
    steward: { github: owner },
    ...(options.noProgram ? {} : { securityBounty: PROGRAM }),
  });
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at, actor_github_id, actor_github_login) VALUES (?, 1, ?, ?, 'test', ?, ?, ?)",
    )
    .run(
      PROJECT,
      manifest,
      digest,
      "2026-10-01T00:00:00.000Z",
      MAINTAINER.githubId,
      MAINTAINER.githubLogin,
    );
  sqlite
    .query(
      "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)",
    )
    .run(PROJECT, manifest, digest, START, START);
  let now = new Date(START);
  const clock = () => now;
  let reportingFailure: "unavailable" | "identity-mismatch" | null = null;
  let enabled = options.pvr ?? true;
  let freshReadCount = 0;
  const github = fakeGithub({ now: clock });
  github.install(current);
  if (options.renamedTo) github.rename(REPO, 700000001);
  const intake: IntakeConfig = {
    mode: options.mode ?? "on",
    grantKey: GRANT_KEY,
    clientId: "Iv1.intakeclient",
    authorizeOrigin: FAKE_OAUTH,
    oauth: githubIntakeOAuth({
      fetch: github.fetch,
      oauthOrigin: FAKE_OAUTH,
      clientId: "Iv1.intakeclient",
      clientSecret: "fixture-secret",
    }),
    advisories: github.client,
    installation: github.installation,
    analyzer: deterministicAnalyzer,
  };
  const reportingRead = async (target: {
    repository: string;
    repositoryId: string | null;
    repositoryNodeId: string | null;
  }): Promise<ReportingObservation> => {
    freshReadCount += 1;
    if (reportingFailure) return { kind: reportingFailure };
    if ((await intake.installation.installed(target.repository)) !== "yes")
      return { kind: "app-not-installed" };
    return {
      kind: "verified",
      enabled,
      repositoryId: target.repositoryId!,
      repositoryNodeId: target.repositoryNodeId!,
    };
  };
  const refresh = async () => {
    const row = sqlite
      .query("SELECT manifest, revision FROM projects WHERE id = ?")
      .get(PROJECT) as { manifest: string; revision: number };
    return refreshReportingObservation(
      db,
      reportingTarget(
        JSON.parse(row.manifest) as ProjectDefinition,
        row.revision,
      ),
      reportingRead,
      now,
    );
  };
  let beforeBatch: (() => void | Promise<void>) | null = null;
  const securityDb = db as unknown as SecurityD1Database;
  const wrapped: SecurityD1Database = {
    prepare: (sql) => securityDb.prepare(sql),
    batch: async (statements) => {
      const hook = beforeBatch;
      beforeBatch = null;
      await hook?.();
      return securityDb.batch(statements);
    },
  };
  // One cookie jar per account, keyed by cookie name.
  const jars = new Map<string, Map<string, string>>();
  const jar = (account: Account) => {
    let found = jars.get(account.githubId);
    if (!found) {
      found = new Map([
        ["__Host-slop_points", `session-${account.githubId}-${"x".repeat(40)}`],
      ]);
      jars.set(account.githubId, found);
    }
    return found;
  };
  const absorb = (account: Account, setCookies: string[]) => {
    for (const header of setCookies) {
      const [pair, ...attributes] = header.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (attributes.some((a) => a.trim() === "Max-Age=0"))
        jar(account).delete(name);
      else jar(account).set(name, value);
    }
  };
  const objects = new Map<
    string,
    { bytes: Uint8Array; metadata: Record<string, string> }
  >();
  const reportStorage: R2Bucket = {
    async put(key, bytes, options) {
      if (!objects.has(key))
        objects.set(key, {
          bytes: bytes.slice(),
          metadata: options.customMetadata,
        });
    },
    async head(key) {
      const value = objects.get(key);
      return value
        ? { size: value.bytes.byteLength, customMetadata: value.metadata }
        : null;
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) return null;
      const body = new Response(new Uint8Array(value.bytes).buffer).body;
      if (!body) throw new Error("Fixture body missing");
      return {
        size: value.bytes.byteLength,
        body,
        customMetadata: value.metadata,
      };
    },
  };
  // The App-token reader behind imports and receipt checks, over the same
  // in-memory GitHub. GitHub's REST author is a User; the fake omits `type`.
  const asPrivateReport = (advisory: (typeof github.advisories)[number]) =>
    parsePrivateReport({
      ...advisory.advisory,
      author: { ...advisory.advisory.author, type: "User" },
    });
  const advisories: AdvisoryReader = {
    privateReports: async (repository) => ({
      state: "ok",
      reports: github.advisories
        .filter((entry) => entry.repository === repository.toLowerCase())
        .map(asPrivateReport)
        .filter((report) => report !== null),
    }),
    privateReport: async (repository, ghsa) => {
      const found = github.advisories.find(
        (entry) =>
          entry.repository === repository.toLowerCase() &&
          entry.advisory.ghsa_id === ghsa,
      );
      const report = found ? asPrivateReport(found) : null;
      return report ? { state: "found", report } : { state: "unavailable" };
    },
  };
  const responses: string[] = [];
  let ids = 0;
  let permission: "admin" | "read" = "admin";
  let repositoryId = 700000001;
  let accessUnavailable = false;
  const unavailableRepositories = new Set<string>();
  const repositoryAccess = (
    repository: { path: string; githubId: string },
    actor: Account,
  ) =>
    slopbotRepositoryAccess(
      {
        fetch: async (request) => {
          const url = new URL(request.url);
          expect(url.searchParams.get("repositoryId")).toBe(
            [REPO, current].includes(repository.path)
              ? "700000001"
              : "700000002",
          );
          expect(url.searchParams.get("githubId")).toBe(actor.githubId);
          if (accessUnavailable || unavailableRepositories.has(repository.path))
            return new Response(null, { status: 503 });
          return Response.json({
            installation: "installed",
            installationId: 123,
            permission:
              actor.githubId === MAINTAINER.githubId ? permission : "read",
            roleName: null,
            repository: {
              id: [REPO, current].includes(repository.path)
                ? repositoryId
                : 700000002,
              node_id: [REPO, current].includes(repository.path)
                ? "R_700000001"
                : "R_700000002",
              full_name: repository.path,
              private: false,
              owner: {
                id: Number(owner.actorId),
                node_id: owner.nodeId,
                login: owner.login,
                type: owner.type,
              },
            },
          });
        },
      },
      repository,
      actor,
    );
  const raw = async (
    as: Account | null,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    cookies?: Map<string, string>,
  ) => {
    const cookieJar = cookies ?? (as ? jar(as) : new Map());
    const response = (await handleSecurityApi(
      new Request(`${ORIGIN}/api/v1/${path}`, {
        method,
        headers: {
          ...(method === "POST"
            ? { origin: ORIGIN, "content-type": "application/json" }
            : {}),
          cookie: [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; "),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      {
        db: wrapped,
        ...(options.durable ? { reportStorage } : {}),
        now: clock,
        randomId: () => {
          ids += 1;
          return `case${String(ids).padStart(8, "0")}`;
        },
        sessionActor: async (request) =>
          as !== null &&
          (request.headers.get("cookie") ?? "").includes("__Host-slop_points")
            ? as
            : null,
        reportingRead,
        intake,
        analyzer,
        advisories,
        repositoryAccess,
        moderatorGithubIds: new Set([ADMIN.githubId]),
      },
    )) as Response;
    if (as) absorb(as, response.headers.getSetCookie());
    const text = response.status === 303 ? "" : await response.text();
    responses.push(text, ...response.headers.getSetCookie());
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : {}) as Body,
      location: response.headers.get("location"),
      cookies: response.headers.getSetCookie(),
    };
  };
  const call = (
    as: Account,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => raw(as, method, path, body);
  // The owner's private AI analysis; it receives the content in memory.
  const analyzed: SecurityAnalysisInput[] = [];
  const analyzer: SecurityAnalyzer = {
    provider: "fixture",
    model: "fixture-model",
    screen: async () => ({
      decision: "legitimate",
      reason: "Concrete private reproduction for human review.",
    }),
    analyze: async (input) => {
      analyzed.push(input);
      return {
        summary: "A synthetic proposal for the owner.",
        severity: "high",
        potentialLoss: "unclear",
        duplicateCaseIds: [],
        rootCauseKey: null,
        remediation: "Synthetic remediation.",
      };
    },
  };
  let keys = 0;
  const key = () => {
    keys += 1;
    return `intake-key-${String(keys).padStart(8, "0")}`;
  };
  const create = (
    as: Account = REPORTER,
    extra: Record<string, unknown> = {},
  ) =>
    call(as, "POST", "security-submissions", {
      projectId: PROJECT,
      idempotencyKey: key(),
      origin: "slop",
      ...extra,
    });
  /** Completes the GitHub consent for `as` as GitHub account `account`. */
  const authorize = async (
    as: Account,
    authorizeUrl: string,
    account: Account = as,
  ) => {
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
    const code = github.issueCode({
      id: Number(account.githubId),
      login: account.githubLogin,
    });
    // The Strict session cookie does not arrive on GitHub's cross-site return.
    const cookies = new Map(jar(as));
    cookies.delete("__Host-slop_points");
    const response = await raw(
      null,
      "GET",
      `security-submissions/authorize/callback?code=${code}&state=${state}`,
      undefined,
      cookies,
    );
    absorb(as, response.cookies);
    return response;
  };
  /** Creates a draft and authorizes it; returns the submission. */
  const ready = async (as: Account = REPORTER, projectId = PROJECT) => {
    const created = await create(as, { projectId });
    expect(created.status).toBe(201);
    const callback = await authorize(as, created.body.authorizeUrl as string);
    expect(callback.status).toBe(303);
    expect(callback.location).toBe(
      `/security?submission=${created.body.submission?.id}`,
    );
    return created.body.submission as NonNullable<Body["submission"]>;
  };
  const send = (
    id: string,
    expectedRevision: number,
    report: unknown = REPORT,
    as: Account = REPORTER,
  ) =>
    call(as, "POST", `security-submissions/${id}/send`, {
      expectedRevision,
      report,
    });
  const reconcile = (id: string, expectedRevision: number) =>
    call(REPORTER, "POST", `security-submissions/${id}/reconcile`, {
      expectedRevision,
    });
  const row = (id: string) =>
    sqlite
      .query("SELECT * FROM security_submissions WHERE id = ?")
      .get(id) as Record<string, string | number | null>;
  const cases = () =>
    sqlite.query("SELECT * FROM security_cases").all() as Record<
      string,
      string | number | null
    >[];
  const outbox = () =>
    (
      sqlite
        .query(
          "SELECT recipient_github_id FROM security_notification_outbox ORDER BY recipient_github_id",
        )
        .all() as { recipient_github_id: string }[]
    ).map((r) => r.recipient_github_id);
  return {
    addProject: (id: string, repository: string) => {
      const other = JSON.parse(manifest);
      other.id = id;
      other.repositories = [
        { id: repository, githubUrl: `https://github.com/${repository}` },
      ];
      other.authority = {
        repositoryId: "700000002",
        repositoryNodeId: "R_700000002",
      };
      const bytes = JSON.stringify(other);
      const hash = createHash("sha256").update(bytes).digest("hex");
      sqlite
        .query(
          "INSERT INTO project_revisions (project_id, revision, manifest, manifest_sha256, reason, created_at, actor_github_id, actor_github_login) VALUES (?, 1, ?, ?, 'fixture', ?, ?, ?)",
        )
        .run(
          id,
          bytes,
          hash,
          START,
          MAINTAINER.githubId,
          MAINTAINER.githubLogin,
        );
      sqlite
        .query(
          "INSERT INTO projects (id, status, revision, manifest, manifest_sha256, created_at, updated_at) VALUES (?, 'active', 1, ?, ?, ?, ?)",
        )
        .run(id, bytes, hash, START, START);
      github.install(repository);
    },
    refresh,
    setReporting: (value: {
      enabled?: boolean;
      failure?: "unavailable" | "identity-mismatch" | null;
    }) => {
      if (value.enabled !== undefined) enabled = value.enabled;
      if ("failure" in value) reportingFailure = value.failure ?? null;
    },
    reportingReads: () => freshReadCount,
    unavailableRepositories,
    sqlite,
    db: securityDb,
    clock,
    repositoryAccess,
    setPermission: (value: "admin" | "read") => {
      permission = value;
    },
    setRepositoryId: (value: number) => {
      repositoryId = value;
    },
    setAccessUnavailable: (value: boolean) => {
      accessUnavailable = value;
    },
    github,
    intake,
    analyzed,
    analyzer,
    call,
    raw,
    key,
    create,
    authorize,
    ready,
    send,
    reconcile,
    row,
    cases,
    outbox,
    jar,
    responses,
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    setBeforeBatch: (hook: () => void | Promise<void>) => {
      beforeBatch = hook;
    },
  };
}

describe("private intake: cached reporting observations", () => {
  test.each([false, true])(
    "failed or stale public observations do not authorize or permanently block submission (no program: %s)",
    async (noProgram) => {
      const t = setup({ noProgram });
      const read = () =>
        t.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`);
      expect((await read()).body).toMatchObject({
        state: "unavailable",
        stale: true,
        checkedAt: null,
        automaticConfigured: true,
      });
      expect(t.reportingReads()).toBe(0);
      await t.refresh();
      const good = (await read()).body;
      expect(good).toMatchObject({ state: "ready", stale: false });
      t.advance(1);
      t.setReporting({ failure: "unavailable" });
      await t.refresh();
      const reads = t.reportingReads();
      expect((await read()).body).toMatchObject({
        state: "ready",
        stale: true,
        checkedAt: good.checkedAt,
        automatic: "unavailable",
      });
      expect(t.reportingReads()).toBe(reads);
      expect((await t.create()).status).toBe(409);
      expect(
        t.sqlite.query("SELECT count(*) AS n FROM security_submissions").get(),
      ).toEqual({ n: 0 });

      t.advance(1);
      t.setReporting({ failure: null, enabled: false });
      await t.refresh();
      expect((await read()).body).toMatchObject({
        state: "disabled",
        stale: false,
      });
      t.advance(3_600_001);
      expect((await read()).body).toMatchObject({
        state: "disabled",
        stale: true,
      });
      t.setReporting({ enabled: true });
      const created = await t.create();
      expect(created.status).toBe(201);
      const id = created.body.submission!.id;
      await t.authorize(REPORTER, created.body.authorizeUrl as string);
      // Sending has its own fresh check and leaves the authorized draft intact.
      t.setReporting({ enabled: false });
      expect((await t.send(id, 1)).body.error).toBe("intake_unavailable");
      expect(t.row(id).state).toBe("draft");
      expect(t.github.counts.posts).toBe(0);
      t.setReporting({ failure: "unavailable" });
      expect((await t.send(id, 1)).body.error).toBe("intake_unavailable");
      expect(t.row(id).state).toBe("draft");
      expect(t.github.counts.posts).toBe(0);
      t.setReporting({ failure: null, enabled: true });
      expect((await t.send(id, 1)).body.submission?.state).toBe(
        "receipt-verified",
      );
      expect(t.github.counts.posts).toBe(1);
      expect((await t.send(id, 1)).body.submission?.state).toBe(
        "receipt-verified",
      );
      expect(t.github.counts.posts).toBe(1);
    },
  );
});

describe("private intake: creation and identity", () => {
  test("creation replays one key and refuses a second submission in flight", async () => {
    const t = setup();
    const key = t.key();
    const body = { projectId: PROJECT, idempotencyKey: key, origin: "slop" };
    const first = await t.call(REPORTER, "POST", "security-submissions", body);
    expect(first.status).toBe(201);
    expect(first.body.submission).toMatchObject({
      state: "draft",
      origin: "slop",
    });
    expect(first.body.authorizeUrl).toContain(
      `${FAKE_OAUTH}/login/oauth/authorize`,
    );
    expect(first.body.authorizeUrl).toContain("code_challenge_method=S256");
    const replay = await t.call(REPORTER, "POST", "security-submissions", body);
    expect(replay.status).toBe(200);
    expect(replay.body.submission?.id).toBe(first.body.submission?.id);
    // Put it in flight, then a different key is refused. The replay began a
    // new authorization, so only its state is current.
    await t.authorize(REPORTER, replay.body.authorizeUrl as string);
    t.github.faults.create = "5xx-before-create";
    const sent = await t.send(first.body.submission?.id as string, 1);
    expect(sent.body.submission?.state).toBe("uncertain");
    const second = await t.create();
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("submission_in_flight");
  });

  test("replaying creation on a finished or abandoned submission refuses instead of re-authorizing", async () => {
    const t = setup();
    const key = t.key();
    const body = { projectId: PROJECT, idempotencyKey: key, origin: "slop" };
    const created = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      body,
    );
    expect(created.status).toBe(201);
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const sent = await t.send(created.body.submission?.id as string, 1);
    expect(sent.body.submission).toMatchObject({ state: "receipt-verified" });
    // The dedicated authorize route refuses finished submissions (409
    // submission_closed); replaying creation must not reopen authorization.
    // A verified slop report trips the idempotency shape check first (its
    // advisory is now bound), so cover the finished state with a direct
    // report and the abandoned state with an idle slop draft.
    const advisory = t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      {
        summary: "Filed on GitHub",
        description: `Direct ${SENTINEL}`,
        severity: "high",
      },
      "2026-10-20T08:30:00.000Z",
    );
    const dkey = t.key();
    const dbody = {
      projectId: PROJECT,
      idempotencyKey: dkey,
      origin: "direct",
      advisory: advisory.ghsa_id,
    };
    const dcreated = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      dbody,
    );
    expect(dcreated.status).toBe(201);
    await t.authorize(REPORTER, dcreated.body.authorizeUrl as string);
    const dverified = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${dcreated.body.submission?.id}/verify`,
      { expectedRevision: 1 },
    );
    expect(dverified.body.submission).toMatchObject({
      state: "receipt-verified",
    });
    const dreplay = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      dbody,
    );
    expect(dreplay.status).toBe(409);
    expect(dreplay.body.error).toBe("submission_closed");
    // An abandoned draft must not be re-authorized either.
    const akey = t.key();
    const abody = { projectId: PROJECT, idempotencyKey: akey, origin: "slop" };
    const acreated = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      abody,
    );
    expect(acreated.status).toBe(201);
    t.advance(24 * 60 * 60 * 1000 + 1000);
    const areplay = await t.call(
      REPORTER,
      "POST",
      "security-submissions",
      abody,
    );
    expect(areplay.status).toBe(409);
    expect(areplay.body.error).toBe("submission_closed");
  });

  test("the repository comes from the program terms, never from the request", async () => {
    const t = setup();
    const injected = await t.create(REPORTER, { repository: "attacker/repo" });
    expect(injected.status).toBe(400);
    const created = await t.create();
    expect(t.row(created.body.submission?.id as string).repository).toBe(REPO);
  });

  test.each([false, true])(
    "a grant for another GitHub account is refused and sets no grant cookie (no program: %s)",
    async (noProgram) => {
      const t = setup({ noProgram });
      const created = await t.create();
      const callback = await t.authorize(
        REPORTER,
        created.body.authorizeUrl as string,
        OTHER,
      );
      expect(callback.status).toBe(303);
      expect(callback.location).toContain("intake=grant_identity_mismatch");
      expect(
        callback.cookies.some((c) =>
          c.startsWith("__Secure-slop_intake_grant="),
        ),
      ).toBe(false);
      const sent = await t.send(created.body.submission?.id as string, 1);
      expect(sent.status).toBe(409);
      expect(sent.body.error).toBe("grant_required");
      expect(t.github.counts.posts).toBe(0);
    },
  );

  test("the grant cookie is encrypted, HttpOnly, Strict and scoped to the submission routes", async () => {
    const t = setup();
    const created = await t.create();
    expect(created.cookies).toHaveLength(1);
    expect(created.cookies[0]).toMatch(
      /^__Secure-slop_intake_flow=[^;]+; Path=\/api\/v1\/security-submissions; Max-Age=600; Secure; HttpOnly; SameSite=Lax$/u,
    );
    const callback = await t.authorize(
      REPORTER,
      created.body.authorizeUrl as string,
    );
    const grant = callback.cookies.find((c) =>
      c.startsWith("__Secure-slop_intake_grant="),
    );
    expect(grant).toMatch(
      /; Path=\/api\/v1\/security-submissions; Max-Age=7200; Secure; HttpOnly; SameSite=Strict$/u,
    );
    expect(grant).not.toContain("ghu_");
    // The flow cookie is cleared once used.
    expect(
      callback.cookies.some((c) =>
        /^__Secure-slop_intake_flow=; .*Max-Age=0/u.test(c),
      ),
    ).toBe(true);
    // A replayed callback has no flow and sets no grant.
    const replay = await t.raw(
      null,
      "GET",
      `security-submissions/authorize/callback?code=code_9_1&state=x`,
    );
    expect(replay.location).toBe("/security?intake=grant_flow_missing");
    expect(replay.cookies.some((c) => c.includes("intake_grant"))).toBe(false);
  });

  test("a missing, tampered, expired or rebound grant never reaches GitHub", async () => {
    const t = setup();
    const created = await t.create();
    const id = created.body.submission?.id as string;
    expect((await t.send(id, 1)).body.error).toBe("grant_required");
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const grant = t.jar(REPORTER).get("__Secure-slop_intake_grant") as string;
    // Change ciphertext data, not trailing base64 padding bits (or an unchanged AA suffix).
    const tamperAt = grant.indexOf(".") + 1;
    t.jar(REPORTER).set(
      "__Secure-slop_intake_grant",
      `${grant.slice(0, tamperAt)}${grant[tamperAt] === "A" ? "B" : "A"}${grant.slice(tamperAt + 1)}`,
    );
    expect((await t.send(id, 1)).body.error).toBe("grant_required");
    // Bound to another submission.
    t.jar(REPORTER).set("__Secure-slop_intake_grant", grant);
    const other = await t.create();
    expect(
      (await t.send(other.body.submission?.id as string, 1)).body.error,
    ).toBe("grant_required");
    // Bound to another session.
    const session = t.jar(REPORTER).get("__Host-slop_points") as string;
    t.jar(REPORTER).set("__Host-slop_points", `other-${"y".repeat(44)}`);
    expect((await t.send(id, 1)).body.error).toBe("grant_required");
    t.jar(REPORTER).set("__Host-slop_points", session);
    // Expired after two hours.
    t.advance(2 * 60 * 60 * 1000 + 1000);
    expect((await t.send(id, 1)).body.error).toBe("grant_required");
    expect(t.github.counts.posts).toBe(0);
  });
});

describe("registered project without paid bounty terms", () => {
  test("an unrelated authority outage preserves the reporter's own case list with a generic retry notice", async () => {
    const t = setup({ noProgram: true });
    const own = await t.ready();
    await t.send(own.id, 1);
    t.addProject("bounty-other", "example/other");
    const unrelated = await t.ready(OTHER, "bounty-other");
    expect((await t.send(unrelated.id, 1, REPORT, OTHER)).status).toBe(200);
    t.unavailableRepositories.add("example/other");
    const list = await t.call(REPORTER, "GET", "security-cases");
    expect(list.status).toBe(200);
    expect(list.body.authorityUnavailable).toBe(true);
    expect(list.body.programs).toEqual([]);
    expect(
      (list.body.cases as { projectId: string }[]).map((row) => row.projectId),
    ).toEqual([PROJECT]);
    expect(JSON.stringify(list.body)).not.toContain("bounty-other");
  });

  test("a moderator cannot discover an un-escalated reporting-only project from the private list", async () => {
    const t = setup({ noProgram: true });
    const submission = await t.ready();
    await t.send(submission.id, 1);
    const list = await t.call(ADMIN, "GET", "security-cases");
    expect(list.status).toBe(200);
    expect(list.body.cases).toEqual([]);
    expect(list.body.programs).toEqual([]);
    expect(JSON.stringify(list.body)).not.toContain(PROJECT);
  });

  test("a sent report survives a contact lookup outage and reconciles without sending again", async () => {
    const t = setup({ noProgram: true });
    const submission = await t.ready();
    t.github.beforeCreate(() => t.setAccessUnavailable(true));
    const sent = await t.send(submission.id, 1);
    expect(sent.status).toBe(202);
    expect(t.row(submission.id).state).toBe("submitted");
    expect(t.row(submission.id).advisory_ghsa).toBe(
      t.github.advisories[0].advisory.ghsa_id,
    );
    expect(t.github.counts.posts).toBe(1);
    t.setAccessUnavailable(false);
    const recovered = await t.reconcile(
      submission.id,
      Number(t.row(submission.id).revision),
    );
    expect(recovered.status).toBe(200);
    expect(recovered.body.submission?.state).toBe("receipt-verified");
    expect(t.github.counts.posts).toBe(1);
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0]).toMatchObject({
      terms: null,
      award_state: "not-applicable",
    });
  });

  for (const origin of ["slop", "direct"] as const)
    test(`a verified ${origin} report with no passing approver recovers after 24 hours with fresh reporter consent`, async () => {
      const t = setup({ noProgram: true });
      const direct =
        origin === "direct"
          ? t.github.seed(
              REPO,
              { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
              REPORT,
              START,
            )
          : null;
      const created = await t.create(
        REPORTER,
        direct ? { origin, advisory: direct.ghsa_id } : {},
      );
      expect(created.status).toBe(201);
      await t.authorize(REPORTER, created.body.authorizeUrl as string);
      const submission = created.body.submission as NonNullable<
        Body["submission"]
      >;
      const verify = () =>
        origin === "slop"
          ? t.reconcile(submission.id, Number(t.row(submission.id).revision))
          : t.call(
              REPORTER,
              "POST",
              `security-submissions/${submission.id}/verify`,
              {
                expectedRevision: Number(t.row(submission.id).revision),
              },
            );
      // The steward is an organization, so it is not synthesized as its own
      // approver, and the only registry candidate loses admin permission.
      t.setPermission("read");
      const sent =
        origin === "slop" ? await t.send(submission.id, 1) : await verify();
      expect(sent.status).toBe(202);
      const heldState = origin === "slop" ? "submitted" : "draft";
      expect(t.row(submission.id).state).toBe(heldState);
      expect(t.cases()).toHaveLength(0);
      expect(t.outbox()).toEqual([]);
      const receipt = t.github.advisories[0].advisory;
      t.advance(SUBMITTED_LIMIT_MS + 1000);
      t.setPermission("admin");
      const expiredGrant = await verify();
      expect(expiredGrant.status).toBe(409);
      expect(expiredGrant.body.error).toBe("grant_required");
      expect(t.row(submission.id).state).toBe(heldState);
      expect(t.cases()).toHaveLength(0);
      const authorization = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/authorize`,
        {},
      );
      expect(authorization.status).toBe(200);
      expect(
        (await t.authorize(REPORTER, authorization.body.authorizeUrl as string))
          .status,
      ).toBe(303);
      const recovered = await verify();
      expect(recovered.status).toBe(200);
      expect(recovered.body.submission?.state).toBe("receipt-verified");
      expect(t.cases()).toHaveLength(1);
      expect(t.cases()[0]).toMatchObject({
        advisory_ghsa: receipt.ghsa_id,
        received_at: receipt.created_at,
      });
      expect(t.outbox()).toEqual([MAINTAINER.githubId, REPORTER.githubId]);
      expect(t.github.counts.posts).toBe(origin === "slop" ? 1 : 0);
    });

  test("private intake accepts a report without inventing an award", async () => {
    const t = setup({ noProgram: true });
    const readiness = await t.call(
      REPORTER,
      "GET",
      `security-programs/${PROJECT}/intake`,
    );
    expect(readiness.status).toBe(200);
    expect(readiness.body).toMatchObject({
      repository: REPO,
      paidParticipation: "closed",
    });
    const submission = await t.ready();
    const sent = await t.send(submission.id, 1);
    expect(sent.status).toBe(200);
    expect(sent.body.submission?.state).toBe("receipt-verified");
    expect(t.github.advisories[0].advisory.author.id).toBe(
      Number(REPORTER.githubId),
    );
    const recorded = t.cases()[0];
    expect(recorded).toMatchObject({
      terms: null,
      award_state: "not-applicable",
      payment_state: "not-applicable",
      next_action_due_at: null,
    });
    expect(t.outbox()).toEqual([MAINTAINER.githubId, REPORTER.githubId]);
    const path = `security-cases/${recorded.id}`;
    expect((await t.call(MAINTAINER, "GET", path)).status).toBe(200);
    expect((await t.call(OTHER, "GET", path)).status).toBe(404);
    expect((await t.call(ADMIN, "GET", path)).status).toBe(404);
    const list = await t.call(MAINTAINER, "GET", "security-cases");
    expect(list.status).toBe(200);
    expect((list.body.cases as unknown[]).length).toBe(1);
    // Mail uses the same live actor/repository authorization and sends no case text.
    expect(
      await securityNotificationAccess(
        t.db,
        String(recorded.id),
        MAINTAINER.githubId,
        new Set(),
        t.repositoryAccess,
      ),
    ).toEqual({ allowed: true, acknowledgeHours: 0 });
    const sentMail: string[] = [];
    const mail = {
      db: t.db,
      repositoryAccess: t.repositoryAccess,
      now: t.clock,
      fromAddress: "notifications@slop.cash",
      config: {
        inboxUrl: "https://slop.test/inbox",
        recipients: {
          [MAINTAINER.githubId]: {
            email: "maintainer@example.invalid",
            verifiedAt: "2026-10-01T00:00:00.000Z",
            evidenceReference: "fixture verification",
            backupGithubId: MAINTAINER_2.githubId,
          },
          [REPORTER.githubId]: {
            email: "reporter@example.invalid",
            verifiedAt: "2026-10-01T00:00:00.000Z",
            evidenceReference: "fixture verification",
            backupGithubId: MAINTAINER_2.githubId,
          },
        },
      },
      sendEmail: async (_from: string, to: string, mime: string) => {
        sentMail.push(to);
        expect(mime).not.toContain(SENTINEL);
      },
    };
    t.setAccessUnavailable(true);
    await dispatchSecurityMail(mail);
    expect(sentMail).toEqual(["reporter@example.invalid"]);
    expect(
      t.sqlite
        .query(
          "SELECT state FROM security_notification_outbox WHERE recipient_github_id = ?",
        )
        .get(MAINTAINER.githubId),
    ).toEqual({ state: "retrying" });
    t.setAccessUnavailable(false);
    t.setPermission("read");
    expect((await t.call(MAINTAINER, "GET", path)).status).toBe(404);
    expect(
      (
        await securityNotificationAccess(
          t.db,
          String(recorded.id),
          MAINTAINER.githubId,
          new Set(),
          t.repositoryAccess,
        )
      ).allowed,
    ).toBe(false);
    t.advance(3_600_000);
    await dispatchSecurityMail(mail);
    expect(sentMail).toEqual(["reporter@example.invalid"]);
    expect(
      t.sqlite
        .query(
          "SELECT state FROM security_notification_outbox WHERE recipient_github_id = ?",
        )
        .get(MAINTAINER.githubId),
    ).toEqual({ state: "suppressed" });
    t.setPermission("admin");
    t.setRepositoryId(700000002);
    expect((await t.call(MAINTAINER, "GET", path)).status).toBe(404);
    t.setRepositoryId(700000001);
    t.setAccessUnavailable(true);
    expect((await t.call(MAINTAINER, "GET", path)).status).toBe(503);
    // Provider failure cannot hide the reporter's own receipt.
    expect((await t.call(REPORTER, "GET", path)).status).toBe(200);
  });
});

describe("private intake: recorded repository rename", () => {
  for (const noProgram of [true, false])
    test(`a report reaches the renamed repository and its receipt is verified (${noProgram ? "reporting only" : "paid program"})`, async () => {
      const renamed = "example/renamed";
      const t = setup({ noProgram, renamedTo: renamed });
      await t.refresh();
      const readiness = await t.call(
        REPORTER,
        "GET",
        `security-programs/${PROJECT}/intake`,
      );
      expect(readiness.body).toMatchObject({
        state: "ready",
        automatic: "ready",
      });
      const submission = await t.ready();
      const sent = await t.send(submission.id, 1);
      expect(sent.status).toBe(200);
      expect(sent.body.submission?.state).toBe("receipt-verified");
      expect(t.github.advisories.map((entry) => entry.repository)).toEqual([
        renamed,
      ]);
      expect(t.cases()).toHaveLength(1);
    });
});

describe("private intake: send outcomes", () => {
  test("a report is filed as the reporter and its receipt is verified with GitHub", async () => {
    const t = setup();
    const submission = await t.ready();
    let stateDuringPost: unknown = null;
    t.github.beforeCreate(() => {
      stateDuringPost = t.row(submission.id).state;
    });
    const sent = await t.send(submission.id, 1);
    expect(sent.status).toBe(200);
    // The send was committed before GitHub was called.
    expect(stateDuringPost).toBe("submitting");
    expect(sent.body.submission).toMatchObject({
      state: "receipt-verified",
      attempt: 1,
      failureCode: null,
    });
    expect(JSON.stringify(sent.body)).not.toContain(SENTINEL);
    // GitHub records the reporter as the author, with the private marker.
    const [advisory] = t.github.advisories;
    expect(advisory.advisory.author.id).toBe(Number(REPORTER.githubId));
    const row = t.row(submission.id);
    expect(advisory.advisory.description).toContain(
      `Report reference: ${row.marker}`,
    );
    // The line stays if the advisory is ever published, so it names neither
    // the Slop submission nor Slop.
    expect(advisory.advisory.description).not.toContain(submission.id);
    expect(advisory.advisory.description).not.toContain("Slop");
    const [verified] = t.cases();
    expect(verified).toMatchObject({
      id: row.case_id,
      advisory_ghsa: advisory.advisory.ghsa_id,
      submission_state: "verified",
      received_at: advisory.advisory.created_at,
      received_at_source: "github-verified",
      verified_by_github_id: "github",
      policy_revision: 1,
      award_state: "pending",
      receipt_state: "received",
      severity: null,
      owner_github_id: MAINTAINER.githubId,
      // The analysis never shows in fields the reporter sees.
    });
    expect(verified.receipt_evidence_digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(row.evidence_digest).toBe(verified.receipt_evidence_digest);
    expect(JSON.parse(verified.terms as string)).toMatchObject({
      grossMinor: "1000000",
      researcherMinor: "750000",
    });
    // The private AI analysis read the content GitHub returned, in memory;
    // D1 keeps only its proposal and digest.
    expect(t.analyzed.map((input) => input.report.summary)).toEqual([
      advisory.advisory.summary,
    ]);
    const analyses = t.sqlite
      .query("SELECT state, summary FROM security_case_analyses")
      .all();
    expect(analyses).toEqual([
      { state: "complete", summary: "A synthetic proposal for the owner." },
    ]);
    expect(JSON.stringify(analyses)).not.toContain(
      advisory.advisory.description,
    );
    // The published 24 hour acknowledgement target, whatever the priority.
    expect(verified.next_action_due_at).toBe("2026-10-24T10:00:00.000Z");
    const event = t.sqlite
      .query(
        "SELECT kind, actor_role, detail FROM security_case_events WHERE case_id = ?",
      )
      .get(verified.id as string) as {
      kind: string;
      actor_role: string;
      detail: string;
    };
    expect(event.kind).toBe("submit");
    expect(event.actor_role).toBe("reporter");
    expect(JSON.parse(event.detail).autoAnalysis).toEqual({
      severityHint: "critical",
      lossHint: "possible",
      priority: "urgent",
      analyzer: "deterministic-v1",
    });
    // Both technical approvers get the case notice; the reporter gets only
    // the generic receipt, which asks for no acknowledgment.
    expect(t.outbox()).toEqual([
      MAINTAINER.githubId,
      REPORTER.githubId,
      MAINTAINER_2.githubId,
    ]);
    expect(
      t.sqlite
        .query(
          "SELECT template_version FROM security_notification_outbox WHERE recipient_github_id = ?",
        )
        .all(REPORTER.githubId),
    ).toEqual([{ template_version: "security-receipt-v1" }]);
    // The reporter sees the verified receipt in their case view.
    const view = await t.call(REPORTER, "GET", `security-cases/${verified.id}`);
    expect(view.body.case).toMatchObject({
      receivedAtSource: "github-verified",
      receivedAt: advisory.advisory.created_at,
      view: "reporter",
      nextStepDueAt: "2026-10-24T10:00:00.000Z",
    });
    expect(JSON.stringify(view.body)).not.toContain("autoAnalysis");
    expect(JSON.stringify(view.body)).not.toContain("urgent");
    // The grant is cleared once the receipt is verified.
    expect(t.jar(REPORTER).has("__Secure-slop_intake_grant")).toBe(false);
    // The maintainer sees GitHub-verified receipt and its evidence digest.
    const restricted = await t.call(
      MAINTAINER,
      "GET",
      `security-cases/${verified.id}`,
    );
    expect(restricted.body.case).toMatchObject({
      receivedAtSource: "github-verified",
      receiptEvidenceDigest: verified.receipt_evidence_digest,
      analysis: { state: "complete", retryable: false },
    });
  });

  test("definite GitHub refusals fail with a code, and a fixed report can be resent", async () => {
    const t = setup();
    for (const [fault, code] of [
      ["422", "invalid"],
      ["403", "forbidden"],
      ["404", "pvr-disabled"],
    ] as const) {
      const submission = await t.ready();
      t.github.faults.create = fault;
      const sent = await t.send(submission.id, 1);
      expect(sent.body.submission).toMatchObject({
        state: "failed",
        failureCode: code,
      });
      t.github.faults.create = "ok";
      const again = await t.send(
        submission.id,
        sent.body.submission?.revision as number,
      );
      expect(again.body.submission?.state).toBe("receipt-verified");
      // One verified case per root advisory; start the next program attempt.
    }
    expect(t.github.advisories).toHaveLength(3);
    expect(t.cases()).toHaveLength(3);
  });

  test("a GitHub rate limit reopens the draft and is never recorded as forbidden", async () => {
    const t = setup();
    for (const [fault, retryAfterSeconds] of [
      ["403-secondary-rate-limit", null],
      ["403-primary-rate-limit", 600],
      ["429", 90],
    ] as const) {
      const submission = await t.ready();
      t.github.faults.create = fault;
      const sent = await t.send(submission.id, 1);
      expect(sent.status).toBe(200);
      expect(sent.body.submission).toMatchObject({
        state: "draft",
        failureCode: null,
        retryAllowed: true,
        attempt: 1,
      });
      expect(sent.body.rateLimited).toEqual({ retryAfterSeconds });
      expect(t.row(submission.id)).toMatchObject({
        state: "draft",
        failure_code: null,
      });
      const kinds = (
        t.sqlite
          .query(
            "SELECT kind FROM security_submission_events WHERE submission_id = ? ORDER BY revision",
          )
          .all(submission.id) as { kind: string }[]
      ).map((event) => event.kind);
      expect(kinds.slice(-2)).toEqual(["send", "rate-limited"]);
      // GitHub kept no copy, so the reporter sends again without a reconcile.
      t.github.faults.create = "ok";
      const again = await t.send(
        submission.id,
        sent.body.submission?.revision as number,
      );
      expect(again.body.submission?.state).toBe("receipt-verified");
    }
    expect(t.github.advisories).toHaveLength(3);
    expect(t.cases()).toHaveLength(3);
  });

  test("a 404 maps to app-not-installed when the intake App is missing", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "404";
    // The App is removed after the fresh check, before the actual send.
    let installationChecks = 0;
    t.github.installation.installed = async () =>
      installationChecks++ === 0 ? "yes" : "no";
    const sent = await t.send(submission.id, 1);
    expect(sent.body.submission?.failureCode).toBe("app-not-installed");
  });

  test("an interrupted send is uncertain, never resent, and reconciled to the one copy", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "timeout-after-create";
    const sent = await t.send(submission.id, 1);
    expect(sent.status).toBe(202);
    expect(sent.body.submission?.state).toBe("uncertain");
    t.github.faults.create = "ok";
    const resend = await t.send(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(resend.status).toBe(409);
    expect(resend.body.error).toBe("reconcile_required");
    expect(t.github.counts.posts).toBe(1);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    expect(t.github.counts.posts).toBe(1);
    expect(t.github.advisories).toHaveLength(1);
    expect(t.cases()).toHaveLength(1);
  });

  test("a complete empty listing reopens the draft for exactly one new send", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "5xx-before-create";
    const sent = await t.send(submission.id, 1);
    expect(sent.body.submission?.state).toBe("uncertain");
    t.advance(RECONCILE_QUIET_MS + 1000);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission).toMatchObject({
      state: "draft",
      retryAllowed: true,
      attempt: 1,
    });
    t.github.faults.create = "ok";
    const again = await t.send(
      submission.id,
      reconciled.body.submission?.revision as number,
    );
    expect(again.body.submission).toMatchObject({
      state: "receipt-verified",
      attempt: 2,
    });
    expect(t.github.counts.posts).toBe(2);
    expect(t.github.advisories).toHaveLength(1);
    // The marker stayed the same across attempts.
    expect(t.github.advisories[0].advisory.description).toContain(
      t.row(submission.id).marker as string,
    );
  });

  test("an incomplete or failed listing keeps the submission uncertain", async () => {
    for (const listFault of ["error", "paginated"] as const) {
      const t = setup();
      const submission = await t.ready();
      t.github.faults.create = "5xx-before-create";
      // Another advisory exists so pagination has a next page.
      t.github.seed(REPO, { id: 5, login: "someone" }, { summary: "other" });
      t.github.seed(
        REPO,
        { id: 6, login: "someone-else" },
        { summary: "other" },
      );
      const sent = await t.send(submission.id, 1);
      t.github.faults.list = listFault;
      const reconciled = await t.reconcile(
        submission.id,
        sent.body.submission?.revision as number,
      );
      expect(reconciled.status).toBe(202);
      expect(reconciled.body.submission).toMatchObject({
        state: "uncertain",
        retryAllowed: false,
      });
      const resend = await t.send(
        submission.id,
        reconciled.body.submission?.revision as number,
      );
      expect(resend.body.error).toBe("reconcile_required");
      expect(t.github.counts.posts).toBe(1);
    }
  });

  test("duplicate copies adopt the earliest and tell only the technical approvers", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "duplicate-after-create";
    const sent = await t.send(submission.id, 1);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    const [first, second] = t.github.advisories.map((a) => a.advisory);
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0].advisory_ghsa).toBe(first.ghsa_id);
    const event = t.sqlite
      .query("SELECT detail FROM security_case_events WHERE case_id = ?")
      .get(t.cases()[0].id as string) as { detail: string };
    expect(JSON.parse(event.detail).duplicateAdvisories).toEqual([
      second.ghsa_id,
    ]);
    // The reporter's own view never shows the duplicate detail.
    const view = await t.call(
      REPORTER,
      "GET",
      `security-cases/${t.cases()[0].id}`,
    );
    expect(JSON.stringify(view.body)).not.toContain(second.ghsa_id);
    expect(t.outbox()).toEqual([
      MAINTAINER.githubId,
      REPORTER.githubId,
      MAINTAINER_2.githubId,
    ]);
  });

  test("a marker match authored by someone else is ignored", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "5xx-before-create";
    const sent = await t.send(submission.id, 1);
    const row = t.row(submission.id);
    t.github.seed(
      REPO,
      { id: Number(OTHER.githubId), login: OTHER.githubLogin },
      {
        summary: "copied",
        description: `copy\n\nReport reference: ${row.marker}`,
      },
    );
    t.advance(RECONCILE_QUIET_MS + 1000);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission).toMatchObject({
      state: "draft",
      retryAllowed: true,
    });
    expect(t.cases()).toHaveLength(0);
  });

  test("a send that never returned becomes uncertain after 60 seconds and is not resent", async () => {
    const t = setup();
    const submission = await t.ready();
    // The worker died after committing `submitting`.
    t.sqlite
      .query(
        "UPDATE security_submissions SET state = 'submitting', attempt = 1, attempt_started_at = ?, revision = revision + 1 WHERE id = ?",
      )
      .run(START, submission.id);
    t.advance(30_000);
    const early = await t.send(submission.id, 2);
    expect(early.body.error).toBe("submission_in_progress");
    t.advance(31_000);
    const late = await t.send(submission.id, 2);
    expect(late.body.error).toBe("reconcile_required");
    expect(t.row(submission.id).state).toBe("uncertain");
    expect(t.github.counts.posts).toBe(0);
    t.advance(RECONCILE_QUIET_MS);
    const reconciled = await t.reconcile(submission.id, 3);
    expect(reconciled.body.submission).toMatchObject({
      state: "draft",
      retryAllowed: true,
    });
  });

  test("a concurrent double send makes one POST", async () => {
    const t = setup();
    const submission = await t.ready();
    // Another tab committed its send between this request's read and write.
    t.setBeforeBatch(() => {
      t.sqlite
        .query(
          "UPDATE security_submissions SET state = 'submitting', attempt = 1, attempt_started_at = ?, revision = revision + 1 WHERE id = ?",
        )
        .run(START, submission.id);
      t.sqlite
        .query(
          "INSERT INTO security_submission_events (submission_id, revision, kind, at) VALUES (?, 2, 'send', ?)",
        )
        .run(submission.id, START);
    });
    const lost = await t.send(submission.id, 1);
    expect(lost.status).toBe(409);
    expect(lost.body.error).toBe("stale_revision");
    expect(t.github.counts.posts).toBe(0);
    // A replay of that same revision returns the current state.
    const replay = await t.send(submission.id, 1);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ replayed: true });
    expect(replay.body.submission?.state).toBe("submitting");
    expect(t.github.counts.posts).toBe(0);
  });

  test("an empty listing right after the attempt keeps it uncertain, and a late copy is then adopted", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "5xx-before-create";
    const sent = await t.send(submission.id, 1);
    expect(sent.body.submission?.reconcileAfter).toBe(
      new Date(Date.parse(START) + RECONCILE_QUIET_MS).toISOString(),
    );
    // GitHub has not shown the copy yet.
    t.advance(5_000);
    const early = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(early.status).toBe(202);
    expect(early.body.submission).toMatchObject({
      state: "uncertain",
      retryAllowed: false,
    });
    const resend = await t.send(
      submission.id,
      early.body.submission?.revision as number,
    );
    expect(resend.body.error).toBe("reconcile_required");
    // The cut-off send lands late.
    const marker = t.row(submission.id).marker as string;
    const late = t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      { summary: "late", description: `late\n\nReport reference: ${marker}` },
      new Date(Date.parse(START) + 2_000).toISOString(),
    );
    t.advance(RECONCILE_QUIET_MS);
    const reconciled = await t.reconcile(
      submission.id,
      early.body.submission?.revision as number,
    );
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0].advisory_ghsa).toBe(late.ghsa_id);
    expect(t.github.counts.posts).toBe(1);
  });

  test("a resend that races a late copy adopts the earliest and records the duplicate", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.create = "5xx-before-create";
    const sent = await t.send(submission.id, 1);
    t.advance(RECONCILE_QUIET_MS + 1000);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission?.state).toBe("draft");
    // The first attempt's copy becomes visible only after the empty listing.
    const marker = t.row(submission.id).marker as string;
    const late = t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      { summary: "late", description: `late\n\nReport reference: ${marker}` },
      new Date(Date.parse(START) + 2_000).toISOString(),
    );
    t.github.faults.create = "ok";
    const again = await t.send(
      submission.id,
      reconciled.body.submission?.revision as number,
    );
    expect(again.body.submission?.state).toBe("receipt-verified");
    const created = t.github.advisories.find(
      (entry) => entry.advisory.ghsa_id !== late.ghsa_id,
    )?.advisory.ghsa_id;
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0]).toMatchObject({
      advisory_ghsa: late.ghsa_id,
      received_at: late.created_at,
    });
    const event = t.sqlite
      .query("SELECT detail FROM security_case_events WHERE case_id = ?")
      .get(t.cases()[0].id as string) as { detail: string };
    expect(JSON.parse(event.detail).duplicateAdvisories).toEqual([created]);
  });

  test("a submitted report GitHub never lets Slop verify stops blocking new reports", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.get = "error";
    const sent = await t.send(submission.id, 1);
    expect(sent.body.submission?.state).toBe("submitted");
    expect((await t.create()).body.error).toBe("submission_in_flight");
    t.advance(SUBMITTED_LIMIT_MS + 1000);
    const listed = await t.call(REPORTER, "GET", "security-submissions");
    expect(
      (listed.body.submissions as { id: string }[]).find(
        (entry) => entry.id === submission.id,
      ),
    ).toMatchObject({ state: "failed", failureCode: "unverifiable" });
    // It holds a GitHub advisory, so it is never resent.
    const row = t.row(submission.id);
    const resend = await t.send(submission.id, row.revision as number);
    expect(resend.body.error).toBe("already_submitted");
    expect(t.github.counts.posts).toBe(1);
    expect((await t.create()).status).toBe(201);
  });

  test("a 201 that is not the reporter's well-formed advisory is uncertain", async () => {
    for (const fault of ["wrong-author-201", "malformed-201"] as const) {
      const t = setup();
      const submission = await t.ready();
      t.github.faults.create = fault;
      const sent = await t.send(submission.id, 1);
      expect(sent.body.submission?.state).toBe("uncertain");
      expect(t.cases()).toHaveLength(0);
    }
  });

  test("an unreadable advisory after creation retries the read only", async () => {
    const t = setup();
    const submission = await t.ready();
    t.github.faults.get = "error";
    const sent = await t.send(submission.id, 1);
    expect(sent.status).toBe(202);
    expect(sent.body.submission?.state).toBe("submitted");
    t.github.faults.get = "ok";
    const resend = await t.send(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(resend.body.error).toBe("already_submitted");
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    expect(t.github.counts.posts).toBe(1);
  });
});

describe("private intake: direct GitHub reports", () => {
  const direct = async (
    t: ReturnType<typeof setup>,
    author: Account,
    createdAt = "2026-10-20T08:30:00.000Z",
    extra?: Parameters<ReturnType<typeof setup>["github"]["seed"]>[4],
  ) => {
    const advisory = t.github.seed(
      REPO,
      { id: Number(author.githubId), login: author.githubLogin },
      {
        summary: "Filed on GitHub",
        description: `Direct ${SENTINEL}`,
        severity: "high",
      },
      createdAt,
      extra,
    );
    const created = await t.create(REPORTER, {
      origin: "direct",
      advisory: advisory.ghsa_id,
    });
    expect(created.status).toBe(201);
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const verified = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${created.body.submission?.id}/verify`,
      { expectedRevision: 1 },
    );
    return { advisory, verified };
  };

  test("the reporter's own advisory is verified with GitHub's original time", async () => {
    const t = setup();
    const { advisory, verified } = await direct(t, REPORTER);
    expect(verified.body.submission?.state).toBe("receipt-verified");
    const [row] = t.cases();
    expect(row).toMatchObject({
      advisory_ghsa: advisory.ghsa_id,
      received_at: "2026-10-20T08:30:00.000Z",
      received_at_source: "github-verified",
    });
    const event = t.sqlite
      .query(
        "SELECT kind, actor_github_id, actor_role, detail FROM security_case_events WHERE case_id = ?",
      )
      .get(row.id as string) as {
      kind: string;
      actor_github_id: string;
      actor_role: string;
      detail: string;
    };
    // The reporter's own action is linking their report; GitHub's record,
    // not the reporter, verified the receipt.
    expect(event).toMatchObject({
      kind: "submit-direct",
      actor_github_id: REPORTER.githubId,
      actor_role: "reporter",
    });
    expect(JSON.parse(event.detail)).toMatchObject({
      verifiedBy: "github",
      receivedAtSource: "github-verified",
    });
    expect(row.verified_by_github_id).toBe("github");
  });

  test("a reporter credit on someone else's advisory is not authorship, and the author can still verify", async () => {
    const t = setup();
    // A maintainer credited REPORTER on OTHER's private report.
    const { advisory, verified } = await direct(t, OTHER, undefined, {
      credits_detailed: [
        {
          user: { id: Number(OTHER.githubId), login: OTHER.githubLogin },
          type: "reporter",
        },
        {
          user: { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
          type: "reporter",
        },
      ],
    });
    expect(verified.body.submission).toMatchObject({
      state: "failed",
      failureCode: "author-mismatch",
    });
    expect(t.cases()).toHaveLength(0);
    // The real author is not locked out.
    const created = await t.create(OTHER, {
      origin: "direct",
      advisory: advisory.ghsa_id,
    });
    await t.authorize(OTHER, created.body.authorizeUrl as string);
    const own = await t.call(
      OTHER,
      "POST",
      `security-submissions/${created.body.submission?.id}/verify`,
      { expectedRevision: 1 },
    );
    expect(own.body.submission?.state).toBe("receipt-verified");
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0].reporter_github_id).toBe(OTHER.githubId);
  });

  test("an advisory that is not a live private report is never an automatic receipt", async () => {
    for (const extra of [
      // A repository advisory the reporter drafted as a maintainer.
      { submission: null },
      { state: "closed" },
      { state: "withdrawn" },
    ]) {
      const t = setup();
      const { verified } = await direct(t, REPORTER, undefined, extra);
      expect(verified.body.submission).toMatchObject({
        state: "failed",
        failureCode: "not-private-report",
      });
      expect(t.cases()).toHaveLength(0);
      expect(t.outbox()).toEqual([]);
    }
  });

  test("two concurrent verifications of one submission both answer with the one verified case", async () => {
    const t = setup();
    const advisory = t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      { summary: "Filed on GitHub", description: "Direct" },
      "2026-10-20T08:30:00.000Z",
    );
    const created = await t.create(REPORTER, {
      origin: "direct",
      advisory: advisory.ghsa_id,
    });
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const path = `security-submissions/${created.body.submission?.id}/verify`;
    const results = await Promise.all([
      t.call(REPORTER, "POST", path, { expectedRevision: 1 }),
      t.call(REPORTER, "POST", path, { expectedRevision: 1 }),
    ]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body.submission?.state).toBe("receipt-verified");
    }
    expect(t.cases()).toHaveLength(1);
    expect(t.row(created.body.submission?.id as string)).toMatchObject({
      state: "receipt-verified",
      failure_code: null,
    });
  });

  test("another user's advisory fails as author-mismatch with no case", async () => {
    const t = setup();
    const { verified } = await direct(t, OTHER);
    expect(verified.body.submission).toMatchObject({
      state: "failed",
      failureCode: "author-mismatch",
    });
    expect(t.cases()).toHaveLength(0);
  });

  test("an advisory GitHub cannot find fails as not-found", async () => {
    const t = setup();
    const created = await t.create(REPORTER, {
      origin: "direct",
      advisory: "GHSA-2222-3333-4444",
    });
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const verified = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${created.body.submission?.id}/verify`,
      { expectedRevision: 1 },
    );
    expect(verified.body.submission).toMatchObject({
      state: "failed",
      failureCode: "not-found",
    });
  });

  test("an advisory already recorded for another case returns 409 without leaking it", async () => {
    const t = setup();
    const advisory = t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      { summary: "Filed", description: "x" },
      "2026-10-20T08:30:00.000Z",
    );
    const recorded = await t.call(MAINTAINER, "POST", "security-cases", {
      mode: "record",
      projectId: PROJECT,
      advisory: advisory.ghsa_id,
      reporterGithubId: OTHER.githubId,
      reporterGithubLogin: OTHER.githubLogin,
      receivedAt: "2026-10-20T09:00:00.000Z",
      confirmation: true,
      idempotencyKey: t.key(),
    });
    expect(recorded.status).toBe(201);
    const created = await t.create(REPORTER, {
      origin: "direct",
      advisory: advisory.ghsa_id,
    });
    await t.authorize(REPORTER, created.body.authorizeUrl as string);
    const verified = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${created.body.submission?.id}/verify`,
      { expectedRevision: 1 },
    );
    expect(verified.status).toBe(409);
    expect(verified.body.error).toBe("advisory_already_recorded");
    expect(JSON.stringify(verified.body)).not.toContain("sc_");
    expect(t.row(created.body.submission?.id as string)).toMatchObject({
      state: "failed",
      failure_code: "already-recorded",
    });
    expect(t.cases()).toHaveLength(1);
  });
});

describe("private intake: analysis, access, privacy and mode", () => {
  test("only the reporter can reach a submission", async () => {
    const t = setup();
    const submission = await t.ready();
    for (const outsider of [MAINTAINER, ADMIN, OTHER]) {
      for (const action of ["send", "reconcile", "verify", "authorize"]) {
        const response = await t.call(
          outsider,
          "POST",
          `security-submissions/${submission.id}/${action}`,
          action === "authorize" ? {} : { expectedRevision: 1, report: REPORT },
        );
        expect(response.status).toBe(404);
      }
      const listed = await t.call(outsider, "GET", "security-submissions");
      expect(listed.body.recipientGithubId).toBe(outsider.githubId);
      expect(listed.body.submissions).toEqual([]);
    }
    const own = await t.call(REPORTER, "GET", "security-submissions");
    expect(own.body.recipientGithubId).toBe(REPORTER.githubId);
    expect((own.body.submissions as { id: string }[]).map((s) => s.id)).toEqual(
      [submission.id],
    );
    expect(t.github.counts.posts).toBe(0);
  });

  test("an idle draft is abandoned after 24 hours", async () => {
    const t = setup();
    const submission = await t.ready();
    t.advance(24 * 60 * 60 * 1000 + 1000);
    const listed = await t.call(REPORTER, "GET", "security-submissions");
    expect((listed.body.submissions as { state: string }[])[0].state).toBe(
      "abandoned",
    );
    const sent = await t.send(submission.id, 2);
    expect(sent.body.error).toBe("submission_abandoned");
  });

  describe("privacy", () => {
    const logs: string[] = [];
    let spies: ReturnType<typeof spyOn>[] = [];
    afterEach(() => {
      for (const spy of spies) spy.mockRestore();
      spies = [];
    });

    test("report content and tokens never reach D1, logs or responses", async () => {
      spies = (["log", "error", "warn", "info", "debug"] as const).map(
        (level) =>
          spyOn(console, level).mockImplementation((...args: unknown[]) => {
            logs.push(args.map(String).join(" "));
          }),
      );
      const t = setup();
      // Every path: refusal, uncertain + reconcile, duplicate, happy path.
      const one = await t.ready();
      t.github.faults.create = "422";
      const failed = await t.send(one.id, 1);
      t.github.faults.create = "timeout-after-create";
      const uncertain = await t.send(
        one.id,
        failed.body.submission?.revision as number,
      );
      t.github.faults.create = "ok";
      await t.reconcile(one.id, uncertain.body.submission?.revision as number);
      const two = await t.ready();
      t.github.faults.create = "duplicate-after-create";
      const dup = await t.send(two.id, 1);
      await t.reconcile(two.id, dup.body.submission?.revision as number);
      const three = await t.ready();
      t.github.faults.create = "ok";
      await t.send(three.id, 1, {
        ...REPORT,
        summary: `bad ${SENTINEL}`,
        description: "",
      });
      await t.send(three.id, 1);
      expect(t.cases()).toHaveLength(3);
      const tokens = ["ghu_fake"];
      const tables = (
        t.sqlite
          .query("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as { name: string }[]
      ).map((r) => r.name);
      const dump = tables
        .map((name) =>
          JSON.stringify(t.sqlite.query(`SELECT * FROM "${name}"`).all()),
        )
        .join("\n");
      expect(dump).toContain("security-case:");
      for (const secret of [SENTINEL, ...tokens]) {
        expect(dump).not.toContain(secret);
        expect(logs.join("\n")).not.toContain(secret);
        expect(t.responses.join("\n")).not.toContain(secret);
      }
      // The outbox and inbox hold only generic notices.
      const notices = t.sqlite
        .query("SELECT subject, detail, action_path FROM notifications")
        .all() as {
        subject: string;
        detail: string | null;
        action_path: string;
      }[];
      expect(
        notices.every(
          (n) =>
            /^sc_[A-Za-z0-9_-]{8,72}$/u.test(n.subject) &&
            n.detail === null &&
            n.action_path === `/security?case=${encodeURIComponent(n.subject)}`,
        ),
      ).toBe(true);
    });
  });

  test("with intake off every submission route is closed, the list is empty and readiness says off", async () => {
    const t = setup({ mode: "off" });
    const listed = await t.call(REPORTER, "GET", "security-submissions");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual({
      recipientGithubId: REPORTER.githubId,
      automatic: false,
      submissions: [],
    });
    for (const [method, path] of [
      ["POST", "security-submissions"],
      ["POST", "security-submissions/ss_case00000001/send"],
      ["GET", "security-submissions/authorize/callback?code=a&state=b"],
    ] as const) {
      const response = await t.call(
        REPORTER,
        method,
        path,
        method === "POST" ? {} : undefined,
      );
      expect(response.status).toBe(404);
    }
    const readiness = await t.call(
      REPORTER,
      "GET",
      `security-programs/${PROJECT}/intake`,
    );
    expect(readiness.body).toMatchObject({
      state: "unavailable",
      stale: true,
      automatic: "off",
    });
    expect(readiness.body.handoffUrl).toBeNull();
    expect(t.reportingReads()).toBe(0);
  });

  test("readiness reports automatic intake only when the App is installed and PVR is on", async () => {
    const on = setup();
    await on.refresh();
    expect(
      (await on.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .body.automatic,
    ).toBe("ready");
    on.github.installation.installed = async () => "no";
    on.advance(1);
    await on.refresh();
    expect(
      (await on.call(REPORTER, "GET", `security-programs/${PROJECT}/intake`))
        .body.automatic,
    ).toBe("app-not-installed");
    // The App-less fallback refuses automatic creation; no public route.
    const refused = await on.create();
    expect(refused.body.error).toBe("intake_unavailable");
    const disabled = setup({ pvr: false });
    await disabled.refresh();
    const readiness = await disabled.call(
      REPORTER,
      "GET",
      `security-programs/${PROJECT}/intake`,
    );
    expect(readiness.body).toMatchObject({
      state: "disabled",
      automatic: "unavailable",
      handoffUrl: null,
    });
    expect((await disabled.create()).body.error).toBe("intake_unavailable");
  });
});

test("a participation ban stops new private reports and sending an existing draft", async () => {
  const t = setup();
  const draft = await t.ready();
  seedParticipationBan(t.sqlite, REPORTER, ADMIN, START);
  expect((await t.create()).status).toBe(403);
  expect((await t.send(draft.id, draft.revision)).status).toBe(403);
  expect(t.row(draft.id).state).toBe("draft");
  expect(t.github.advisories).toHaveLength(0);
  expect((await t.call(REPORTER, "GET", "security-submissions")).status).toBe(
    200,
  );
});

test("a ban before the send commits prevents the private GitHub request", async () => {
  const t = setup();
  const draft = await t.ready();
  t.setBeforeBatch(() =>
    seedParticipationBan(t.sqlite, REPORTER, ADMIN, START),
  );
  expect((await t.send(draft.id, draft.revision)).status).toBe(403);
  expect(t.row(draft.id).state).toBe("draft");
  expect(t.github.advisories).toHaveLength(0);
});

test("a concurrent ban leaves no new private submission or creation event", async () => {
  const t = setup();
  t.setBeforeBatch(() =>
    seedParticipationBan(t.sqlite, REPORTER, ADMIN, START),
  );
  expect((await t.create()).status).toBe(403);
  expect(
    t.sqlite.query("SELECT id FROM security_submissions").all(),
  ).toHaveLength(0);
  expect(
    t.sqlite
      .query("SELECT submission_id FROM security_submission_events")
      .all(),
  ).toHaveLength(0);
});

test("a banned reporter can reconcile a report GitHub already received", async () => {
  const t = setup();
  const draft = await t.ready();
  t.github.faults.create = "timeout-after-create";
  const sent = await t.send(draft.id, draft.revision);
  expect(sent.status).toBe(202);
  seedParticipationBan(t.sqlite, REPORTER, ADMIN, START);
  if (!sent.body.submission) throw new Error("Expected a submission response");
  const reconciled = await t.reconcile(draft.id, sent.body.submission.revision);
  expect(reconciled.status).toBe(200);
  expect(reconciled.body.submission?.state).toBe("receipt-verified");
  expect(t.github.counts.posts).toBe(1);
  expect(t.cases()).toHaveLength(1);
});

function quarantineProject(t: ReturnType<typeof setup>) {
  const digest = (
    t.sqlite
      .query("SELECT manifest_sha256 FROM projects WHERE id = ?")
      .get(PROJECT) as { manifest_sha256: string }
  ).manifest_sha256;
  t.sqlite
    .query(`INSERT INTO project_enforcements (id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
    VALUES ('enf_peer_quarantine',?,1,'quarantine','quarantined','none','Synthetic restriction','private-fixture','700000001','["example/bounty"]',?,?,NULL,'project-moderator','admin-panel',1,?,NULL,NULL,'revision_pending',?)`)
    .run(PROJECT, ADMIN.githubId, ADMIN.githubLogin, digest, START);
}

test("an accepted private report still reconciles after quarantine", async () => {
  const t = setup();
  const draft = await t.ready();
  t.github.faults.create = "timeout-after-create";
  const sent = await t.send(draft.id, draft.revision);
  expect(sent.status).toBe(202);
  expect(t.github.counts.posts).toBe(1);
  quarantineProject(t);
  if (!sent.body.submission) throw new Error("Missing submission after send");
  const result = await t.reconcile(draft.id, sent.body.submission.revision);
  expect(result.status).toBe(200);
  expect(result.body.submission?.state).toBe("receipt-verified");
  expect(t.github.counts.posts).toBe(1);
  expect(t.cases()).toHaveLength(1);
});

test("registered researcher can start a private report on a quarantined project", async () => {
  const t = setup();
  quarantineProject(t);
  const result = await t.create();
  expect(result.status).toBe(201);
});

describe("optional GitHub forwarding of a saved report", () => {
  test("retained legacy drafts share the screening budget and verify a grant before paid work", async () => {
    const options = { durable: false };
    const t = setup(options);
    const draft = await t.ready();
    options.durable = true;
    let calls = 0;
    t.analyzer.screen = async () => {
      calls++;
      return {
        decision: "needs-information",
        reason: "More evidence is required.",
      };
    };
    for (let index = 0; index < 10; index++) {
      const response = await t.send(draft.id, draft.revision);
      expect(response.status).toBe(409);
      expect(response.body.error).toBe("screening_required");
    }
    const refused = await t.send(draft.id, draft.revision);
    expect({ status: refused.status, calls }).toEqual({
      status: 429,
      calls: 10,
    });
    expect(refused.body.error).toBe("intake_rate_limited");
    expect(t.github.counts.posts).toBe(0);

    const noGrantOptions = { durable: false };
    const noGrant = setup(noGrantOptions);
    const unapproved = await noGrant.create();
    if (!unapproved.body.submission) throw new Error("Missing legacy draft");
    noGrantOptions.durable = true;
    let unapprovedCalls = 0;
    noGrant.analyzer.screen = async () => {
      unapprovedCalls++;
      return { decision: "legitimate", reason: "Synthetic screening." };
    };
    const missing = await noGrant.send(
      unapproved.body.submission.id,
      unapproved.body.submission.revision,
    );
    expect(missing.body.error).toBe("grant_required");
    expect(unapprovedCalls).toBe(0);
  });

  test("preserves the Slop receipt and sends the saved version once after authorization", async () => {
    const t = setup({ durable: true });
    const accepted = await t.create(REPORTER, { report: REPORT });
    expect(accepted.status).toBe(201);
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const original = t.cases()[0];
    expect(original.received_at_source).toBe("slop-received");
    expect(original.advisory_ghsa).toBeNull();
    t.advance(3600000);
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    expect(authorization.status).toBe(200);
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.status).toBe(200);
    expect(sent.body.submission?.state).toBe("receipt-verified");
    expect(t.github.counts.posts).toBe(1);
    expect(t.cases()).toHaveLength(1);
    expect(t.cases()[0]).toEqual(original);
    const forwarded = sent.body.submission?.advisory as { ghsa: string };
    const claimed = await t.call(REPORTER, "POST", "security-cases", {
      mode: "claim",
      projectId: PROJECT,
      advisory: forwarded.ghsa,
      idempotencyKey: t.key(),
    });
    expect(claimed.status).toBe(200);
    const recorded = await t.call(MAINTAINER, "POST", "security-cases", {
      mode: "record",
      projectId: PROJECT,
      advisory: forwarded.ghsa,
      idempotencyKey: t.key(),
      reporterGithubId: REPORTER.githubId,
      reporterGithubLogin: REPORTER.githubLogin,
      receivedAt: START,
      confirmation: true,
    });
    expect(recorded.status).toBe(200);
    expect(t.cases()).toHaveLength(1);
    const repeated = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(repeated.status).toBe(200);
    expect(t.github.counts.posts).toBe(1);
    const viewed = await t.call(
      REPORTER,
      "GET",
      `security-cases/${original.id}`,
    );
    expect(
      (viewed.body.case as { advisory: { ghsa: string } }).advisory.ghsa,
    ).toBeTruthy();
  });
  test("an import before the forward settles leaves GitHub's copy to the saved report's case", async () => {
    const t = setup({ durable: true });
    const accepted = await t.create(REPORTER, { report: REPORT });
    expect(accepted.status).toBe(201);
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const [original] = t.cases();
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    // GitHub stores the forward, but its answer is lost.
    t.github.faults.create = "timeout-after-create";
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.body.submission?.state).toBe("uncertain");
    expect(t.github.advisories).toHaveLength(1);
    // A report the same researcher filed directly on GitHub is new.
    t.github.seed(
      REPO,
      { id: Number(REPORTER.githubId), login: REPORTER.githubLogin },
      {
        summary: "Router accepts an expired signature",
        description: "A second, unrelated report filed directly on GitHub.",
      },
    );
    const imported = await t.call(MAINTAINER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(imported.body).toEqual({ state: "ok", received: 1 });
    expect(t.cases()).toHaveLength(2);
    // The researcher's reconcile links the forward to the saved report's case.
    t.advance(RECONCILE_QUIET_MS + 1000);
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    expect(t.row(submission.id).case_id).toBe(original.id);
    const again = await t.call(MAINTAINER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(again.body).toEqual({ state: "ok", received: 0 });
    expect(t.cases()).toHaveLength(2);
  });
  test("an import leaves GitHub's copy of a full-length saved report to its case", async () => {
    const t = setup({ durable: true });
    // The longest description Slop accepts puts the reference line past the
    // part of the text the import reader keeps for analysis.
    const accepted = await t.create(REPORTER, {
      report: {
        ...REPORT,
        description: REPORT.description.padEnd(65_000, "."),
      },
    });
    expect(accepted.status).toBe(201);
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    t.github.faults.create = "timeout-after-create";
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.body.submission?.state).toBe("uncertain");
    expect(t.github.advisories).toHaveLength(1);
    const imported = await t.call(MAINTAINER, "POST", "security-cases", {
      mode: "import",
      projectId: PROJECT,
    });
    expect(imported.body).toEqual({ state: "ok", received: 0 });
    expect(t.cases()).toHaveLength(1);
  });
  test("a human hold prevents forwarding even after earlier GitHub authorization", async () => {
    const t = setup({ durable: true });
    const accepted = await t.create(REPORTER, { report: REPORT });
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    const intake = submission.intake as { revision: number };
    const held = await t.call(
      MAINTAINER,
      "POST",
      `security-submissions/${submission.id}/review`,
      {
        expectedRevision: intake.revision,
        decision: "request-information",
        reason: "Please show the isolated reproduction before forwarding.",
      },
    );
    expect(held.status).toBe(200);
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.status).toBe(409);
    expect(sent.body.error).toBe("screening_required");
    expect(t.github.counts.posts).toBe(0);
  });
  test("a forward that never returned becomes uncertain in the reporter's list and report and reconciles to the saved case", async () => {
    for (const view of ["list", "report"] as const) {
      const t = setup({ durable: true });
      const accepted = await t.create(REPORTER, { report: REPORT });
      const submission = accepted.body.submission as NonNullable<
        Body["submission"]
      >;
      const original = t.cases()[0];
      const authorization = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/authorize`,
        {},
      );
      await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
      // GitHub stored the report, then D1 refused the receipt write once.
      const failAfterCreate = (): void =>
        t.setBeforeBatch(() => {
          if (
            t.github.advisories.length === 0 ||
            t.row(submission.id).state !== "submitting"
          )
            return failAfterCreate();
          throw new Error("D1 unavailable");
        });
      failAfterCreate();
      const sent = await t.call(
        REPORTER,
        "POST",
        `security-submissions/${submission.id}/send`,
        { expectedRevision: submission.revision },
      );
      expect(sent.status).toBe(500);
      expect(t.row(submission.id).state).toBe("submitting");
      t.advance(61_000);
      // The page offers "Check again" only for an uncertain or submitted row.
      const shown =
        view === "list"
          ? (
              (await t.call(REPORTER, "GET", "security-submissions")).body
                .submissions as NonNullable<Body["submission"]>[]
            ).find((entry) => entry.id === submission.id)
          : (
              await t.call(
                REPORTER,
                "GET",
                `security-submissions/${submission.id}`,
              )
            ).body.submission;
      expect({ view, state: shown?.state }).toEqual({
        view,
        state: "uncertain",
      });
      const reconciled = await t.reconcile(
        submission.id,
        shown?.revision as number,
      );
      expect(reconciled.status).toBe(200);
      expect(reconciled.body.submission?.state).toBe("receipt-verified");
      expect(t.github.counts.posts).toBe(1);
      expect(t.cases()).toEqual([original]);
      const viewed = await t.call(
        REPORTER,
        "GET",
        `security-cases/${original.id}`,
      );
      expect(
        (viewed.body.case as { advisory: { ghsa: string } }).advisory.ghsa,
      ).toBe(t.github.advisories[0].advisory.ghsa_id);
    }
  });
  test("a list read that settles a forward still in flight leaves its GitHub copy for reconcile to adopt", async () => {
    const t = setup({ durable: true });
    const accepted = await t.create(REPORTER, { report: REPORT });
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const original = t.cases()[0];
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    // GitHub stored the report; the receipt write waits past the timeout
    // while the reporter loads the list.
    let listed: string | undefined;
    const listMidForward = (): void =>
      t.setBeforeBatch(async () => {
        if (
          t.github.advisories.length === 0 ||
          t.row(submission.id).state !== "submitting"
        )
          return listMidForward();
        t.advance(61_000);
        listed = (
          (await t.call(REPORTER, "GET", "security-submissions")).body
            .submissions as NonNullable<Body["submission"]>[]
        ).find((entry) => entry.id === submission.id)?.state;
      });
    listMidForward();
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(listed).toBe("uncertain");
    expect(sent.status).toBe(202);
    expect(sent.body.submission?.state).toBe("uncertain");
    expect(t.row(submission.id).advisory_ghsa).toBeNull();
    const reconciled = await t.reconcile(
      submission.id,
      sent.body.submission?.revision as number,
    );
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.submission?.state).toBe("receipt-verified");
    expect(t.row(submission.id).advisory_ghsa).toBe(
      t.github.advisories[0].advisory.ghsa_id,
    );
    expect(t.github.counts.posts).toBe(1);
    expect(t.cases()).toEqual([original]);
  });
  test("a report whose settle fails is listed as stored next to the reporter's other reports", async () => {
    const t = setup({ durable: true });
    const accepted = await t.create(REPORTER, { report: REPORT });
    const submission = accepted.body.submission as NonNullable<
      Body["submission"]
    >;
    const authorization = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/authorize`,
      {},
    );
    await t.authorize(REPORTER, authorization.body.authorizeUrl as string);
    // GitHub stored the report, then D1 refused the receipt write once.
    const failAfterCreate = (): void =>
      t.setBeforeBatch(() => {
        if (
          t.github.advisories.length === 0 ||
          t.row(submission.id).state !== "submitting"
        )
          return failAfterCreate();
        throw new Error("D1 unavailable");
      });
    failAfterCreate();
    const sent = await t.call(
      REPORTER,
      "POST",
      `security-submissions/${submission.id}/send`,
      { expectedRevision: submission.revision },
    );
    expect(sent.status).toBe(500);
    const other = (
      await t.create(REPORTER, {
        report: { ...REPORT, summary: `Second report ${SENTINEL}` },
      })
    ).body.submission as NonNullable<Body["submission"]>;
    t.advance(61_000);
    const states = async () => {
      const listed = await t.call(REPORTER, "GET", "security-submissions");
      return {
        status: listed.status,
        states: Object.fromEntries(
          (
            (listed.body.submissions ?? []) as NonNullable<Body["submission"]>[]
          ).map((entry) => [entry.id, entry.state]),
        ),
      };
    };
    // D1 refuses the one settle write this list makes.
    t.setBeforeBatch(() => {
      throw new Error("D1 unavailable");
    });
    expect(await states()).toEqual({
      status: 200,
      states: { [submission.id]: "submitting", [other.id]: "draft" },
    });
    expect(await states()).toEqual({
      status: 200,
      states: { [submission.id]: "uncertain", [other.id]: "draft" },
    });
  });
});
