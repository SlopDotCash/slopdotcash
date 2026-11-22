// spec/security/intake.md, "Only verified exact object bytes permit an atomic case and Inbox receipt"
import { Effect } from "effect";
import type { D1Database, R2Bucket } from "@repo/platform/bindings";
import { sha256Hex, webCrypto } from "@repo/platform/crypto";
import { type StartedWorker, bundle, database, migrate, startWorker, storage } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";

export const origin = "https://slop.test";
export const reporter = "18633264";
export const other = "202660855";
export const banned = "31337";
export const maintainer = "701";
const root = new URL("../../..", import.meta.url).pathname;

export interface World {
  readonly db: D1Database;
  readonly reports: R2Bucket;
  readonly mf: StartedWorker;
}

export interface Answer {
  readonly status: number;
  readonly cache: string | null;
  readonly body: unknown;
}

/** @throws {never} */
export function digest(bytes: Uint8Array | string): Promise<string> {
  return Effect.runPromise(Effect.provide(sha256Hex(bytes), webCrypto));
}

const repositories = [{ id: "slop-test/intake" }];
const approvers = { technical: [{ githubId: maintainer, githubLogin: "maintainer" }], financial: [{ githubId: "702", githubLogin: "finance" }], dispute: [] };
const intake = { kind: "github-private-vulnerability-reporting", repository: "slop-test/intake" };
const usdc = { grossMinor: "1000000", currency: "USDC", decimals: 6, network: "base" };

function bounty(fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { status: "open", amount: usdc, capacity: { awards: 3, closesAt: null, exhaustionRule: "close" }, approvers, intake, sponsor: { githubId: null, name: "Slop" }, ...fields };
}

export const pausedExclusion = "Losses that need the vault to stay paused for more than a week";
const pausedScope = { sourceRevisions: [{ repository: "slop-test/intake", commit: "0".repeat(40) }], deployments: [], includedAssets: ["slop-test/intake"], excludedDependencies: [], excludedFindings: [pausedExclusion], testingPermission: "Use local tests with synthetic funds only.", severityRubric: "Critical findings lose funds.", lossDefinition: "Any loss of user funds." };

export const programs: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>> = {
  "intake-fixture": bounty({ eligibility: "in-scope-security", fundingPolicy: "after-approval" }),
  "intake-full": bounty({ amount: { ...usdc, grossMinor: "500001" }, capacity: { awards: 1, closesAt: null, exhaustionRule: "close" }, split: { researcherBasisPoints: 10000, slopBasisPoints: 0 }, fundingPolicy: "after-approval" }),
  "intake-unpaid": bounty({ status: "paused" }),
  "intake-scoped": bounty({ status: "paused", scope: pausedScope }),
  "intake-closed": bounty({ capacity: { awards: 3, closesAt: new Date(Date.now() - 3_600_000).toISOString(), exhaustionRule: "close" } }),
  "intake-restricted": undefined,
};

function manifest(project: string, securityBounty: Readonly<Record<string, unknown>> | undefined): string {
  return JSON.stringify({ id: project, status: "active", repositories, ...(securityBounty === undefined ? {} : { securityBounty }) });
}

export async function started(mode = "on"): Promise<World> {
  const script = await bundle(root, { config: "test/support/intake/vite.config.ts", entry: "intake" });
  const mf = startWorker({
    script,
    d1: { SLOP_DB: "slop-private" },
    r2: ["PRIVATE_TRACES"],
    vars: { ADMIN_GITHUB_IDS: "801", PROJECT_MODERATOR_GITHUB_IDS: "801", SLOP_PRIVATE_INTAKE_MODE: mode, BANNED_GITHUB_IDS: banned },
  });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const later = new Date(Date.now() + 86_400_000).toISOString();
  const seeded = Object.entries(programs).flatMap(([project, securityBounty]) => [
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)").bind(project, 1, manifest(project, securityBounty), "a".repeat(64), "Intake fixture", at),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(project, "active", 1, manifest(project, securityBounty), "a".repeat(64), at, at),
  ]);
  const published = db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)").bind("intake-fixture", 2, manifest("intake-fixture", bounty({ amount: { ...usdc, grossMinor: "2000000" } })), "b".repeat(64), "Published after the receipts", later);
  await db.batch([...seeded, published]);
  return { db, reports: await storage(mf, "PRIVATE_TRACES"), mf };
}

const sessions = new WeakMap<World, Map<string, string>>();
let issued = 0;

async function session(world: World, githubId: string): Promise<string> {
  const tokens = sessions.get(world) ?? new Map<string, string>();
  sessions.set(world, tokens);
  const known = tokens.get(githubId);
  if (known !== undefined) return known;
  issued += 1;
  const token = `t${githubId.padStart(20, "0")}${String(issued).padStart(8, "0")}${"y".repeat(35)}`;
  await world.db.batch([
    world.db.prepare("INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)").bind(`actor-${githubId}`, githubId, `member-${githubId}`, new Date().toISOString()),
    world.db.prepare("INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)").bind(await digest(token), `actor-${githubId}`, new Date(Date.now() + 3_600_000).toISOString()),
  ]);
  tokens.set(githubId, token);
  return token;
}

export async function request(world: World, path: string, ask: { readonly as?: string; readonly json?: unknown; readonly raw?: string } = {}): Promise<Answer> {
  const headers: Record<string, string> = {};
  if (ask.as !== undefined) {
    headers.cookie = `__Host-slop_points=${await session(world, ask.as)}`;
    headers["x-slop-expected-github-id"] = ask.as;
  }
  const body = ask.raw ?? (ask.json === undefined ? undefined : JSON.stringify(ask.json));
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
  }
  const response = (await world.mf.dispatchFetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers, redirect: "manual", ...(body === undefined ? {} : { body }) })) as unknown as Response;
  const type = response.headers.get("content-type") ?? "";
  return { status: response.status, cache: response.headers.get("cache-control"), body: type.startsWith("application/json") ? await response.json() : await response.text() };
}

export async function faults(world: World, plan: { readonly lostPuts: number; readonly failedPuts: number }): Promise<void> {
  const answer = await request(world, "/api/v1/test/intake-faults", { json: plan });
  if (answer.status !== 200) throw new Error(`fault plan refused: ${answer.status}`);
}

export async function bans(world: World, githubIds: ReadonlyArray<string>): Promise<void> {
  const answer = await request(world, "/api/v1/test/intake-bans", { json: { githubIds } });
  if (answer.status !== 200) throw new Error(`ban plan refused: ${answer.status}`);
}

export async function rows(world: World, text: string, ...params: ReadonlyArray<string | number | null>): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await world.db.prepare(text).bind(...params).all()).results;
}

export async function reportingStatus(world: World, project: string, observed: { readonly enabled: boolean; readonly verifiedAt: string; readonly failure: string | null }): Promise<void> {
  await world.db.prepare(`INSERT INTO repository_reporting_status(project_id,project_revision,repository_key,repository_id,repository_node_id,enabled,verified_at,attempted_at,failure) VALUES(?,1,'slop-test/intake','1001','R_intake',?,?,?,?)
    ON CONFLICT(project_id,project_revision,repository_key) DO UPDATE SET enabled=excluded.enabled,verified_at=excluded.verified_at,attempted_at=excluded.attempted_at,failure=excluded.failure`)
    .bind(project, observed.enabled ? 1 : 0, observed.verifiedAt, new Date().toISOString(), observed.failure).run();
}

export async function admissions(world: World, githubId: string, count: number): Promise<void> {
  const now = Date.now();
  await world.db.batch(Array.from({ length: count }, (_, index) => world.db.prepare("INSERT INTO security_intake_rate_admissions(id,actor_github_id,admitted_at) VALUES(?,?,?)").bind(`iw_fixture_${githubId}_${index}`, githubId, now - index * 1000)));
}

export async function storedObject(world: World, key: string): Promise<{ readonly size: number; readonly sha256: string | undefined; readonly text: string } | undefined> {
  const found = await world.reports.get(key);
  if (found === null) return undefined;
  const bytes = new Uint8Array(await found.arrayBuffer());
  return { size: found.size, sha256: found.customMetadata?.sha256, text: new TextDecoder().decode(bytes) };
}
