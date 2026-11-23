// spec/points/quotaRecovery.md, "Story: Preserve the same campaign while live quota recovers"
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Clock, Duration, Effect, Layer } from "effect";
import type { Fetcher } from "@repo/platform/bindings";
import { type GitHubFake, githubFake } from "@repo/platform/testing/github";

export const day = 86_400_000;
export const start = Date.UTC(2026, 10, 16, 12, 0, 0);
export const repository = "ada/widgets";
export const actionsRepository = "slopdotcash/slop";
export const mainHead = "c".repeat(40);
export const trustedRun = "101";
export const forkRun = "102";
export const searchPath = process.env.PATH ?? "";
export const collectorPath = ".github/workflows/points-implementation-corrections.yml";

export interface QuotaWindow {
  readonly after: number;
  readonly until: number;
}

export interface FastClock {
  readonly layer: Layer.Layer<never>;
  readonly slept: number[];
  /** @throws {never} */
  set(millis: number): void;
  /** @throws {never} */
  now(): number;
}

export interface Campaign {
  readonly fake: GitHubFake;
  readonly clock: FastClock;
  readonly token: string;
  readonly fetcher: Fetcher;
  readonly operations: string[];
  readonly refused: number[];
  readonly runReads: string[];
  readonly directory: string;
  /** @throws {never} */
  exhaust(window: QuotaWindow): void;
  /** @throws {never} */
  addProjectAfterCutoff(): void;
}

const iso = (millis: number) => new Date(millis).toISOString();
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function answer(value: unknown, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(typeof value === "string" ? value : JSON.stringify(value), { status: 200, headers: { "content-type": "application/json", ...headers } });
}

function operationOf(body: string): string {
  const parsed: unknown = JSON.parse(body);
  const query = typeof parsed === "object" && parsed !== null && "query" in parsed && typeof parsed.query === "string" ? parsed.query : "";
  return /query\s+(\w+)/u.exec(query)?.[1] ?? "anonymous";
}

/** @throws {never} */
export function fastClock(begin: number): FastClock {
  let now = begin;
  const slept: number[] = [];
  const nanos = () => BigInt(now) * 1_000_000n;
  const live = Clock.Clock.defaultValue();
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) => {
      const millis = Duration.toMillis(duration);
      return Effect.andThen(live.sleep(Duration.millis(millis / 1000)), Effect.sync(() => {
        now += millis;
        slept.push(millis);
      }));
    },
  };
  return {
    layer: Layer.succeed(Clock.Clock, clock),
    slept,
    set: (millis) => {
      now = millis;
    },
    now: () => now,
  };
}

const contribution = {
  approvedScope: "Bug fixes and documented features in the toolkit.",
  contributionGuide: "Branch from main and keep one change per pull request.",
  supportedTasks: "Reproduced bugs with a failing test.",
  requiredTests: "Run the test suite and attach the output.",
  reviewExpectations: "The failing test fails on the base and passes on the head.",
  securityContact: "security@example.org",
  closurePolicy: "Maintainers close duplicates.",
  maintainerNotes: "",
};

const usdc = { network: "ethereum", kind: "stablecoin", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, chainId: "1", cluster: null, verifiedAt: "2026-11-01T00:00:00.000Z" };

function manifest(id: string, status: string, name: string) {
  const path = `ada/${name}`;
  return {
    schemaVersion: "1",
    id,
    slug: id,
    name: `Project ${id}`,
    eyebrow: "Open-source project",
    headline: "Reproducible research tooling for everyone.",
    description: "Build and maintain reproducible research tooling.",
    listingTier: "community",
    status,
    steward: { displayName: "ada", kind: "individual", github: { actorId: "101", nodeId: "U_101", login: "ada", type: "User", profileUrl: "https://github.com/ada" }, website: null },
    authority: { state: "unverified", reason: "missing-repository-proof", role: "project-steward", repositoryId: "7001", repositoryNodeId: "R_7001", proof: null },
    terms: {
      revision: "draft-1",
      effectiveAt: "2026-11-01T00:00:00.000Z",
      paymentTransfersIp: false,
      retroactive: false,
      receiptPolicy: { state: "pending-authority-activation", activatedAt: null, bindings: [] },
      copyright: { model: "unknown", claimedLegalHolder: null, notice: null, legalCapacity: null, governanceResolution: null },
      repositoryLicense: { state: "unknown", spdx: null, url: null, commitSha: null, fileSha256: null },
      inbound: { mode: "unknown", termsUrl: null, commitSha: null, fileSha256: null, version: null, acceptance: null },
      assignment: null,
      externalPrize: null,
    },
    repositories: [{ id: path, displayName: path, githubUrl: `https://github.com/${path}`, description: "Research tooling repository.", integrationBranch: "main" }],
    skill: { id: `contribute-to-${id}`, publishAtRoot: false, sourcePath: "skills/project-contributor-template", publicPath: `/projects/${id}/skill.md` },
    reviewSkill: { id: `review-${id}-contributions`, sourcePath: "skills/project-reviewer-template" },
    rewardAsset: usdc,
    contribution,
    reward: { kind: "monthly-pool", currency: "USDC", chain: "ethereum", rewardStartAt: "2026-11-01T00:00:00.000Z", cycle: "calendar-month-utc", monthlyCapMinor: "1000000000", monthlyCapDisplay: "$1,000", committedMinor: "0", paymentMode: "disabled", feeBasisPoints: 100, unusedFunds: "rollover-without-cap-increase", fundingState: "pledged" },
    funding: { mode: "direct-noncustodial", disclosure: "Funds go directly to the project wallet. Slop does not hold or recover funds.", recordsPath: `funding/${id}`, addresses: [] },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: { repository: `https://github.com/${path}`, issues: `https://github.com/${path}/issues` },
  };
}

function revisionOf(project: ReturnType<typeof manifest>, createdAt: number) {
  return { projectId: project.id, revision: 1, manifestSha256: sha256(JSON.stringify(project)), reason: "registered", createdAt: iso(createdAt), manifest: project };
}

function actionsRun(headRepository: string) {
  return {
    head_sha: mainHead,
    head_branch: "main",
    event: "workflow_dispatch",
    path: collectorPath,
    repository: { full_name: actionsRepository },
    head_repository: { full_name: headRepository },
  };
}

function publishedPoints(path: string, journal: { readonly generatedAt: string }) {
  const empty = "[]";
  if (path === "/api/v1/points/journal") {
    const body = { schemaVersion: "1", ruleVersion: "slop-points-v1", generatedAt: journal.generatedAt, coverage: [], revisions: [] };
    return answer({ batch: sha256(JSON.stringify(body)), generatedAt: journal.generatedAt, coverage: [], revisions: [], total: 0, next: null });
  }
  if (path === "/data/points.json") {
    const shards = Array.from({ length: 16 }, (_, index) => ({ path: `/data/points/${index.toString(16)}.json`, sha256: sha256(empty), count: 0 }));
    return answer({ schemaVersion: "1", ruleVersion: "slop-points-v1", generatedAt: journal.generatedAt, coverage: [], revisionCount: 0, shards });
  }
  if (/^\/data\/points\/[0-9a-f]\.json$/u.test(path)) return answer(empty);
  return undefined;
}

/** @throws {Error} */
export function campaign(): Campaign {
  const clock = fastClock(start - 50 * day);
  const fake = githubFake({ now: () => clock.now() });
  fake.world.addUser({ id: 101, login: "ada" });
  fake.world.addUser({ id: 102, login: "grace" });
  const created = fake.world.addRepo({ id: 7001, owner: "ada", name: "widgets" });
  const base = created.branches.get(created.defaultBranch) ?? "";
  const first = fake.world.addCommit(repository, { branch: "first", parents: [base], author: "grace", files: { "src/a.ts": "one\ntwo\n" } });
  const second = fake.world.addCommit(repository, { branch: "second", parents: [base], author: "grace", files: { "src/b.ts": "three\n" } });
  fake.world.addPull({ repo: repository, author: "grace", title: "October change", mergedAt: iso(start - 30 * day), commits: [first], headSha: first, headRef: "first" });
  fake.world.addPull({ repo: repository, author: "grace", title: "November change", mergedAt: iso(start - 2 * day), commits: [second], headSha: second, headRef: "second" });
  clock.set(start);
  const widgets = manifest("widgets", "active", "widgets");
  let projects: ReadonlyArray<unknown> = [widgets];
  let revisions: ReadonlyArray<unknown> = [revisionOf(widgets, start - 40 * day)];
  const journal = { generatedAt: iso(start - day) };
  const runs: Readonly<Record<string, unknown>> = { [trustedRun]: actionsRun(actionsRepository), [forkRun]: actionsRun("someone/slop") };
  const operations: string[] = [];
  const refused: number[] = [];
  const runReads: string[] = [];
  let window: QuotaWindow | undefined;
  let answered = 0;
  const fetcher: Fetcher = {
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.origin === "https://slop.cash") {
        if (url.pathname === "/api/v1/projects") return answer({ schemaVersion: "1", projects, restrictions: [] }, { "x-slop-project-api-contract": "1" });
        if (url.pathname === "/api/v1/project-revisions") return answer({ schemaVersion: "1", revisions }, { "x-slop-project-api-contract": "1" });
        return publishedPoints(url.pathname, journal) ?? new Response("not found", { status: 404 });
      }
      const run = /^\/repos\/slopdotcash\/slop\/actions\/runs\/(\d+)$/u.exec(url.pathname)?.[1];
      if (url.origin === "https://api.github.com" && run !== undefined) {
        runReads.push(run);
        return Object.hasOwn(runs, run) ? answer(runs[run]) : new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
      }
      const graphql = request.method === "POST" && url.pathname === "/graphql";
      if (!graphql) return fake.fetch(request);
      const body = await request.clone().text();
      operations.push(operationOf(body));
      const open = window === undefined || answered < window.after || clock.now() >= window.until;
      if (open) {
        answered += 1;
        return fake.fetch(request);
      }
      refused.push(clock.now());
      const reset = Math.ceil((window?.until ?? 0) / 1000);
      return new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403, headers: { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } });
    },
  };
  return {
    fake,
    clock,
    token: fake.tokens.user("ada"),
    fetcher,
    operations,
    refused,
    runReads,
    directory: mkdtempSync(join(tmpdir(), "slop-corrections-")),
    exhaust: (next) => {
      window = { after: answered + next.after, until: next.until };
    },
    addProjectAfterCutoff: () => {
      const gadgets = manifest("gadgets", "paused", "gadgets");
      projects = [gadgets, widgets];
      revisions = [revisionOf(gadgets, start + 60_000), revisionOf(widgets, start - 40 * day)];
    },
  };
}

/** @throws {Error} */
export function retained(directory: string, folder: string): ReadonlyArray<string> {
  const path = join(directory, folder);
  return existsSync(path) ? readdirSync(path).sort() : [];
}
