// spec/security/admission.md, "A signed service request binds method, path, timestamp and body digest and is refused outside a five-minute window"; spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"; spec/security/enforcement.md, "A fresh clean scan of every repository lifts a flag-only pause"
import { Effect, Redacted } from "effect";
import { Response } from "miniflare";
import type { D1Database, R2Bucket } from "@repo/platform/bindings";
import { base64url, ed25519Sign, sha256Hex, webCrypto } from "@repo/platform/crypto";
import { signatureHeaders, signedMessage } from "@repo/platform/signed";
import { type StartedWorker, bundle, database, migrate, startWorker, storage } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";
import { executableContent } from "../../../src/admission/binding.ts";

export const origin = "https://slop.test";
export const project = "admission-fixture";
export const pending = `vet_${"1".repeat(32)}`;
export const commit = "c".repeat(40);
export const template = "d".repeat(64);
const root = new URL("../../..", import.meta.url).pathname;

interface KeyPair {
  readonly seed: string;
  readonly publicKey: string;
}

export const serviceKey: KeyPair = { seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a" };
export const strangerKey: KeyPair = { seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb", publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c" };

export interface Answer {
  readonly status: number;
  readonly cache: string | null;
  readonly type: string | null;
  readonly body: unknown;
}

export interface World {
  readonly db: D1Database;
  readonly evidence: R2Bucket;
  readonly mf: StartedWorker;
  readonly sandbox: ReadonlyArray<string>;
  readonly heads: Map<string, string>;
  readonly outage: Set<string>;
}

/** @throws {never} */
function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

const manifest = JSON.stringify({
  id: project,
  name: "Admission fixture",
  status: "paused",
  listingTier: "community",
  steward: { github: { type: "User", actorId: "900", login: "steward", nodeId: "U_steward" } },
  authority: { repositoryId: 4101, repositoryNodeId: "R_admission" },
  terms: { repositoryLicense: { state: "verified", spdx: "MIT", url: "https://example.test/license", commitSha: "a".repeat(40), fileSha256: "b".repeat(64) } },
  repositories: [{ id: "slop-test/admission", integrationBranch: "main" }],
  reward: { chain: null, fundingState: "unfunded", committedMinor: "0", paymentMode: "none" },
  funding: {},
});

export const configuredKeys = Buffer.from(bytesOf(serviceKey.publicKey)).toString("base64");

function answer(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function boot(keys: string): Promise<World> {
  const script = await bundle(root, { config: "test/support/admission/vite.config.ts", entry: "admission" });
  const sandbox: string[] = [];
  const heads = new Map<string, string>();
  const outage = new Set<string>();
  const mf = startWorker({
    script,
    d1: { SLOP_DB: "slop-private" },
    r2: ["VETTING_EVIDENCE"],
    vars: {
      VETTING_RESULT_PUBLIC_KEYS: keys,
      ADMIN_GITHUB_IDS: "801",
      PROJECT_MODERATOR_GITHUB_IDS: "801",
    },
    services: {
      SANDBOX: async (request) => {
        sandbox.push(`${request.method} ${new URL(request.url).pathname} ${request.method === "POST" ? await request.text() : ""}`.trim());
        return answer({ outcome: "exited" });
      },
      GITHUB: (request) => {
        const branch = /^\/repos\/([^/]+\/[^/]+)\/branches\/main$/u.exec(new URL(request.url).pathname);
        if (branch?.[1] !== undefined && outage.has(branch[1])) return answer({ message: "Server Error" }, 500);
        const head = branch?.[1] === undefined ? undefined : heads.get(branch[1]);
        return head === undefined ? answer({ message: "Not Found" }, 404) : answer({ commit: { sha: head } });
      },
      ASSETS: (request) => new URL(request.url).pathname === "/skill-templates/index.json" ? answer({ templateSha256: template }) : answer({ error: "not_found" }, 404),
    },
  });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  return { db: await database(mf, "SLOP_DB"), evidence: await storage(mf, "VETTING_EVIDENCE"), mf, sandbox, heads, outage };
}

export async function started(keys: string = configuredKeys): Promise<World> {
  const world = await boot(keys);
  const { db } = world;
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)").bind(project, manifest, "a".repeat(64), "Admission fixture", at),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), at, at),
    db.prepare(`INSERT INTO vetting_assessments(id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,requested_by_github_id,requested_by_github_login,requested_at,request_reason,state,repository_id,flag_ids)
      VALUES(?,?,1,?,?,?,?,'900','steward',?,'Automatic scan of new project content','pending','slop-test/admission','[]')`).bind(pending, project, "a".repeat(64), "b".repeat(64), commit, template, at),
  ]);
  return world;
}

export interface Listed {
  readonly path: string;
  readonly githubId: number;
}

export interface Scan {
  readonly repository: string;
  readonly state: "clean" | "incomplete" | "pending";
  readonly commit?: string;
  readonly retained?: false;
}

export interface FlagProject {
  readonly id: string;
  readonly repositories: readonly [Listed, ...ReadonlyArray<Listed>];
  readonly scans: ReadonlyArray<Scan>;
}

export const signingKeySha256 = "5".repeat(64);
const policyVersion = "slop-scan-policy-v2";
const surfaces = ["source", "manifests", "dependencies", "installScripts", "downloads", "agentInstructions"];
const threats = ["wallet-drainer", "credential-theft", "secret-exfiltration", "unsafe-execution", "prompt-injection"];
const minute = 60_000;
let assessments = 0x100;

/** @throws {never} */
function flagManifest(fixture: FlagProject): string {
  const [first] = fixture.repositories;
  return JSON.stringify({
    id: fixture.id,
    name: "Flag fixture",
    status: "active",
    listingTier: "community",
    steward: { github: { type: "User", actorId: "900", login: "steward", nodeId: "U_steward" } },
    authority: { repositoryId: first.githubId, repositoryNodeId: `R_${first.githubId}` },
    terms: { repositoryLicense: { state: "verified", spdx: "MIT", url: "https://example.test/license", commitSha: "a".repeat(40), fileSha256: "b".repeat(64) } },
    repositories: fixture.repositories.map((listed, index) => index === 0
      ? { id: listed.path, integrationBranch: "main" }
      : { id: listed.path, githubId: String(listed.githubId), nodeId: `R_${listed.githubId}`, integrationBranch: "main" }),
    reward: { chain: null, fundingState: "unfunded", committedMinor: "0", paymentMode: "none" },
    funding: {},
  });
}

/** @throws {never} */
function scanResult(input: { readonly id: string; readonly projectId: string; readonly scan: Scan; readonly startedAt: number; readonly completedAt: number; readonly report: string; readonly inputs: string }): string {
  const startedAt = new Date(input.startedAt).toISOString();
  const completedAt = new Date(input.completedAt).toISOString();
  return JSON.stringify({
    schemaVersion: "slop-vetting-result-v2",
    assessmentId: input.id,
    projectId: input.projectId,
    revision: 1,
    manifestSha256: "a".repeat(64),
    disposition: input.scan.state,
    policyVersion,
    assessed: { repository: input.scan.repository, commitSha: input.scan.commit ?? commit, templateSha256: template, inputManifestSha256: input.inputs, dependencyLocks: [] },
    scan: { runId: "run-1", startedAt, completedAt, reportSha256: input.report },
    coverage: Object.fromEntries(surfaces.map((surface) => [surface, { state: input.scan.state === "clean" ? "complete" : "partial", items: 1 }])),
    checks: Object.fromEntries(threats.map((threat) => [threat, input.scan.state === "clean" ? "passed" : "not-run"])),
    visibilityGaps: input.scan.state === "clean" ? [] : ["The dependency install did not finish"],
    execution: null,
    reusedAssessmentId: null,
    primaryReview: { provider: "fixture", model: "fixture-reviewer", promptPolicyRevision: "fixture-1", inputManifestSha256: input.inputs, runId: "review-1", status: "completed", verdict: "no-findings", risk: "low", findingCount: 0 },
    specialistReview: null,
    artifacts: [],
    findings: [],
    confirmation: null,
  });
}

async function retained(world: World, id: string, kind: string, text: string, kept: boolean): Promise<{ readonly sha: string; readonly statement: D1PreparedStatement }> {
  const bytes = new TextEncoder().encode(text);
  const sha = await digest(bytes);
  const key = `vetting/${id}/run-1/${sha}`;
  if (kept) await world.evidence.put(key, bytes, { customMetadata: { sha256: sha }, httpMetadata: { contentType: "application/json" } });
  return { sha, statement: world.db.prepare(`INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks,storage,storage_generation) VALUES(?,'run-1',?,?,?,?,'application/json',?,NULL,'run',NULL)`).bind(id, sha, bytes.length, kind, kind, key) };
}

async function digest(bytes: Uint8Array): Promise<string> {
  return Effect.runPromise(Effect.provide(sha256Hex(bytes), webCrypto));
}

type D1PreparedStatement = ReturnType<D1Database["prepare"]>;

async function contentOf(manifest: string): Promise<string> {
  return Effect.runPromise(Effect.provide(sha256Hex(executableContent(JSON.parse(manifest) as Record<string, unknown>)), webCrypto));
}

interface Completion {
  readonly id: string;
  readonly projectId: string;
  readonly scan: Scan;
  readonly startedAt: number;
  readonly completedAt: number;
}

async function completion(world: World, input: Completion): Promise<ReadonlyArray<D1PreparedStatement>> {
  const { db } = world;
  const kept = input.scan.retained !== false;
  const report = await retained(world, input.id, "trace", `{"report":"${input.id}"}`, kept);
  const inputs = await retained(world, input.id, "manifest", `{"inputs":"${input.id}"}`, kept);
  const result = scanResult({ ...input, report: report.sha, inputs: inputs.sha });
  const run = JSON.stringify({ traceSha256: report.sha, objects: [{ sha256: report.sha, kind: "trace" }, { sha256: inputs.sha, kind: "manifest" }] });
  const completedAt = new Date(input.completedAt).toISOString();
  return [
    db.prepare("UPDATE vetting_assessments SET state=?,policy_version=?,result=?,result_sha256=?,signing_key_sha256=?,completed_at=? WHERE id=?")
      .bind(input.scan.state, policyVersion, result, await digest(new TextEncoder().encode(result)), signingKeySha256, completedAt, input.id),
    db.prepare("INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,'run-1',?,?,?,'{}',?,?)")
      .bind(input.id, report.sha, await digest(new TextEncoder().encode(run)), run, completedAt, new Date(Date.now() + 86_400_000).toISOString()),
    report.statement,
    inputs.statement,
  ];
}

export async function complete(world: World, id: string): Promise<void> {
  const [row] = (await world.db.prepare("SELECT project_id, repository_id, commit_sha, requested_at FROM vetting_assessments WHERE id = ?").bind(id).all()).results;
  if (row === undefined) throw new Error(`no assessment ${id}`);
  const scan: Scan = { repository: String(row.repository_id), state: "clean", commit: String(row.commit_sha) };
  await world.db.batch(await completion(world, { id, projectId: String(row.project_id), scan, startedAt: Date.parse(String(row.requested_at)), completedAt: Date.now() }));
}

export async function flagged(world: World, fixture: FlagProject): Promise<ReadonlyArray<string>> {
  const { db } = world;
  const text = flagManifest(fixture);
  const content = await contentOf(text);
  const base = Date.now() - 4 * 60 * minute;
  const at = (offset: number) => new Date(base + offset).toISOString();
  const flagIds = [`flg_${fixture.id}_1`, `flg_${fixture.id}_2`];
  const evidence = "Install script posts the wallet seed phrase to a remote host";
  for (const listed of fixture.repositories) world.heads.set(listed.path, commit);
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)").bind(fixture.id, text, "a".repeat(64), "Flag fixture", at(0)),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',1,?,?,?,?)").bind(fixture.id, text, "a".repeat(64), at(0), at(0)),
    ...flagIds.map((id, index) => db.prepare("INSERT INTO project_flags(id,project_id,reporter_github_id,reporter_github_login,revision,manifest_sha256,category,evidence,evidence_url,created_at) VALUES(?,?,?,?,1,?,'wallet-drainer',?,NULL,?)")
      .bind(id, fixture.id, String(501 + index), `flagger-${501 + index}`, "a".repeat(64), evidence, at((index + 1) * 10 * minute))),
    db.prepare(`INSERT INTO project_enforcements(id,project_id,sequence,action,state_after,appeal_after,reason,evidence_reference,repository_github_id,repository_keys,actor_github_id,actor_github_login,system_issuer,actor_role,decision_source,before_revision,before_manifest_sha256,after_revision,after_manifest_sha256,result,created_at)
      VALUES(?,?,1,'quarantine','quarantined','none',?,?,?,?,NULL,NULL,?,'contributor-flags','standing-rule',1,?,NULL,NULL,'no_revision_needed',?)`)
      .bind(`enf_flags_${fixture.id}`, fixture.id, "Two distinct contributor flags paused the project. A clean fresh security scan reinstates it.", `flag:${flagIds[1]}`, String(fixture.repositories[0].githubId), JSON.stringify(fixture.repositories.map((listed) => listed.path.toLowerCase())), JSON.stringify({ kind: "contributor-flags", threshold: 2, flagIds }), "a".repeat(64), at(20 * minute)),
  ]);
  const ids: string[] = [];
  for (const [index, scan] of fixture.scans.entries()) {
    assessments += 1;
    const id = `vet_${assessments.toString(16).padStart(32, "0")}`;
    const requested = base + (60 + index * 10) * minute;
    const completed = scan.state === "pending" ? [] : await completion(world, { id, projectId: fixture.id, scan, startedAt: requested, completedAt: requested + minute });
    await db.batch([
      db.prepare(`INSERT INTO vetting_assessments(id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,requested_by_github_id,requested_by_github_login,requested_at,request_reason,state,repository_id,flag_ids)
        VALUES(?,?,1,?,?,?,?,'900','steward',?,'Automatic fresh scan after two contributor flags paused the project','pending',?,?)`).bind(id, fixture.id, "a".repeat(64), content, scan.commit ?? commit, template, new Date(requested).toISOString(), scan.repository, JSON.stringify(flagIds)),
      ...completed,
    ]);
    ids.push(id);
  }
  return ids;
}

export async function flagWorld(fixtures: ReadonlyArray<FlagProject>): Promise<{ readonly world: World; readonly scans: ReadonlyMap<string, ReadonlyArray<string>> }> {
  const world = await boot(configuredKeys);
  const scans = new Map<string, ReadonlyArray<string>>();
  for (const fixture of fixtures) scans.set(fixture.id, await flagged(world, fixture));
  return { world, scans };
}

export interface Signing {
  readonly key?: KeyPair;
  readonly timestamp?: string;
  readonly signedPath?: string;
  readonly signedBody?: Uint8Array;
}

async function headersFor(method: string, path: string, body: Uint8Array, signing: Signing): Promise<Record<string, string>> {
  const pair = signing.key ?? serviceKey;
  const jwk = Redacted.make(JSON.stringify({ kty: "OKP", crv: "Ed25519", d: base64url(bytesOf(pair.seed)), x: base64url(bytesOf(pair.publicKey)) }));
  const timestamp = signing.timestamp ?? new Date().toISOString();
  const signed = Effect.gen(function* () {
    const message = yield* signedMessage(method, signing.signedPath ?? path, timestamp, signing.signedBody ?? body);
    const signature = yield* ed25519Sign(jwk, message);
    const keyId = yield* sha256Hex(bytesOf(pair.publicKey));
    return { signature, keyId };
  });
  const { signature, keyId } = await Effect.runPromise(Effect.provide(signed, webCrypto));
  return { [signatureHeaders.key]: keyId, [signatureHeaders.timestamp]: timestamp, [signatureHeaders.signature]: Buffer.from(signature).toString("base64") };
}

export async function signed(world: World, method: "GET" | "POST", path: string, body: unknown = undefined, signing: Signing = {}): Promise<Answer> {
  const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(typeof body === "string" ? body : JSON.stringify(body));
  const headers = { ...(await headersFor(method, path, bytes, signing)), ...(method === "POST" ? { "content-type": "application/json" } : {}) };
  const response = (await world.mf.dispatchFetch(`${origin}${path}`, { method, headers, redirect: "manual", ...(method === "POST" ? { body: bytes } : {}) })) as unknown as Response;
  const type = response.headers.get("content-type");
  return { status: response.status, cache: response.headers.get("cache-control"), type, body: (type ?? "").startsWith("application/json") ? await response.json() : await response.text() };
}

let issued = 0;

async function session(world: World, githubId: string): Promise<string> {
  issued += 1;
  const token = `t${githubId.padStart(20, "0")}${String(issued).padStart(8, "0")}${"z".repeat(35)}`;
  const hash = await Effect.runPromise(Effect.provide(sha256Hex(new TextEncoder().encode(token)), webCrypto));
  await world.db.batch([
    world.db.prepare("INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)").bind(`actor-${githubId}`, githubId, `member-${githubId}`, new Date().toISOString()),
    world.db.prepare("INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)").bind(hash, `actor-${githubId}`, new Date(Date.now() + 3_600_000).toISOString()),
  ]);
  return token;
}

export async function read(world: World, path: string, as?: string): Promise<Answer> {
  const headers: Record<string, string> = as === undefined ? {} : { cookie: `__Host-slop_points=${await session(world, as)}`, "x-slop-expected-github-id": as };
  const response = (await world.mf.dispatchFetch(`${origin}${path}`, { headers, redirect: "manual" })) as unknown as Response;
  const type = response.headers.get("content-type");
  return { status: response.status, cache: response.headers.get("cache-control"), type, body: (type ?? "").startsWith("application/json") ? await response.json() : await response.text() };
}

export async function rows(world: World, text: string, ...params: ReadonlyArray<string | number | null>): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await world.db.prepare(text).bind(...params).all()).results;
}
