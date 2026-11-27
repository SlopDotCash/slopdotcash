import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { Schema } from "effect";
import { createBuilder, type BuildEnvironment } from "vite";
import { Miniflare, type MiniflareOptions, Request, Response } from "miniflare";
import type { D1Database, R2Bucket } from "./bindings.ts";

export type Handler = (request: Request) => Promise<Response> | Response;

const Sent = Schema.Struct({ from: Schema.String, to: Schema.String, raw: Schema.String });

export type SentMail = typeof Sent.Type;

export type MailSink = (mail: SentMail) => string | undefined | Promise<string | undefined>;

export interface MailBinding {
  readonly allowedDestinationAddresses?: ReadonlyArray<string>;
  readonly destinationAddress?: string;
  readonly sink?: MailSink;
}

/** @throws {never} */
export function onlyTo<R extends ReturnType<MailSink>>(allowed: ReadonlyArray<string> | undefined, sink: (mail: SentMail) => R): (mail: SentMail) => R | string {
  return allowed === undefined ? sink : (mail) => allowed.includes(mail.to) ? sink(mail) : `email to ${mail.to} is not an allowed destination`;
}

export interface QueueConsumer {
  readonly maxRetries: number;
  readonly deadLetterQueue?: string;
}

export interface Queues {
  readonly producers?: Readonly<Record<string, string>>;
  readonly consumers?: Readonly<Record<string, QueueConsumer>>;
}

export interface RateLimitOptions {
  readonly limit: number;
  readonly period: 10 | 60;
}

export interface EntrypointBinding {
  readonly worker: string;
  readonly entrypoint: string;
}

export interface Bindings {
  readonly d1?: Readonly<Record<string, string>>;
  readonly r2?: ReadonlyArray<string>;
  readonly vars?: Readonly<Record<string, string>>;
  readonly services?: Readonly<Record<string, Handler | EntrypointBinding>>;
  readonly queues?: Queues;
  readonly ratelimits?: Readonly<Record<string, RateLimitOptions>>;
  readonly email?: Readonly<Record<string, true | MailSink | MailBinding>>;
  readonly durableObjects?: Readonly<Record<string, string>>;
  readonly assets?: string;
  readonly routes?: ReadonlyArray<string>;
}

export type ExtraWorker = Bindings & { readonly name: string } & ({ readonly script: string } | { readonly module: string });

export interface WorkerOptions extends Bindings {
  readonly script?: string;
  readonly module?: string;
  readonly outbound?: Handler;
  readonly compatibilityDate?: string;
  readonly workers?: Readonly<Record<string, ExtraWorker>>;
}

const idle = "export default { fetch: () => new Response(null, { status: 404 }) };";

export interface Applied {
  readonly file: string;
  readonly statements: number;
  readonly error?: string;
}

export function statements(source: string): string[] {
  const found: string[] = [];
  let current = "", depth = 0, trigger = false, i = 0;
  const flush = () => {
    const text = current.trim();
    if (text) found.push(text);
    current = "";
    depth = 0;
    trigger = false;
  };
  while (i < source.length) {
    const c = source[i], next = source[i + 1];
    if (c === "-" && next === "-") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === close) {
          if (close !== "]" && source[j + 1] === close) { j += 2; continue; }
          break;
        }
        j++;
      }
      current += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < source.length && /\w/.test(source[j])) j++;
      const word = source.slice(i, j).toUpperCase();
      if (word === "TRIGGER" && /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?$/i.test(current)) trigger = true;
      if (trigger && (word === "BEGIN" || word === "CASE")) depth++;
      if (trigger && word === "END") depth--;
      current += source.slice(i, j);
      i = j;
      continue;
    }
    if (c === ";" && depth === 0) {
      flush();
      i++;
      continue;
    }
    current += c;
    i++;
  }
  flush();
  return found;
}

export interface BundleOptions {
  readonly config?: string;
  readonly entry?: string;
}

function entryFile(environment: BuildEnvironment): string | undefined {
  const output = environment.config.build.rolldownOptions.output;
  const names = (Array.isArray(output) ? output : [output]).map((options) => options?.entryFileNames);
  return names.find((name): name is string => typeof name === "string");
}

export async function bundle(root: string, { config = "vite.config.ts", entry }: BundleOptions = {}): Promise<string> {
  const configFile = join(root, config);
  const outDir = join(root, ".cache/worker");
  const probe = await createBuilder({ root, configFile, logLevel: "error" });
  const built = Object.entries(probe.environments).flatMap(([name, environment]) => {
    const file = entryFile(environment);
    return environment.config.consumer === "server" && file !== undefined ? [{ name, file }] : [];
  });
  const target = entry === undefined
    ? built.length === 1 ? built[0] : undefined
    : built.find(({ file }) => file === `${entry}.js`);
  if (target === undefined) throw new Error(`${configFile} builds ${built.map(({ file }) => file).join(", ") || "no Worker"}; name one of them as the entry`);
  const builder = await createBuilder({
    root,
    configFile,
    logLevel: "error",
    build: { outDir, emptyOutDir: false, sourcemap: false },
    environments: { [target.name]: { build: { outDir, emptyOutDir: false, sourcemap: false } } },
  });
  const environment = builder.environments[target.name];
  if (environment === undefined) throw new Error(`${configFile} lost its ${target.name} environment`);
  await builder.build(environment);
  return join(outDir, target.file);
}

const migrator = `export default {
  async fetch(request, env) {
    const { binding, files } = await request.json();
    const db = env[binding];
    const applied = [];
    for (const { file, statements } of files) {
      try {
        await db.batch(statements.map((text) => db.prepare(text)));
        applied.push({ file, statements: statements.length });
      } catch (error) {
        applied.push({ file, statements: statements.length, error: String(error?.message ?? error) });
        break;
      }
    }
    return Response.json(applied);
  },
};`;

const mailer = `import { WorkerEntrypoint } from "cloudflare:workers";
export class Mail extends WorkerEntrypoint {
  async send(message) {
    const raw = message["EmailMessage::raw"];
    if (raw === undefined) throw new Error("the captured send_email binding takes an EmailMessage");
    const text = typeof raw === "string" ? raw : await new Response(raw).text();
    const answer = await this.env.SINK.fetch("http://mail.capture/", { method: "POST", body: JSON.stringify({ from: message.from, to: message.to, raw: text }) });
    if (answer.status !== 200) throw new Error(await answer.text());
    return { messageId: answer.headers.get("x-message-id") ?? "" };
  }
}
export default { fetch: () => new Response(null, { status: 404 }) };`;

export async function migrate(mf: Miniflare, binding: string, directory: string): Promise<Applied[]> {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    .map((file) => ({ file, statements: statements(readFileSync(join(directory, file), "utf8")) }));
  const worker = (await mf.getWorker("migrator")) as unknown as { fetch(url: string, init: { method: string; body: string }): Promise<Response> };
  const response = await worker.fetch("http://migrator.test/", { method: "POST", body: JSON.stringify({ binding, files }) });
  return (await response.json()) as Applied[];
}

type WorkerConfig = MiniflareOptions["workers"][number];
type Env = NonNullable<WorkerConfig["config"]["env"]>;

const compatibilityDate = "2026-11-13";

function esm(main: string, contents: string) {
  return { mainModule: main, modules: { [main]: { type: "esm" as const, contents } } };
}

function fetcher(handle: Handler) {
  return { type: "fetcher" as const, handler: async (request: Request) => handle(request) };
}

const loopbackHost = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/u;

async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

export class Disconnect extends Error {}

function connection(handle: Handler, outboundErrors: string[]) {
  return {
    type: "node-handler" as const,
    handler: async (incoming: IncomingMessage, outgoing: ServerResponse) => {
      const host = incoming.headers.host ?? "";
      const aborted = new AbortController();
      outgoing.on("close", () => { if (!outgoing.writableFinished) aborted.abort(); });
      const headers = Object.entries(incoming.headers).flatMap(([name, value]) =>
        name === "mf-custom-node-service" || value === undefined ? [] : (Array.isArray(value) ? value : [value]).map((one) => [name, one] as [string, string]));
      const body = await bodyOf(incoming);
      try {
        const answer = await handle(new Request(`${loopbackHost.test(host) ? "http" : "https"}://${host}${incoming.url ?? "/"}`, { method: incoming.method ?? "GET", headers, body, signal: aborted.signal }));
        const bytes = Buffer.from(await answer.arrayBuffer());
        outgoing.writeHead(answer.status, answer.statusText, [...answer.headers].flat());
        outgoing.end(bytes);
      } catch (error) {
        if (error instanceof Disconnect) {
          incoming.socket.destroy();
          return;
        }
        const text = error instanceof Error ? error.stack ?? error.message : String(error);
        outboundErrors.push(text);
        outgoing.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        outgoing.end(text);
      }
    },
  };
}

function sinkHandler(sink: MailSink): Handler {
  let sent = 0;
  return async (request) => {
    const mail = Schema.decodeUnknownSync(Sent)(await request.json());
    const refusal = await sink(mail);
    sent += 1;
    return refusal === undefined
      ? new Response(null, { status: 200, headers: { "x-message-id": `captured-${sent}` } })
      : new Response(refusal, { status: 500 });
  };
}

interface Built {
  readonly env: Env;
  readonly triggers: NonNullable<WorkerConfig["config"]["triggers"]>;
  readonly exports: NonNullable<WorkerConfig["config"]["exports"]>;
  readonly mailers: ReadonlyArray<WorkerConfig>;
}

function bindingsOf(worker: string, options: Bindings, namespaces: { next: number }, compatibility: string): Built {
  const mailers: WorkerConfig[] = [];
  const email = Object.fromEntries(Object.entries(options.email ?? {}).map(([binding, option]): readonly [string, Env[string]] => {
    const { allowedDestinationAddresses, destinationAddress, sink }: MailBinding = option === true ? {} : typeof option === "function" ? { sink: option } : option;
    if (sink === undefined) {
      return [binding, {
        type: "send-email" as const,
        ...destinationAddress === undefined ? {} : { destinationAddress },
        ...allowedDestinationAddresses === undefined ? {} : { allowedDestinationAddresses: [...allowedDestinationAddresses] },
      }];
    }
    const allowed = destinationAddress === undefined ? allowedDestinationAddresses : [destinationAddress];
    const name = `mail-${worker}-${binding}`;
    mailers.push({ config: { name, compatibilityDate: compatibility, manifest: esm("mail.js", mailer), env: { SINK: fetcher(sinkHandler(onlyTo(allowed, sink))) } } });
    return [binding, { type: "worker" as const, worker: name, exportName: "Mail" }];
  }));
  const env: Env = {
    ...Object.fromEntries(Object.entries(options.d1 ?? {}).map(([binding, name]) => [binding, { type: "d1" as const, id: name, name }])),
    ...Object.fromEntries((options.r2 ?? []).map((binding) => [binding, { type: "r2" as const, name: binding }])),
    ...Object.fromEntries(Object.entries(options.vars ?? {}).map(([binding, value]) => [binding, { type: "text" as const, value }])),
    ...Object.fromEntries(Object.entries(options.services ?? {}).map(([binding, service]) => [binding, typeof service === "function" ? fetcher(service) : { type: "worker" as const, worker: service.worker, exportName: service.entrypoint }])),
    ...Object.fromEntries(Object.entries(options.queues?.producers ?? {}).map(([binding, name]) => [binding, { type: "queue" as const, name }])),
    ...Object.fromEntries(Object.entries(options.ratelimits ?? {}).map(([binding, simple]) => [binding, { type: "rate-limit" as const, namespace: String(namespaces.next++), simple }])),
    ...Object.fromEntries(Object.entries(options.durableObjects ?? {}).map(([binding, exportName]) => [binding, { type: "durable-object" as const, worker, exportName }])),
    ...options.assets === undefined ? {} : { ASSETS: { type: "assets" as const } },
    ...email,
  };
  const triggers = [
    ...Object.entries(options.queues?.consumers ?? {}).map(([name, consumer]) => ({
      type: "queue" as const,
      name,
      maxBatchTimeout: 0,
      retryDelay: 0,
      maxRetries: consumer.maxRetries,
      ...consumer.deadLetterQueue === undefined ? {} : { deadLetterQueue: consumer.deadLetterQueue },
    })),
    ...(options.routes ?? []).map((pattern) => ({ type: "fetch" as const, pattern })),
  ];
  const exports = Object.fromEntries(Object.values(options.durableObjects ?? {}).map((className) => [className, { type: "durable-object" as const, storage: "sqlite" as const }]));
  return { env, triggers, exports, mailers };
}

function workerConfig(name: string, source: string, options: Bindings, compatibility: string, namespaces: { next: number }, outbound: Handler | undefined, outboundErrors: string[]): ReadonlyArray<WorkerConfig> {
  const built = bindingsOf(name, options, namespaces, compatibility);
  return [{
    config: {
      name,
      compatibilityDate: compatibility,
      manifest: esm("worker.js", source),
      env: built.env,
      ...built.triggers.length === 0 ? {} : { triggers: built.triggers },
      ...Object.keys(built.exports).length === 0 ? {} : { exports: built.exports },
      ...options.assets === undefined ? {} : { assets: { directory: options.assets, runWorkerFirst: true, hasUserWorker: true, ...existsSync(join(options.assets, "404.html")) ? { notFoundHandling: "404-page" as const } : {} } },
    },
    dev: { cacheAPI: true, ...outbound === undefined ? {} : { outboundService: connection(outbound, outboundErrors) } },
  }, ...built.mailers];
}

function sourceOf(worker: { readonly script?: string; readonly module?: string }): string {
  return worker.script !== undefined ? readFileSync(worker.script, "utf8") : worker.module ?? idle;
}

export function workerOptions(options: WorkerOptions, outboundErrors: string[]): MiniflareOptions {
  const compatibility = options.compatibilityDate ?? compatibilityDate;
  const namespaces = { next: 1001 };
  const extras = Object.entries(options.workers ?? {});
  const services = Object.fromEntries(extras.map(([binding, extra]) => [binding, { type: "worker" as const, worker: extra.name }]));
  const main = workerConfig("worker", sourceOf(options), options, compatibility, namespaces, options.outbound, outboundErrors).map((config, index) =>
    index === 0 ? { ...config, config: { ...config.config, env: { ...config.config.env, ...services } } } : config);
  const databases = Object.fromEntries([options, ...extras.map(([, extra]) => extra)].flatMap((worker) => Object.entries(worker.d1 ?? {}))
    .map(([binding, name]) => [binding, { type: "d1" as const, id: name, name }]));
  return {
    telemetry: { enabled: false },
    cf: false,
    enableDevRegistry: false,
    logRequests: false,
    workers: [
      ...main,
      ...extras.flatMap(([, extra]) => workerConfig(extra.name, sourceOf(extra), extra, compatibility, namespaces, options.outbound, outboundErrors)),
      { config: { name: "migrator", compatibilityDate: compatibility, manifest: esm("migrator.js", migrator), env: databases } },
    ],
  };
}

export type StartedWorker = Miniflare & { readonly outboundErrors: ReadonlyArray<string> };

export function startWorker(options: WorkerOptions): StartedWorker {
  const outboundErrors: string[] = [];
  return Object.assign(new Miniflare(workerOptions(options, outboundErrors)), { outboundErrors });
}

export interface ScheduledOutcome {
  readonly outcome: string;
  readonly noRetry: boolean;
}

export interface QueueOutcome {
  readonly outcome: string;
  readonly ackAll: boolean;
  readonly retryMessages: ReadonlyArray<{ readonly msgId: string }>;
  readonly explicitAcks: ReadonlyArray<string>;
}

interface Triggers {
  scheduled(options: { cron: string }): Promise<ScheduledOutcome>;
  queue(queue: string, messages: ReadonlyArray<{ id: string; timestamp: Date; body: unknown; attempts: number }>): Promise<QueueOutcome>;
}

export async function scheduled(mf: Miniflare, cron: string): Promise<ScheduledOutcome> {
  return ((await mf.getWorker()) as unknown as Triggers).scheduled({ cron });
}

export async function queue(mf: Miniflare, name: string, bodies: ReadonlyArray<unknown>): Promise<QueueOutcome> {
  const messages = bodies.map((body, index) => ({ id: `message-${index}`, timestamp: new Date(0), body, attempts: 1 }));
  return ((await mf.getWorker()) as unknown as Triggers).queue(name, messages);
}

export async function database(mf: Miniflare, binding: string, worker?: string): Promise<D1Database> {
  const found = (await mf.getBindings<Readonly<Record<string, D1Database | undefined>>>(worker))[binding];
  if (found === undefined) throw new Error(`the worker has no D1 binding ${binding}`);
  return found;
}

export async function storage(mf: Miniflare, binding: string): Promise<R2Bucket> {
  return (await mf.getR2Bucket(binding)) as unknown as R2Bucket;
}
