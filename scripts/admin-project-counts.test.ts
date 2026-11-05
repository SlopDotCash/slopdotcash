// The D1 project registry API on the real migrations: cached public reads,
// purge on admin writes, server-verified reward assets, the GitHub ownership
// check, submission limits, exact revision bytes, the generated-skill
// activation gate, the security-vetting gate, same-origin GitHub lookups,
// and ADM-06 enforcement.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import type { RepositoryControl } from "../backend/projects/contracts";
import type { EdgeCache } from "../backend/projects/edge-cache";
import { projectRestriction } from "../backend/projects/enforcement";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { readSecurityProgramFunds } from "../backend/security/program-funds";
import { vettingScanRequester } from "../backend/vetting/handler";
import {
  CloudflareVettingPersistence,
  type VettingPin,
  vettedContentSha256,
} from "../backend/vetting/persistence";
import { parseVettingResult } from "../backend/vetting/result";
import type { RepositoryAccess } from "../src/lib/project-contracts";
import { sha256Hex } from "../src/lib/project-skill-publication.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { vettingResult } from "../tests/vetting-fixtures";

const ORIGIN = "https://slop.cash";
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const MODERATOR = { githubId: "900000003", githubLogin: "e2e-moderator" };
const TOKEN = "0x1111111111111111111111111111111111111111";

class MemoryCache implements EdgeCache {
  readonly entries = new Map<string, Response>();
  async match(request: Request) {
    return this.entries.get(request.url)?.clone();
  }
  async put(request: Request, response: Response) {
    this.entries.set(request.url, response.clone());
  }
  async delete(request: Request) {
    return this.entries.delete(request.url);
  }
}

let persistence: CloudflareProjectPersistence;
let _sqlite: Database;
let db: ReturnType<typeof sqliteD1>["db"];

import { localVettingEvidence } from "../tests/vetting-evidence-fixture";

let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
afterEach(async () => {
  await retained?.dispose();
});
let vetting: CloudflareVettingPersistence;
let scans = 0;
/** The live integration-branch head and template digest vetting compares. */
let livePin: VettingPin;
let cache: MemoryCache;
let tokenReads: string[];
let githubReads: string[];
let deps: ProjectApiDependencies;
/** GitHub's answer for the ownership check, by repository. */
let control: (repository: string) => RepositoryControl;
/** What the Slopbot installation reads for the repository and account. */
let access: RepositoryAccess | "unavailable";
/** Whether the scan service accepts queued scans. */
let scanService: boolean;

beforeEach(async () => {
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  _sqlite = database.sqlite;
  db = database.db;
  persistence = new CloudflareProjectPersistence(database.db);
  retained = await localVettingEvidence(
    database.db,
    () => new Date("2026-10-18T12:00:00.000Z"),
  );
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  livePin = { commitSha: "a".repeat(40), templateSha256: "d".repeat(64) };
  cache = new MemoryCache();
  tokenReads = [];
  githubReads = [];
  control = () => ({ state: "matched" });
  access = { installation: "missing" };
  scanService = false;
  let id = 0;
  const randomId = () =>
    `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
  deps = {
    persistence,
    securityProgramFunds: (projectId, program) =>
      readSecurityProgramFunds(
        { db: database.db, now: () => deps.now() },
        projectId,
        program,
      ),
    adminGithubIds: new Set([ADMIN.githubId, MODERATOR.githubId]),
    moderatorGithubIds: new Set([ADMIN.githubId, MODERATOR.githubId]),
    now: () => new Date("2026-10-18T12:00:00.000Z"),
    randomId,
    sessionActor: async (request) =>
      request.headers.get("x-test-actor") === "admin"
        ? ADMIN
        : request.headers.get("x-test-actor") === "applicant"
          ? APPLICANT
          : request.headers.get("x-test-actor") === "moderator"
            ? MODERATOR
            : null,
    repositoryControl: async (manifest) => control(manifest.repositories[0].id),
    repositoryAccess: async () => {
      if (access === "unavailable") throw new Error("Slopbot unavailable");
      return access;
    },
    requestScan: vettingScanRequester({
      vetting,
      serviceAvailable: async () => scanService,
      livePin: async () => livePin,
      now: () => new Date("2026-10-18T12:00:00.000Z"),
      randomId,
    }),
    vettingClearance: (
      projectId,
      manifest,
      throughRevision,
      forReinstatement,
    ) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        throughRevision,
        async () => livePin,
        forReinstatement,
      ),
    readTokenMetadata: async (network, address) => {
      tokenReads.push(`${network}:${address}`);
      if (address === TOKEN) return { decimals: 18, symbol: "OPEN" };
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async (url) => {
        githubReads.push(url);
        if (url === `https://api.github.com/user/${APPLICANT.githubId}`)
          return Response.json({
            id: Number(APPLICANT.githubId),
            login: APPLICANT.githubLogin,
            type: "User",
          });
        if (
          url ===
          "https://api.github.com/repos/example/open-registry/branches?per_page=100&page=1"
        )
          return Response.json([
            { name: "main", commit: { sha: "a".repeat(40) } },
            { name: "development", commit: { sha: "b".repeat(40) } },
          ]);
        if (url === "https://api.github.com/repos/example/open-registry")
          return Response.json({
            id: 123456789,
            node_id: "R_example",
            full_name: "example/open-registry",
            description: "Reproducible research tooling for everyone.",
            private: false,
            default_branch: "main",
            owner: {
              login: "example",
              id: 987654321,
              node_id: "O_example",
              type: "Organization",
            },
          });
        return Response.json({ message: "Not Found" }, { status: 404 });
      },
    },
    cache,
  };
});

function call(
  method: string,
  path: string,
  actor?: "admin" | "applicant" | "moderator",
  body?: unknown,
) {
  return handleProjectApi(
    new Request(`${ORIGIN}/api/v1/${path}`, {
      method,
      headers: {
        ...(actor ? { "x-test-actor": actor } : {}),
        ...(body === undefined
          ? {}
          : { "content-type": "application/json", origin: ORIGIN }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    deps,
  ) as Promise<Response>;
}

/** Seeds a historical persistence result; this does not pass HTTP admission. */
async function _seedHistoricalResult(
  projectId: string,
  disposition: "clean" | "malicious" = "clean",
) {
  const project = await persistence.getProject(projectId);
  if (project === null) throw new Error("project was not listed");
  const id = `vet_${String(++scans).padStart(32, "0")}`;
  const requestedAt = new Date(
    Date.parse("2026-10-18T12:00:00.000Z") + scans * 2000,
  ).toISOString();
  await vetting.createAssessment({
    id,
    projectId,
    revision: project.revision,
    manifestSha256: project.manifestSha256,
    contentSha256: await vettedContentSha256(project.manifest),
    commitSha: livePin.commitSha,
    templateSha256: livePin.templateSha256,
    requestedBy: ADMIN,
    requestedAt,
    requestReason: "Fixture scan",
  });
  const result = parseVettingResult(
    vettingResult(
      {
        assessmentId: id,
        projectId,
        revision: project.revision,
        manifestSha256: project.manifestSha256,
        repository: project.manifest.repositories[0].id,
        commitSha: livePin.commitSha,
        templateSha256: livePin.templateSha256,
      },
      disposition,
    ),
  );
  await retained.retain(id, result.environment.runId);
  expect(
    await vetting.recordResult({
      result,
      resultText: JSON.stringify(result),
      resultSha256: "0".repeat(64),
      signingKeySha256: "1".repeat(64),
      at: new Date(Date.parse(requestedAt) + 1000).toISOString(),
    }),
  ).toBe("recorded");
  return id;
}

const ADMIN_ACCESS: RepositoryAccess = {
  installation: "installed",
  installationId: 7,
  permission: "admin",
  roleName: "admin",
};

/** Creates a project as an owner whose admin access Slopbot reads. */
async function create(manifest: unknown, extra: Record<string, unknown> = {}) {
  const previous = access;
  access = ADMIN_ACCESS;
  try {
    return await call("POST", "projects", "applicant", { manifest, ...extra });
  } finally {
    access = previous;
  }
}

async function listProject(
  manifest = applicationManifest("open-registry", "example/open-registry"),
) {
  const created = await create(manifest);
  expect(created.status).toBe(201);
  return (await created.json()).project;
}

import { repositoryIdentity } from "../backend/projects/enforcement";
import { ProjectFlagStore } from "../backend/vetting/flags";
import { type AdminProject, adminProjectCounts } from "../src/lib/project-api";

// The badge a row of the admin list shows, per projectState in src/Admin.tsx:
// a decision outranks the restriction in force, which outranks the
// manifest status.
type AdminRow = {
  id: string;
  status: string;
  enforcement: {
    state: string;
    decisionRequired: boolean;
    revisionPending: boolean;
  };
};
const badgeLabel = (p: AdminRow) =>
  p.enforcement.decisionRequired
    ? "Decision needed"
    : p.enforcement.state !== "clear"
      ? p.enforcement.state
      : p.status;

/** Seeds the registry status the activation flow lands; the read path under test is the real handler. */
async function activate(id: string) {
  const project = await persistence.getProject(id);
  if (project === null) throw new Error(`${id} was not listed`);
  const manifest = { ...project.manifest, status: "active" as const };
  const text = JSON.stringify(manifest);
  const result = await persistence.appendProjectRevision(
    {
      projectId: id,
      expectedRevision: project.revision,
      manifest,
      manifestText: text,
      manifestSha256: await sha256Hex(new TextEncoder().encode(text)),
      reason: "Activate the scanned revision",
      actor: ADMIN,
      at: deps.now().toISOString(),
    },
    await persistence.enforcementGeneration(),
  );
  expect(result).toBe("updated");
}

describe("admin project summary counts", () => {
  test("a restriction in force keeps its project out of the Active count while its revision is pending", async () => {
    await listProject(); // open-registry: active and clear
    for (const [id, repo] of [
      ["flag-target", "example/flag-target"],
      ["ban-target", "example/ban-target"],
      ["paused-target", "example/paused-target"],
    ] as const) {
      const created = await create(applicationManifest(id, repo));
      expect(created.status).toBe(201);
    }
    await activate("open-registry");
    await activate("flag-target");
    await activate("ban-target");

    // Two distinct contributor flags pause flag-target through the real
    // flag store, the writer the flag HTTP handler calls. The pause record
    // lands at once; its paused, retired revision is still pending, so the
    // manifest status stays active under a quarantine in force.
    const flags = new ProjectFlagStore(db);
    const target = await persistence.getProject("flag-target");
    if (target === null) throw new Error("flag-target was not listed");
    const identity = repositoryIdentity(target.manifest);
    const at = deps.now().toISOString();
    const reporters = [
      { githubId: "900000101", githubLogin: "flag-one" },
      { githubId: "900000102", githubLogin: "flag-two" },
    ];
    for (const [index, reporter] of reporters.entries()) {
      const filed = await flags.file({
        flagId: `flg_counts_000000000${index}`,
        pauseRecordId: `enf_counts_000000000${index}`,
        project: target,
        repositoryGithubId: identity.githubId,
        repositoryKeys: identity.keys,
        reporter,
        category: "other",
        evidence: "Two flags pause the project",
        evidenceUrl: null,
        moderatorGithubIds: [ADMIN.githubId],
        at,
      });
      expect(filed).not.toBe("conflict");
    }

    // A confirmed-malicious vetting ban lands on ban-target, shaped exactly
    // as backend/vetting/persistence.ts builds it: banned and awaiting a
    // moderator decision, its enforced revision also still pending.
    const banTarget = await persistence.getProject("ban-target");
    if (banTarget === null) throw new Error("ban-target was not listed");
    const banIdentity = repositoryIdentity(banTarget.manifest);
    expect(
      await persistence.appendEnforcement(
        {
          id: "enf_counts_vetting_ban",
          projectId: "ban-target",
          sequence: 1,
          action: "ban",
          stateAfter: "banned",
          appealAfter: "none",
          reason:
            "Confirmed malicious evidence under the reviewed security vetting rule",
          evidenceReference: "vet_counts_assessment",
          repositoryGithubId: banIdentity.githubId,
          repositoryKeys: banIdentity.keys,
          actor: null,
          actorRole: "vetting-service",
          decisionSource: "standing-rule",
          systemIssuer: {
            kind: "vetting-service",
            keySha256: "1".repeat(64),
            assessmentId: "vet_counts_assessment",
            policyVersion: "counts",
            rule: "counts-rule",
          },
          beforeRevision: banTarget.revision,
          beforeManifestSha256: banTarget.manifestSha256,
          afterRevision: null,
          afterManifestSha256: null,
          result: "revision_pending",
          createdAt: at,
        },
        null,
        [],
      ),
    ).toBe("recorded");

    // Control: a moderator quarantine of the paused project appends its
    // enforced revision at once, so its status lands as paused.
    const paused = await persistence.getProject("paused-target");
    if (paused === null) throw new Error("paused-target was not listed");
    const sequences = await persistence.listEnforcements();
    const pausedRestriction = projectRestriction("paused-target", sequences);
    const quarantined = await call(
      "POST",
      "admin/projects/paused-target/enforcement",
      "admin",
      {
        action: "quarantine",
        reason: "Moderator note for quarantine",
        evidenceReference:
          "https://github.com/example/paused-target/security/advisories/GHSA-test",
        expectedRevision: paused.revision,
        expectedSequence: pausedRestriction.nextSequence,
      },
    );
    expect(quarantined.status).toBe(200);

    const response = await call("GET", "admin/projects", "admin");
    expect(response.status).toBe(200);
    const { projects } = (await response.json()) as {
      projects: AdminProject[];
    };
    const byId = new Map(projects.map((p) => [p.id, p]));
    // The seeded precondition: both restrictions are in force while the
    // manifest status is still active.
    expect(byId.get("flag-target")).toMatchObject({
      status: "active",
      enforcement: { state: "quarantined", revisionPending: true },
    });
    expect(byId.get("ban-target")).toMatchObject({
      status: "active",
      enforcement: {
        state: "banned",
        decisionRequired: true,
        revisionPending: true,
      },
    });
    expect(byId.get("paused-target")).toMatchObject({
      status: "paused",
      enforcement: { state: "quarantined" },
    });

    const counts = adminProjectCounts(projects);
    expect(counts).toEqual({ total: 4, active: 1, needReview: 1 });
    // The summary agrees with the queue it heads: the badges the rows show.
    expect(counts.active).toBe(
      projects.filter((p) => badgeLabel(p) === "active").length,
    );
    expect(counts.needReview).toBe(
      projects.filter((p) => badgeLabel(p) === "Decision needed").length,
    );
  });
});
