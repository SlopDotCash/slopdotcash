// spec/operations/release.md, "Workers publish before the static site, each only when its own release variable is enabled"; spec/operations/release.md, "The static site publishes last and a lost response is reconciled from the provider"
import { createHash } from "node:crypto";
import { Schema } from "effect";
import type { Socket } from "effect/socket";
import { type Request, Response } from "miniflare";
import { Disconnect, type Handler, statements } from "../testing.ts";

export interface VersionBinding {
  readonly name: string;
  readonly type: string;
  readonly [field: string]: unknown;
}

export interface WorkerVersion {
  readonly id: string;
  readonly createdOn: string;
  readonly number: number;
  readonly tag: string | undefined;
  readonly annotations: Readonly<Record<string, string>>;
  readonly modules: Readonly<Record<string, string>>;
  readonly bindings: ReadonlyArray<VersionBinding>;
}

export interface WorkerDeployment {
  readonly id: string;
  readonly versions: ReadonlyArray<{ readonly versionId: string; readonly percentage: number }>;
  readonly annotations: Readonly<Record<string, string>>;
}

export interface EnvVar {
  readonly type: "plain_text" | "secret_text";
  readonly value?: string;
}

export interface Exposure {
  readonly enabled: boolean;
  readonly previews_enabled: boolean;
}

export interface PagesProject {
  readonly productionBranch: string;
  readonly production: Readonly<Record<string, EnvVar>>;
  readonly preview: Readonly<Record<string, EnvVar>>;
}

export interface PagesDeployment {
  readonly id: string;
  readonly createdOn: string;
  readonly environment: "production" | "preview";
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
  readonly pagesProjects: Readonly<Record<string, PagesProject>>;
  readonly pagesAssets: ReadonlySet<string>;
  readonly subdomains: Readonly<Record<string, Exposure>>;
  readonly scriptSettings: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
  /** @throws {never} */
  configurePages(project: string, configuration: Partial<PagesProject>): void;
}

export class ResponseLost extends Disconnect {}

const createdBase = Date.parse("2026-11-16T00:00:00.000Z");
const defaultProject: PagesProject = { productionBranch: "main", production: {}, preview: {} };
const closed: Exposure = { enabled: false, previews_enabled: false };

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
const Binding = Schema.StructWithRest(Schema.Struct({ name: Schema.String, type: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]);
const VersionMetadata = Schema.Struct({
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  bindings: Schema.optionalKey(Schema.Array(Binding)),
  keep_bindings: Schema.optionalKey(Schema.Array(Schema.String)),
});
const EnvBinding = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [Schema.Record(Schema.String, Schema.Unknown)]);
const LatestPatch = Schema.Struct({
  env: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(EnvBinding))),
  annotations: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
});
const ExposureBody = Schema.Struct({ enabled: Schema.Boolean, previews_enabled: Schema.optionalKey(Schema.Boolean) });
const SettingsBody = Schema.Record(Schema.String, Schema.Unknown);
const PagesVar = Schema.Struct({ type: Schema.Literals(["plain_text", "secret_text"]), value: Schema.optionalKey(Schema.String) });
const PagesConfig = Schema.Struct({ env_vars: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(PagesVar))) });
const PagesPatch = Schema.Struct({
  deployment_configs: Schema.optionalKey(Schema.Struct({ production: Schema.optionalKey(PagesConfig), preview: Schema.optionalKey(PagesConfig) })),
});
const Manifest = Schema.Record(Schema.String, Schema.String);

class Refusal extends Error {
  constructor(readonly status: number, readonly code: number, message: string) {
    super(message);
  }
}

function envelope(result: unknown, status = 200): Response {
  return Response.json({ success: true, errors: [], messages: [], result }, { status });
}

function pagedEnvelope(result: unknown, resultInfo: Readonly<Record<string, number>>): Response {
  return Response.json({ success: true, errors: [], messages: [], result, result_info: resultInfo });
}

function failure(refusal: Refusal): Response {
  return Response.json({ success: false, errors: [{ code: refusal.code, message: refusal.message }], messages: [], result: null }, { status: refusal.status });
}

function hidden(binding: VersionBinding): VersionBinding {
  return binding.type === "secret_text" ? { name: binding.name, type: binding.type } : binding;
}

function uploadToken(project: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part({ sub: `upload-token-${project}`, max_file_count_allowed: 20_000 })}.`;
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

async function bundleBindings(bundle: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<ReadonlyArray<typeof Binding.Type>> {
  const bytes = new Uint8Array(await bundle.arrayBuffer());
  const opening = new TextDecoder().decode(bytes.subarray(0, 256)).split("\r\n")[0] ?? "";
  if (!opening.startsWith("--")) return [];
  const form = await new Response(bytes, { headers: { "content-type": `multipart/form-data; boundary=${opening.slice(2)}` } }).formData();
  return (await metadataOf(form)).bindings ?? [];
}

interface Sequence {
  readonly next: () => string;
  readonly createdOn: () => string;
}

/** @throws {never} */
function pagesApi({ next, createdOn }: Sequence) {
  const pagesDeployments: Record<string, PagesDeployment[]> = {};
  const pagesProjects: Record<string, PagesProject> = {};
  const pagesAssets = new Set<string>();

  function projectOf(project: string): PagesProject {
    return pagesProjects[project] ?? defaultProject;
  }

  function pagesView(project: string, deployment: PagesDeployment) {
    return {
      id: deployment.id,
      url: `https://${deployment.id.slice(0, 8)}.${project}.pages.dev`,
      created_on: deployment.createdOn,
      environment: deployment.environment,
      project_name: project,
      is_skipped: false,
      latest_stage: { name: "deploy", status: "success" },
      deployment_trigger: { type: "ad_hoc", metadata: { branch: deployment.branch, commit_hash: deployment.commitHash, commit_dirty: deployment.commitDirty } },
    };
  }

  function patchProject(project: string, patch: typeof PagesPatch.Type): void {
    const current = projectOf(project);
    const merged = (vars: Readonly<Record<string, EnvVar>>, changes: Readonly<Record<string, EnvVar | null>> | undefined) =>
      Object.fromEntries(Object.entries({ ...vars, ...changes }).filter((entry): entry is [string, EnvVar] => entry[1] !== null));
    const configs = patch.deployment_configs;
    pagesProjects[project] = { ...current, production: merged(current.production, configs?.production?.env_vars), preview: merged(current.preview, configs?.preview?.env_vars) };
  }

  function envVars(vars: Readonly<Record<string, EnvVar>>) {
    return Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, value.type === "secret_text" ? { type: value.type } : value]));
  }

  function projectView(project: string) {
    const configured = projectOf(project);
    return { name: project, production_branch: configured.productionBranch, deployment_configs: { production: { env_vars: envVars(configured.production) }, preview: { env_vars: envVars(configured.preview) } } };
  }

  async function pages(request: Request, project: string, rest: ReadonlyArray<string>): Promise<Response> {
    const [resource, item] = rest;
    const configured = projectOf(project);
    if (resource === undefined && request.method === "PATCH") {
      patchProject(project, await decoded(PagesPatch, request));
      return envelope(projectView(project));
    }
    if (resource === undefined && request.method === "GET") return envelope(projectView(project));
    if (resource === "domains" && item !== undefined && request.method === "GET") return envelope({ name: item, status: "active" });
    if (resource === "upload-token" && request.method === "GET") return envelope({ jwt: uploadToken(project) });
    if (resource === "deployments" && request.method === "POST") {
      const form = await request.formData();
      const branch = text(form.get("branch")) ?? "main";
      const worker = form.get("_worker.bundle") ?? form.get("_worker.js");
      const environment = branch === configured.productionBranch ? "production" : "preview";
      if (worker !== null && typeof worker !== "string" && text(form.get("wrangler_config_hash")) !== undefined) {
        const vars = Object.fromEntries((await bundleBindings(worker)).flatMap((binding) => binding.type === "plain_text" && typeof binding.text === "string" ? [[binding.name, { type: "plain_text", value: binding.text } satisfies EnvVar]] : []));
        const current = projectOf(project);
        pagesProjects[project] = { ...current, [environment]: { ...current[environment], ...vars } };
      }
      const deployment: PagesDeployment = {
        id: next(),
        createdOn: createdOn(),
        environment,
        branch,
        commitHash: text(form.get("commit_hash")) ?? "",
        commitDirty: text(form.get("commit_dirty")) === "true",
        manifest: Schema.decodeUnknownSync(Manifest)(JSON.parse(text(form.get("manifest")) ?? "{}")),
        worker: worker === null || typeof worker === "string" ? undefined : sha256(new Uint8Array(await worker.arrayBuffer())),
      };
      (pagesDeployments[project] ??= []).push(deployment);
      return envelope(pagesView(project, deployment));
    }
    if (resource === "deployments" && item !== undefined && request.method === "GET") {
      const deployment = (pagesDeployments[project] ?? []).find((candidate) => candidate.id === item);
      if (deployment === undefined) throw new Refusal(404, 8000007, `deployment ${item} does not exist for ${project}`);
      return envelope(pagesView(project, deployment));
    }
    if (resource === "deployments" && request.method === "GET") {
      const query = new URL(request.url).searchParams;
      const environment = query.get("env");
      const perPage = Math.min(Math.max(Number(query.get("per_page") ?? 25) || 25, 1), 100);
      const page = Math.max(Number(query.get("page") ?? 1) || 1, 1);
      const listed = [...pagesDeployments[project] ?? []].reverse().filter((deployment) => environment === null || deployment.environment === environment);
      return pagedEnvelope(listed.slice((page - 1) * perPage, page * perPage).map((deployment) => pagesView(project, deployment)), { page, per_page: perPage, count: Math.min(perPage, Math.max(listed.length - (page - 1) * perPage, 0)), total_count: listed.length, total_pages: Math.ceil(listed.length / perPage) });
    }
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

  return { pagesDeployments, pagesProjects, pagesAssets, projectOf, pages, assets };
}

/** @throws {never} */
export function cloudflareApi({ accountId = "account-test" }: { readonly accountId?: string } = {}): CloudflareApi {
  const scripts: Record<string, Record<string, string>> = {};
  const versions: Record<string, WorkerVersion[]> = {};
  const deployments: Record<string, WorkerDeployment[]> = {};
  const secrets: Record<string, string[]> = {};
  const schedules: Record<string, string[]> = {};
  const d1Migrations: Record<string, string[]> = {};
  const subdomains: Record<string, Exposure> = {};
  const scriptSettings: Record<string, Record<string, unknown>> = {};
  const calls: CloudflareCall[] = [];
  const lost: LostResponse[] = [];
  let sequence = 0;
  const next = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, "0")}`;
  const createdOn = () => new Date(createdBase + sequence * 1_000).toISOString();
  const { pagesDeployments, pagesProjects, pagesAssets, projectOf, pages, assets } = pagesApi({ next, createdOn });

  function known(script: string): void {
    if (versions[script] === undefined) throw new Refusal(404, 10007, `workers.api.error.script_not_found: ${script}`);
  }

  function record(script: string, annotations: Readonly<Record<string, string>>, modules: Readonly<Record<string, string>>, bindings: ReadonlyArray<VersionBinding>, added: ReadonlyArray<VersionBinding>): WorkerVersion {
    const names = secrets[script] ??= [];
    for (const binding of added) if (binding.type === "secret_text" && !names.includes(binding.name)) names.push(binding.name);
    const version: WorkerVersion = { id: next(), createdOn: createdOn(), number: (versions[script]?.length ?? 0) + 1, tag: annotations["workers/tag"], annotations, modules, bindings };
    (versions[script] ??= []).push(version);
    return version;
  }

  function addVersion(script: string, modules: Record<string, string>, metadata: typeof VersionMetadata.Type): WorkerVersion {
    const previous = versions[script]?.at(-1);
    const kept = new Set(metadata.keep_bindings ?? []);
    const inherited = (previous?.bindings ?? []).filter((binding) => kept.has(binding.type));
    const given = (metadata.bindings ?? []).map(hidden);
    const named = new Set(given.map((binding) => binding.name));
    const uploaded = Object.keys(modules).length === 0 ? previous?.modules ?? {} : modules;
    return record(script, metadata.annotations ?? {}, uploaded, [...inherited.filter((binding) => !named.has(binding.name)), ...given], given);
  }

  function secretVersion(script: string, name: string, binding: VersionBinding | undefined): void {
    const latest = versions[script]?.at(-1);
    if (latest === undefined) return;
    const added = binding === undefined ? [] : [binding];
    const version = record(script, { "workers/triggered_by": "secret" }, latest.modules, [...latest.bindings.filter((kept) => kept.name !== name), ...added], added);
    deploy(script, [{ versionId: version.id, percentage: 100 }], {});
  }

  function patchLatest(script: string, patch: typeof LatestPatch.Type): WorkerVersion {
    const latest = versions[script]?.at(-1);
    if (latest === undefined) throw new Refusal(400, 10222, "There are currently no uploaded versions of this Worker.");
    const env = Object.entries(patch.env ?? {});
    const replaced = new Set(env.map(([name]) => name));
    const given = env.flatMap(([name, binding]) => binding === null ? [] : [hidden({ ...binding, name })]);
    const annotations = Object.fromEntries(Object.entries({ ...latest.annotations, ...patch.annotations }).filter((entry): entry is [string, string] => entry[1] !== null));
    return record(script, annotations, latest.modules, [...latest.bindings.filter((binding) => !replaced.has(binding.name)), ...given], given);
  }

  function versionView(script: string, version: WorkerVersion) {
    return {
      id: version.id,
      number: version.number,
      annotations: version.annotations,
      metadata: { created_on: version.createdOn, modified_on: version.createdOn, source: "wrangler", author_email: "release@slop.test" },
      resources: {
        bindings: version.bindings,
        script: { etag: sha256(JSON.stringify(version.modules)), handlers: ["fetch"] },
        script_runtime: { compatibility_date: "2026-11-13", compatibility_flags: [], usage_model: "standard" },
      },
      script,
    };
  }

  function deploy(script: string, chosen: ReadonlyArray<{ readonly versionId: string; readonly percentage: number }>, annotations: Readonly<Record<string, string>>): WorkerDeployment {
    const existing = new Set((versions[script] ?? []).map((version) => version.id));
    const unknown = chosen.find((version) => !existing.has(version.versionId));
    if (unknown !== undefined) throw new Refusal(400, 10200, `version ${unknown.versionId} does not exist for ${script}`);
    if (chosen.reduce((sum, version) => sum + version.percentage, 0) !== 100) throw new Refusal(400, 10201, "deployment percentages must total 100");
    const deployment = { id: next(), versions: chosen, annotations };
    (deployments[script] ??= []).push(deployment);
    return deployment;
  }

  function serviceView(name: string) {
    known(name);
    const created = versions[name]?.[0]?.createdOn;
    return { id: name, created_on: created, modified_on: versions[name]?.at(-1)?.createdOn, default_environment: { environment: "production", script: { id: name, tag: sha256(name).slice(0, 32), tags: [], last_deployed_from: "wrangler", handlers: ["fetch"] } } };
  }

  function service(request: Request, name: string, rest: ReadonlyArray<string>): Response {
    const [resource, environment, item] = rest;
    if (request.method !== "GET") throw new Refusal(404, 7003, `Could not route to ${request.url}`);
    if (resource === undefined) return envelope(serviceView(name));
    known(name);
    if (resource !== "environments" || environment !== "production") throw new Refusal(404, 10090, `workers.api.error.environment_not_found: ${name}/${environment ?? ""}`);
    if (item === "subdomain") return envelope(subdomains[name] ?? closed);
    if (item === "routes") return envelope([]);
    throw new Refusal(404, 7003, `Could not route to ${request.url}`);
  }

  function query(databaseId: string, sql: string) {
    return statements(sql).map((statement) => {
      if (/^\s*INSERT\s+INTO\s+"?d1_migrations\b/iu.test(statement)) {
        const names = [...statement.matchAll(/'([^']+\.sql)'/gu)].map(([, name]) => name ?? "");
        (d1Migrations[databaseId] ??= []).push(...names);
        return { results: [], success: true, meta: { changes: names.length } };
      }
      if (/^\s*SELECT\b[\s\S]*\bFROM\s+"?d1_migrations\b/iu.test(statement)) {
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
        const metadata = await metadataOf(form);
        scripts[script] = modules;
        const version = addVersion(script, modules, metadata);
        deploy(script, [{ versionId: version.id, percentage: 100 }], {});
        return envelope({ id: script, etag: sha256(JSON.stringify(modules)) });
      }
      if (method === "GET" && scripts[script] !== undefined) return envelope({ id: script, modules: scripts[script] });
      throw new Refusal(404, 10007, `workers.api.error.script_not_found: ${script}`);
    }
    if (resource === "versions" && method === "POST") {
      const form = await request.formData();
      const version = addVersion(script, await modulesOf(form), await metadataOf(form));
      return envelope(versionView(script, version));
    }
    if (resource === "versions" && method === "GET" && item === undefined)
      return envelope({ items: (versions[script] ?? []).map((version) => versionView(script, version)) });
    if (resource === "versions" && method === "GET") {
      const version = (versions[script] ?? []).find((candidate) => candidate.id === item);
      if (version === undefined) throw new Refusal(404, 10221, `version ${item} does not exist for ${script}`);
      return envelope(versionView(script, version));
    }
    if (resource === "deployments" && method === "POST") {
      const body = await decoded(DeploymentBody, request);
      const deployment = deploy(script, body.versions.map((version) => ({ versionId: version.version_id, percentage: version.percentage })), body.annotations ?? {});
      return envelope({ id: deployment.id, versions: body.versions, annotations: deployment.annotations, strategy: "percentage" });
    }
    if (resource === "deployments" && method === "GET")
      return envelope({ deployments: [...deployments[script] ?? []].reverse().map((deployment) => ({ id: deployment.id, strategy: "percentage", annotations: deployment.annotations, versions: deployment.versions.map((version) => ({ version_id: version.versionId, percentage: version.percentage })) })) });
    if (resource === "secrets" && method === "PUT" && item === undefined) {
      const body = await decoded(SecretBody, request);
      const names = secrets[script] ??= [];
      if (!names.includes(body.name)) names.push(body.name);
      secretVersion(script, body.name, { name: body.name, type: "secret_text" });
      return envelope({ name: body.name, type: body.type });
    }
    if (resource === "secrets" && method === "GET") return envelope((secrets[script] ?? []).map((name) => ({ name, type: "secret_text" })));
    if (resource === "secrets" && method === "DELETE" && item !== undefined) {
      secrets[script] = (secrets[script] ?? []).filter((name) => name !== item);
      secretVersion(script, item, undefined);
      return envelope(null);
    }
    if (resource === "schedules" && method === "PUT") {
      schedules[script] = (await decoded(SchedulesBody, request)).map((schedule) => schedule.cron);
      return envelope({ schedules: schedules[script].map((cron) => ({ cron })) });
    }
    if (resource === "schedules" && method === "GET") return envelope({ schedules: (schedules[script] ?? []).map((cron) => ({ cron })) });
    if (resource === "subdomain" && method === "GET") {
      known(script);
      return envelope(subdomains[script] ?? closed);
    }
    if (resource === "subdomain" && method === "POST") {
      known(script);
      const body = await decoded(ExposureBody, request);
      subdomains[script] = { enabled: body.enabled, previews_enabled: body.previews_enabled ?? body.enabled };
      return envelope(subdomains[script]);
    }
    if (resource === "script-settings" && method === "PATCH") {
      known(script);
      scriptSettings[script] = { ...scriptSettings[script], ...await decoded(SettingsBody, request) };
      return envelope(scriptSettings[script]);
    }
    if (resource === "script-settings" && method === "GET") {
      known(script);
      return envelope(scriptSettings[script] ?? {});
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
    if (third === "workers" && fourth === "workers" && fifth !== undefined && rest[0] === "versions" && rest[1] === "latest" && rest.length === 2 && request.method === "PATCH")
      return envelope(versionView(fifth, patchLatest(fifth, await decoded(LatestPatch, request))));
    if (third === "workers" && fourth === "services" && fifth !== undefined) return service(request, fifth, rest);
    if (third === "workers" && fourth === "domains" && fifth === "records" && rest.length === 0 && request.method === "GET") return envelope([]);
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
    state: { scripts, versions, deployments, secrets, schedules, d1Migrations, pagesDeployments, pagesProjects, pagesAssets, subdomains, scriptSettings },
    loseNext: (match) => { lost.push(match); },
    configurePages: (project, configuration) => { pagesProjects[project] = { ...projectOf(project), ...configuration }; },
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

export type TailEnding = "open" | "never" | "error" | number;

export interface TailSeen {
  readonly url: string;
  readonly protocols: unknown;
  readonly sent: Array<string>;
}

export type TailSockets = (url: string, options?: Socket.WebSocketConstructorOptions) => Socket.WebSocketLike;

/** @throws {never} */
export function tailSockets(frames: ReadonlyArray<string>, ending: TailEnding, seen: Array<TailSeen>): TailSockets {
  return (url, protocols) => {
    const record: TailSeen = { url, protocols, sent: [] };
    seen.push(record);
    const listeners = new Map<string, ReadonlyArray<(event: Socket.WebSocketEvent) => void>>();
    const emit = (type: string, event: Socket.WebSocketEvent) => {
      for (const listener of listeners.get(type) ?? []) listener(event);
    };
    return {
      readyState: ending === "never" ? 0 : 1,
      addEventListener: (type, listener) => { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
      removeEventListener: (type, listener) => { listeners.set(type, (listeners.get(type) ?? []).filter((known) => known !== listener)); },
      close: () => undefined,
      send: (data) => {
        record.sent.push(typeof data === "string" ? data : new TextDecoder().decode(data));
        for (const frame of frames) emit("message", { type: "message", data: frame });
        if (ending === "error") emit("error", { type: "error" });
        if (typeof ending === "number") emit("close", { type: "close", code: ending });
      },
    };
  };
}
