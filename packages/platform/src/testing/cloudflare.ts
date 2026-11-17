// spec/operations/release.md, "Workers publish before the static site, each only when its own release variable is enabled"; spec/operations/release.md, "The static site publishes last and a lost response is reconciled from the provider"
import { createHash } from "node:crypto";
import { Schema } from "effect";
import { type Request, Response } from "miniflare";
import { Disconnect, type Handler, statements } from "../testing.ts";

export interface WorkerVersion {
  readonly id: string;
  readonly tag: string | undefined;
  readonly modules: Readonly<Record<string, string>>;
}

export interface WorkerDeployment {
  readonly id: string;
  readonly versions: ReadonlyArray<{ readonly versionId: string; readonly percentage: number }>;
}

export interface PagesDeployment {
  readonly id: string;
  readonly branch: string;
  readonly commitHash: string;
  readonly commitDirty: boolean;
  readonly manifest: Readonly<Record<string, string>>;
  readonly worker: string | undefined;
}

export interface CloudflareState {
  readonly scripts: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly versions: Readonly<Record<string, ReadonlyArray<WorkerVersion>>>;
  readonly deployments: Readonly<Record<string, ReadonlyArray<WorkerDeployment>>>;
  readonly secrets: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly schedules: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly d1Migrations: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly pagesDeployments: Readonly<Record<string, ReadonlyArray<PagesDeployment>>>;
  readonly pagesAssets: ReadonlySet<string>;
}

export interface CloudflareCall {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly lost: boolean;
}

export interface LostResponse {
  readonly method?: string;
  readonly path: string | RegExp;
}

export interface CloudflareApi {
  readonly handler: Handler;
  readonly calls: ReadonlyArray<CloudflareCall>;
  readonly state: CloudflareState;
  /** @throws {never} */
  loseNext(match: LostResponse): void;
}

export class ResponseLost extends Disconnect {}

const SecretBody = Schema.Struct({ name: Schema.String, text: Schema.String, type: Schema.String });
const DeploymentBody = Schema.Struct({
  strategy: Schema.optionalKey(Schema.String),
  versions: Schema.Array(Schema.Struct({ version_id: Schema.String, percentage: Schema.Number })),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});
const SchedulesBody = Schema.Array(Schema.Struct({ cron: Schema.String }));
const QueryBody = Schema.Struct({ sql: Schema.String, params: Schema.optionalKey(Schema.Array(Schema.Unknown)) });
const HashesBody = Schema.Struct({ hashes: Schema.Array(Schema.String) });
const AssetsBody = Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String, base64: Schema.Boolean, metadata: Schema.optionalKey(Schema.Unknown) }));
const VersionMetadata = Schema.Struct({ annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) });
const Manifest = Schema.Record(Schema.String, Schema.String);

class Refusal extends Error {
  constructor(readonly status: number, readonly code: number, message: string) {
    super(message);
  }
}

function envelope(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}

function failure(refusal: Refusal): Response {
  return Response.json({ success: false, errors: [{ code: refusal.code, message: refusal.message }], messages: [], result: null }, { status: refusal.status });
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type Form = Awaited<ReturnType<Request["formData"]>>;

function text(value: ReturnType<Form["get"]>): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function decoded<S extends Schema.ConstraintDecoder<unknown>>(schema: S, request: Request): Promise<S["Type"]> {
  const body: unknown = await request.json().catch(() => undefined);
  try {
    return Schema.decodeUnknownSync(schema)(body);
  } catch (error) {
    throw new Refusal(400, 10021, `invalid request body: ${String(error)}`);
  }
}

async function modulesOf(form: Form): Promise<Record<string, string>> {
  const modules: Record<string, string> = {};
  for (const [name, value] of form.entries()) {
    if (name === "metadata" || typeof value === "string") continue;
    modules[value.name || name] = sha256(new Uint8Array(await value.arrayBuffer()));
  }
  return modules;
}

async function metadataOf(form: Form): Promise<typeof VersionMetadata.Type> {
  const entry = form.get("metadata");
  const raw = entry === null ? "{}" : typeof entry === "string" ? entry : await entry.text();
  return Schema.decodeUnknownSync(VersionMetadata)(JSON.parse(raw));
}

/** @throws {never} */
export function cloudflareApi({ accountId = "account-test" }: { readonly accountId?: string } = {}): CloudflareApi {
  const scripts: Record<string, Record<string, string>> = {};
  const versions: Record<string, WorkerVersion[]> = {};
  const deployments: Record<string, WorkerDeployment[]> = {};
  const secrets: Record<string, string[]> = {};
  const schedules: Record<string, string[]> = {};
  const d1Migrations: Record<string, string[]> = {};
  const pagesDeployments: Record<string, PagesDeployment[]> = {};
  const pagesAssets = new Set<string>();
  const calls: CloudflareCall[] = [];
  const lost: LostResponse[] = [];
  let sequence = 0;
  const next = (kind: string) => `${kind}-${String(++sequence).padStart(6, "0")}`;

  function addVersion(script: string, modules: Record<string, string>, tag: string | undefined): WorkerVersion {
    const version = { id: next("version"), tag, modules };
    (versions[script] ??= []).push(version);
    return version;
  }

  function deploy(script: string, chosen: ReadonlyArray<{ readonly versionId: string; readonly percentage: number }>): WorkerDeployment {
    const known = new Set((versions[script] ?? []).map((version) => version.id));
    const unknown = chosen.find((version) => !known.has(version.versionId));
    if (unknown !== undefined) throw new Refusal(400, 10200, `version ${unknown.versionId} does not exist for ${script}`);
    if (chosen.reduce((sum, version) => sum + version.percentage, 0) !== 100) throw new Refusal(400, 10201, "deployment percentages must total 100");
    const deployment = { id: next("deployment"), versions: chosen };
    (deployments[script] ??= []).push(deployment);
    return deployment;
  }

  function query(databaseId: string, sql: string) {
    return statements(sql).map((statement) => {
      if (/^\s*INSERT\s+INTO\s+d1_migrations\b/iu.test(statement)) {
        const names = [...statement.matchAll(/'([^']+\.sql)'/gu)].map(([, name]) => name ?? "");
        (d1Migrations[databaseId] ??= []).push(...names);
        return { results: [], success: true, meta: { changes: names.length } };
      }
      if (/^\s*SELECT\b[\s\S]*\bFROM\s+d1_migrations\b/iu.test(statement)) {
        const applied = d1Migrations[databaseId] ?? [];
        return { results: applied.map((name, index) => ({ id: index + 1, name, applied_at: "2026-11-16 00:00:00" })), success: true, meta: { changes: 0 } };
      }
      return { results: [], success: true, meta: { changes: 0 } };
    });
  }

  async function workers(request: Request, script: string, rest: ReadonlyArray<string>): Promise<Response> {
    const method = request.method;
    const [resource, item] = rest;
    if (resource === undefined) {
      if (method === "PUT") {
        const form = await request.formData();
        const modules = await modulesOf(form);
        const tag = (await metadataOf(form)).annotations?.["workers/tag"];
        scripts[script] = modules;
        const version = addVersion(script, modules, tag);
        deploy(script, [{ versionId: version.id, percentage: 100 }]);
        return envelope({ id: script, etag: sha256(JSON.stringify(modules)) });
      }
      if (method === "GET" && scripts[script] !== undefined) return envelope({ id: script, modules: scripts[script] });
      throw new Refusal(404, 10007, `workers.api.error.script_not_found: ${script}`);
    }
    if (resource === "versions" && method === "POST") {
      const form = await request.formData();
      const tag = (await metadataOf(form)).annotations?.["workers/tag"];
      const version = addVersion(script, await modulesOf(form), tag);
      return envelope({ id: version.id, number: (versions[script] ?? []).length, metadata: { annotations: tag === undefined ? {} : { "workers/tag": tag } } });
    }
    if (resource === "versions" && method === "GET")
      return envelope({ items: (versions[script] ?? []).map((version) => ({ id: version.id, annotations: version.tag === undefined ? {} : { "workers/tag": version.tag } })) });
    if (resource === "deployments" && method === "POST") {
      const body = await decoded(DeploymentBody, request);
      const deployment = deploy(script, body.versions.map((version) => ({ versionId: version.version_id, percentage: version.percentage })));
      return envelope({ id: deployment.id, versions: body.versions });
    }
    if (resource === "deployments" && method === "GET")
      return envelope({ deployments: [...deployments[script] ?? []].reverse().map((deployment) => ({ id: deployment.id, versions: deployment.versions.map((version) => ({ version_id: version.versionId, percentage: version.percentage })) })) });
    if (resource === "secrets" && method === "PUT" && item === undefined) {
      const body = await decoded(SecretBody, request);
      const names = secrets[script] ??= [];
      if (!names.includes(body.name)) names.push(body.name);
      return envelope({ name: body.name, type: body.type });
    }
    if (resource === "secrets" && method === "GET") return envelope((secrets[script] ?? []).map((name) => ({ name, type: "secret_text" })));
    if (resource === "secrets" && method === "DELETE" && item !== undefined) {
      secrets[script] = (secrets[script] ?? []).filter((name) => name !== item);
      return envelope(null);
    }
    if (resource === "schedules" && method === "PUT") {
      schedules[script] = (await decoded(SchedulesBody, request)).map((schedule) => schedule.cron);
      return envelope({ schedules: schedules[script].map((cron) => ({ cron })) });
    }
    if (resource === "schedules" && method === "GET") return envelope({ schedules: (schedules[script] ?? []).map((cron) => ({ cron })) });
    throw new Refusal(404, 7003, `Could not route to ${request.url}`);
  }

  async function pages(request: Request, project: string, rest: ReadonlyArray<string>): Promise<Response> {
    const [resource] = rest;
    if (resource === undefined && request.method === "GET") return envelope({ name: project, production_branch: "main" });
    if (resource === "upload-token" && request.method === "GET") return envelope({ jwt: `upload-token-${project}` });
    if (resource === "deployments" && request.method === "POST") {
      const form = await request.formData();
      const branch = text(form.get("branch")) ?? "main";
      const worker = form.get("_worker.js");
      const deployment: PagesDeployment = {
        id: next("pages"),
        branch,
        commitHash: text(form.get("commit_hash")) ?? "",
        commitDirty: text(form.get("commit_dirty")) === "true",
        manifest: Schema.decodeUnknownSync(Manifest)(JSON.parse(text(form.get("manifest")) ?? "{}")),
        worker: worker === null || typeof worker === "string" ? undefined : sha256(new Uint8Array(await worker.arrayBuffer())),
      };
      (pagesDeployments[project] ??= []).push(deployment);
      return envelope({ id: deployment.id, url: `https://${deployment.id}.${project}.pages.dev`, environment: branch === "main" ? "production" : "preview", deployment_trigger: { metadata: { branch, commit_hash: deployment.commitHash, commit_dirty: deployment.commitDirty } } });
    }
    if (resource === "deployments" && request.method === "GET")
      return envelope([...pagesDeployments[project] ?? []].reverse().map((deployment) => ({ id: deployment.id, url: `https://${deployment.id}.${project}.pages.dev`, deployment_trigger: { metadata: { branch: deployment.branch, commit_hash: deployment.commitHash, commit_dirty: deployment.commitDirty } } })));
    throw new Refusal(404, 7003, `Could not route to ${request.url}`);
  }

  async function assets(request: Request, action: string | undefined): Promise<Response> {
    if (action === "check-missing" && request.method === "POST")
      return envelope((await decoded(HashesBody, request)).hashes.filter((hash) => !pagesAssets.has(hash)));
    if (action === "upload" && request.method === "POST") {
      for (const asset of await decoded(AssetsBody, request)) pagesAssets.add(asset.key);
      return envelope(null);
    }
    if (action === "upsert-hashes" && request.method === "POST") {
      for (const hash of (await decoded(HashesBody, request)).hashes) pagesAssets.add(hash);
      return envelope(null);
    }
    throw new Refusal(404, 7003, `Could not route to ${request.url}`);
  }

  async function route(request: Request, segments: ReadonlyArray<string>): Promise<Response> {
    const [first, second, third, fourth, fifth, ...rest] = segments;
    if (first === "user" && second === "tokens" && third === "verify") return envelope({ id: "token-test", status: "active" });
    if (first === "pages" && second === "assets") return assets(request, third);
    if (first !== "accounts") throw new Refusal(404, 7003, `Could not route to ${request.url}`);
    if (second !== accountId) throw new Refusal(403, 10000, "Authentication error");
    if (third === "workers" && fourth === "scripts" && fifth === undefined && request.method === "GET")
      return envelope(Object.keys(scripts).map((id) => ({ id })));
    if (third === "workers" && fourth === "scripts" && fifth !== undefined) return workers(request, fifth, rest);
    if (third === "pages" && fourth === "projects" && fifth !== undefined) return pages(request, fifth, rest);
    if (third === "d1" && fourth === "database" && fifth !== undefined && rest[0] === "query" && request.method === "POST")
      return envelope(query(fifth, (await decoded(QueryBody, request)).sql));
    throw new Refusal(404, 7003, `Could not route to ${request.url}`);
  }

  function losing(method: string, path: string): boolean {
    const index = lost.findIndex((match) => (match.method === undefined || match.method === method) && (typeof match.path === "string" ? match.path === path : match.path.test(path)));
    if (index === -1) return false;
    lost.splice(index, 1);
    return true;
  }

  return {
    calls,
    state: { scripts, versions, deployments, secrets, schedules, d1Migrations, pagesDeployments, pagesAssets },
    loseNext: (match) => { lost.push(match); },
    handler: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/client\/v4/u, "");
      const authorized = /^Bearer \S+$/u.test(request.headers.get("authorization") ?? "");
      const response = authorized
        ? await route(request, path.split("/").filter((segment) => segment !== "")).catch((error: unknown) => {
          if (error instanceof Refusal) return failure(error);
          throw error;
        })
        : failure(new Refusal(401, 10000, "Authentication error"));
      const drop = losing(request.method, path);
      calls.push({ method: request.method, path, status: response.status, lost: drop });
      if (drop) throw new ResponseLost(`${request.method} ${path}: the response was lost after the change applied`);
      return response;
    },
  };
}
