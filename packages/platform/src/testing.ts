import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
import { Miniflare, type Request, type Response } from "miniflare";
import type { D1Database, R2Bucket } from "./bindings.ts";

export type Handler = (request: Request) => Promise<Response> | Response;

export interface WorkerOptions {
  readonly script?: string;
  readonly d1?: Readonly<Record<string, string>>;
  readonly r2?: ReadonlyArray<string>;
  readonly vars?: Readonly<Record<string, string>>;
  readonly services?: Readonly<Record<string, Handler>>;
  readonly outbound?: Handler;
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
    const c = source[i]!, next = source[i + 1];
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
      while (j < source.length && /\w/.test(source[j]!)) j++;
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

export async function bundle(root: string): Promise<string> {
  const outDir = join(root, ".cache/worker");
  await build({ root, configFile: join(root, "vite.config.ts"), logLevel: "error", build: { outDir, emptyOutDir: true, sourcemap: false } });
  return join(outDir, "worker.js");
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

export async function migrate(mf: Miniflare, binding: string, directory: string): Promise<Applied[]> {
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()
    .map((file) => ({ file, statements: statements(readFileSync(join(directory, file), "utf8")) }));
  const worker = (await mf.getWorker("migrator")) as unknown as { fetch(url: string, init: { method: string; body: string }): Promise<Response> };
  const response = await worker.fetch("http://migrator.test/", { method: "POST", body: JSON.stringify({ binding, files }) });
  return (await response.json()) as Applied[];
}

export function startWorker(options: WorkerOptions): Miniflare {
  const fetcher = (handle: Handler) => ({ type: "fetcher" as const, handler: async (request: Request) => handle(request) });
  const databases = Object.fromEntries(Object.entries(options.d1 ?? {}).map(([binding, name]) => [binding, { type: "d1" as const, id: name, name }]));
  const env = {
    ...databases,
    ...Object.fromEntries((options.r2 ?? []).map((binding) => [binding, { type: "r2" as const, name: binding }])),
    ...Object.fromEntries(Object.entries(options.vars ?? {}).map(([binding, value]) => [binding, { type: "text" as const, value }])),
    ...Object.fromEntries(Object.entries(options.services ?? {}).map(([binding, handle]) => [binding, fetcher(handle)])),
  };
  return new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    enableDevRegistry: false,
    logRequests: false,
    workers: [{
      config: {
        name: "worker",
        compatibilityDate: "2026-11-13",
        manifest: { mainModule: "worker.js", modules: { "worker.js": { type: "esm", contents: options.script === undefined ? idle : readFileSync(options.script, "utf8") } } },
        env,
      },
      ...options.outbound === undefined ? {} : { dev: { outboundService: fetcher(options.outbound) } },
    }, {
      config: {
        name: "migrator",
        compatibilityDate: "2026-11-13",
        manifest: { mainModule: "migrator.js", modules: { "migrator.js": { type: "esm", contents: migrator } } },
        env: databases,
      },
    }],
  });
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

export async function database(mf: Miniflare, binding: string): Promise<D1Database> {
  return (await mf.getD1Database(binding)) as unknown as D1Database;
}

export async function storage(mf: Miniflare, binding: string): Promise<R2Bucket> {
  return (await mf.getR2Bucket(binding)) as unknown as R2Bucket;
}
