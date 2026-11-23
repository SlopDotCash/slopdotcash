// spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { Effect, Redacted } from "effect";
import type { D1Database, R2Bucket } from "@repo/platform/bindings";
import { base64url, sha256Hex, webCrypto } from "@repo/platform/crypto";
import { signedHeaders } from "@repo/platform/signed";
import { type StartedWorker, bundle, database, migrate, startWorker, storage } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";

export const origin = "https://slop.test";
export const owner = "18633264";
export const reader = "202660855";
export const project = "evidence-fixture";
const root = new URL("../../..", import.meta.url).pathname;
const seed = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const publicKey = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface Ask {
  readonly method?: string;
  readonly body?: string | Uint8Array;
  readonly headers?: Readonly<Record<string, string>>;
  readonly as?: string;
  readonly json?: boolean;
}

export interface World {
  readonly db: D1Database;
  readonly objects: R2Bucket;
  readonly reports: R2Bucket;
  readonly backups: R2Bucket;
  readonly mf: StartedWorker;
}

/** @throws {never} */
function bytesOf(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

/** @throws {never} */
export function digest(bytes: Uint8Array | string): Promise<string> {
  return Effect.runPromise(Effect.provide(sha256Hex(bytes), webCrypto));
}

const tokens = new Map<string, string>();

export async function started(maintainers: ReadonlyArray<string>): Promise<World> {
  const script = await bundle(root, { config: "test/support/evidence/vite.config.ts", entry: "evidence" });
  const mf = startWorker({
    script,
    d1: { SLOP_DB: "slop-private" },
    r2: ["VETTING_EVIDENCE", "PRIVATE_TRACES", "EVIDENCE_BACKUPS"],
    vars: {
      VETTING_RESULT_PUBLIC_KEYS: Buffer.from(bytesOf(publicKey)).toString("base64"),
      ADMIN_GITHUB_IDS: `${owner},801`,
      PROJECT_MODERATOR_GITHUB_IDS: "801",
      MAINTAINER_GITHUB_IDS: maintainers.join(","),
    },
  });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const manifest = JSON.stringify({ id: project, status: "active", repositories: [{ id: "R_evidence" }] });
  const at = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)").bind(project, 1, manifest, "a".repeat(64), "Evidence fixture", at),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(project, "active", 1, manifest, "a".repeat(64), at, at),
  ]);
  return { db, objects: await storage(mf, "VETTING_EVIDENCE"), reports: await storage(mf, "PRIVATE_TRACES"), backups: await storage(mf, "EVIDENCE_BACKUPS"), mf };
}

let issued = 0;

export async function session(world: World, githubId: string): Promise<string> {
  const known = tokens.get(githubId);
  if (known !== undefined) return known;
  issued += 1;
  const token = `t${githubId.padStart(20, "0")}${String(issued).padStart(8, "0")}${"x".repeat(35)}`;
  await world.db.batch([
    world.db.prepare("INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)").bind(`actor-${githubId}`, githubId, `member-${githubId}`, new Date().toISOString()),
    world.db.prepare("INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,?,?)").bind(await digest(token), `actor-${githubId}`, new Date(Date.now() + 3_600_000).toISOString()),
  ]);
  tokens.set(githubId, token);
  return token;
}

export async function holdPartUntilSessionEnds(world: World, githubId: string, part: number): Promise<void> {
  const answer = await request(world, "/api/v1/test/evidence-faults", { method: "POST", body: JSON.stringify({ githubId, part }), json: true });
  if (answer.status !== 200) throw new Error(`hold plan refused: ${answer.status}`);
}

export async function endSession(world: World, githubId: string): Promise<void> {
  const token = tokens.get(githubId);
  if (token === undefined) return;
  tokens.delete(githubId);
  await world.db.prepare("UPDATE points_sessions SET expires_at=? WHERE token_hash=?").bind(new Date(Date.now() - 1000).toISOString(), await digest(token)).run();
}

/** @throws {never} */
function method(ask: Ask): string {
  return ask.method ?? (ask.body === undefined ? "GET" : "POST");
}

export async function respond(world: World, path: string, ask: Ask = {}): Promise<Response> {
  const headers: Record<string, string> = { ...ask.headers };
  if (ask.as !== undefined) {
    headers.cookie = [`__Host-slop_points=${await session(world, ask.as)}`, headers.cookie].filter((part) => part !== undefined).join("; ");
    headers["x-slop-expected-github-id"] = ask.as;
  }
  if (ask.json === true) {
    headers["content-type"] = "application/json";
    headers.origin = origin;
  }
  return world.mf.dispatchFetch(`${origin}${path}`, { method: method(ask), headers, redirect: "manual", ...(ask.body === undefined ? {} : { body: ask.body }) }) as unknown as Promise<Response>;
}

export async function request(world: World, path: string, ask: Ask = {}): Promise<Answer> {
  const response = await respond(world, path, ask);
  const type = response.headers.get("content-type") ?? "";
  const shown = ["cache-control", "set-cookie", "accept-ranges", "content-disposition", "x-robots-tag"];
  const headers = Object.fromEntries(shown.flatMap((name) => {
    const value = response.headers.get(name);
    return value === null ? [] : [[name, value]];
  }));
  const body = method(ask) === "HEAD" ? null : type.startsWith("application/json") ? await response.json() : new Uint8Array(await response.arrayBuffer());
  return { status: response.status, headers, body };
}

export async function signed(world: World, method: string, path: string, body: Uint8Array): Promise<Answer> {
  const key = Redacted.make(JSON.stringify({ kty: "OKP", crv: "Ed25519", d: base64url(bytesOf(seed)), x: base64url(bytesOf(publicKey)) }));
  const headers = await Effect.runPromise(Effect.provide(signedHeaders({ key, method, path, body }), webCrypto));
  return request(world, path, { method, body, headers: { ...headers, "content-type": "application/octet-stream" } });
}

export async function assessment(world: World, id: string, commit: string): Promise<void> {
  await world.db.prepare(`INSERT INTO vetting_assessments(id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,requested_by_github_id,requested_by_github_login,requested_at,request_reason,state)
    VALUES(?,?,1,?,?,?,?,'900','steward',?,'Evidence fixture','pending')`).bind(id, project, "a".repeat(64), "b".repeat(64), commit, "c".repeat(64), new Date().toISOString()).run();
}

export async function finish(world: World, id: string, state: "clean" | "incomplete" | "malicious", schemaVersion: string): Promise<void> {
  const [row] = (await world.db.prepare("SELECT commit_sha,template_sha256 FROM vetting_assessments WHERE id=?").bind(id).all()).results;
  const result = JSON.stringify({ schemaVersion, assessmentId: id, disposition: state, assessed: { commitSha: row?.commit_sha, templateSha256: row?.template_sha256 } });
  await world.db.prepare("UPDATE vetting_assessments SET state=?,policy_version='fixture',result=?,result_sha256=?,signing_key_sha256=?,completed_at=? WHERE id=?")
    .bind(state, result, await digest(result), "d".repeat(64), new Date().toISOString(), id).run();
}

export async function agedClosure(world: World, id: string, days: number): Promise<void> {
  await world.db.prepare("INSERT INTO vetting_evidence_case_closures(assessment_id,closed_at,closed_by,reason) VALUES(?,?,?,?)")
    .bind(id, new Date(Date.now() - days * 86_400_000).toISOString(), owner, "Aged fixture closure").run();
}

export async function rows(world: World, text: string, ...params: ReadonlyArray<string | number | null>): Promise<ReadonlyArray<Record<string, unknown>>> {
  return (await world.db.prepare(text).bind(...params).all()).results;
}

export async function reportCase(world: World, input: { readonly caseId: string; readonly submissionId: string; readonly reporter: string; readonly triagers: ReadonlyArray<string>; readonly text: string; readonly traceKey?: boolean }): Promise<void> {
  const at = new Date().toISOString();
  const bytes = new TextEncoder().encode(input.text);
  const sha = await digest(bytes);
  const key = input.traceKey === true ? `traces/sha256/${sha.slice(0, 2)}/${sha}` : `security-reports/${input.submissionId}/1-${sha}.json`;
  await world.reports.put(key, bytes, { customMetadata: { sha256: sha }, httpMetadata: { contentType: "application/json" } });
  await world.db.batch([
    world.db.prepare(`INSERT INTO security_cases(id,project_id,advisory_repository,reporter_github_id,reporter_github_login,submission_state,received_at,verified_at,verified_by_github_id,receipt_state,remediation_state,award_state,payment_state,disclosure_state,recognition,appeal_state,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,'verified',?,?,'900','received','not-started','not-applicable','not-applicable','embargoed','private','none',1,?,?)`).bind(input.caseId, project, "slop-test/evidence", input.reporter, `member-${input.reporter}`, at, at, at, at),
    world.db.prepare(`INSERT INTO security_submissions(id,project_id,repository,reporter_github_id,reporter_github_login,origin,idempotency_key,marker,state,case_id,revision,created_at,updated_at)
      VALUES(?,?,?,?,?,'slop',?,?,'draft',?,1,?,?)`).bind(input.submissionId, project, "slop-test/evidence", input.reporter, `member-${input.reporter}`, `idem-${input.submissionId}`, "e".repeat(32), input.caseId, at, at),
    world.db.prepare("INSERT INTO security_submission_intake(submission_id,case_id,received_at,report_version,screening_state,revision) VALUES(?,?,?,1,'queued',1)").bind(input.submissionId, input.caseId, at),
    world.db.prepare("INSERT INTO security_intake_reports(submission_id,version,object_key,content_sha256,byte_count,created_at) VALUES(?,1,?,?,?,?)").bind(input.submissionId, key, sha, bytes.length, at),
    ...input.triagers.map((triager) => world.db.prepare("INSERT INTO security_case_members(case_id,github_id,github_login,role,added_by_github_id,added_at) VALUES(?,?,?,'triager','900',?)").bind(input.caseId, triager, `member-${triager}`, at)),
  ]);
}

export async function revokeTriager(world: World, caseId: string, triager: string): Promise<void> {
  await world.db.prepare("UPDATE security_case_members SET revoked_at=?,revoked_by_github_id='900' WHERE case_id=? AND github_id=? AND revoked_at IS NULL").bind(new Date().toISOString(), caseId, triager).run();
}

export async function legacyObject(world: World, id: string, runId: string, bytes: Uint8Array): Promise<string> {
  const sha = await digest(bytes);
  const key = `vetting/${id}/${runId}/${sha}`;
  const manifest = JSON.stringify({ traceSha256: sha, objects: [{ sha256: sha, sizeBytes: bytes.length, kind: "trace", label: "legacy", contentType: "text/plain" }] });
  const at = new Date().toISOString();
  await world.db.batch([
    world.db.prepare("INSERT INTO vetting_evidence_runs(assessment_id,run_id,trace_sha256,manifest_sha256,manifest,policy,created_at,expires_at) VALUES(?,?,?,?,?,'{}',?,?)").bind(id, runId, sha, await digest(manifest), manifest, at, new Date(Date.now() + 86_400_000).toISOString()),
    world.db.prepare("INSERT INTO vetting_evidence_objects(assessment_id,run_id,sha256,size_bytes,kind,label,content_type,object_key,chunks,storage,storage_generation) VALUES(?,?,?,?,'trace','legacy','text/plain',?,NULL,'run',NULL)").bind(id, runId, sha, bytes.length, key),
  ]);
  return sha;
}

export async function backUp(world: World, root: string, keys: ReadonlyArray<string>, bytes: Uint8Array, sha256: string): Promise<void> {
  for (const key of keys) await world.backups.put(`${root}/objects/${key}`, bytes, { customMetadata: { sha256 }, httpMetadata: { contentType: "application/octet-stream" } });
}

export async function overwrite(world: World, key: string, bytes: Uint8Array, sha256: string): Promise<void> {
  await world.objects.put(key, bytes, { customMetadata: { sha256 }, httpMetadata: { contentType: "application/octet-stream" } });
}

export async function partialDownload(world: World, path: string, as: string, cookie: string, stopAfter: number, interrupt: () => Promise<void>): Promise<{ readonly status: number; readonly received: number; readonly failed: boolean }> {
  const response = await respond(world, path, { as, headers: { cookie, "sec-fetch-site": "same-origin" } });
  const stream = response.body;
  if (stream === null) return { status: response.status, received: 0, failed: false };
  const readerOf = stream.getReader();
  let received = 0;
  let interrupted = false;
  try {
    for (;;) {
      const { done, value } = await readerOf.read();
      if (done) return { status: response.status, received, failed: false };
      received += value.byteLength;
      if (!interrupted && received >= stopAfter) {
        interrupted = true;
        await interrupt();
      }
    }
  } catch {
    return { status: response.status, received, failed: true };
  }
}
