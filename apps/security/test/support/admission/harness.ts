// spec/security/admission.md, "A signed service request binds method, path, timestamp and body digest and is refused outside a five-minute window"; spec/security/admission.md, "The outcome and the per-assessment record are what enforcement reads"
import { Effect, Redacted } from "effect";
import { Response } from "miniflare";
import type { D1Database } from "@repo/platform/bindings";
import { base64url, ed25519Sign, sha256Hex, webCrypto } from "@repo/platform/crypto";
import { signatureHeaders, signedMessage } from "@repo/platform/signed";
import { type StartedWorker, bundle, database, migrate, startWorker } from "@repo/platform/testing";
import { migrationsDir } from "@repo/platform/testing/paths";

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
  readonly mf: StartedWorker;
  readonly sandbox: ReadonlyArray<string>;
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

export async function started(keys: string = configuredKeys): Promise<World> {
  const script = await bundle(root, { config: "test/support/admission/vite.config.ts", entry: "admission" });
  const sandbox: string[] = [];
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
        return new Response(JSON.stringify({ outcome: "exited" }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  });
  const failed = (await migrate(mf, "SLOP_DB", migrationsDir)).find((applied) => applied.error !== undefined);
  if (failed !== undefined) throw new Error(`migration ${failed.file} failed: ${failed.error}`);
  const db = await database(mf, "SLOP_DB");
  const at = new Date(Date.now() - 3_600_000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)").bind(project, manifest, "a".repeat(64), "Admission fixture", at),
    db.prepare("INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)").bind(project, manifest, "a".repeat(64), at, at),
    db.prepare(`INSERT INTO vetting_assessments(id,project_id,revision,manifest_sha256,content_sha256,commit_sha,template_sha256,requested_by_github_id,requested_by_github_login,requested_at,request_reason,state,repository_id,flag_ids)
      VALUES(?,?,1,?,?,?,?,'900','steward',?,'Automatic scan of new project content','pending','slop-test/admission','[]')`).bind(pending, project, "a".repeat(64), "b".repeat(64), commit, template, at),
  ]);
  return { db, mf, sandbox };
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
