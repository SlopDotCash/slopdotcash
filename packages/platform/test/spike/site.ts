import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { Log, LogLevel, Miniflare } from "miniflare";
import type { SiteFiles } from "./build.ts";

class Captured extends Log {
  readonly lines: string[] = [];
  constructor() {
    super(LogLevel.INFO);
  }
  override logWithLevel(level: LogLevel, message: string): void {
    this.lines.push(message);
    if (level <= LogLevel.WARN) super.logWithLevel(level, message);
  }
}

const compatibilityDate = "2026-11-13";

function module(path: string) {
  return { mainModule: "worker.js", modules: { "worker.js": { type: "esm" as const, contents: readFileSync(path, "utf8") } } };
}

export interface Site {
  readonly mf: Miniflare;
  readonly logged: ReadonlyArray<string>;
}

export function startSite(built: SiteFiles, port?: number): Site {
  const log = new Captured();
  const db = { type: "d1" as const, id: "spike", name: "spike" };
  const mf = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    enableDevRegistry: false,
    logRequests: false,
    log,
    ...port === undefined ? {} : { host: "127.0.0.1", port },
    workers: [{
      config: {
        name: "pages",
        compatibilityDate,
        manifest: module(built.pages),
        assets: { directory: built.assets, runWorkerFirst: true, hasUserWorker: true },
        env: {
          DB: db,
          ASSETS: { type: "assets" },
          JOURNAL: { type: "durable-object", worker: "service", exportName: "Journal" },
          VERIFIER: { type: "worker", worker: "service", exportName: "Verifier" },
          LIMITER: { type: "rate-limit", namespace: "1001", simple: { limit: 2, period: 60 } },
          EMAIL: { type: "send-email", allowedDestinationAddresses: ["member@slop.test"] },
          JOBS: { type: "queue", name: "spike-jobs" },
        },
      },
      dev: { cacheAPI: true },
    }, {
      config: {
        name: "service",
        compatibilityDate,
        manifest: module(built.service),
        exports: { Journal: { type: "durable-object", storage: "sqlite" } },
        triggers: [
          { type: "queue", name: "spike-jobs", maxBatchTimeout: 0, maxRetries: 1, retryDelay: 0, deadLetterQueue: "spike-jobs-dlq" },
          { type: "queue", name: "spike-jobs-dlq", maxBatchTimeout: 0 },
        ],
        env: { DB: db },
      },
    }],
  });
  return { mf, logged: log.lines };
}

export function sentEmail(logged: ReadonlyArray<string>): ReadonlyArray<string> {
  return logged.flatMap((line) => [...line.matchAll(/Email: (\S+\.eml)/gu)].map(([, file]) => readFileSync(file ?? "", "utf8")));
}

export interface Answer {
  readonly status: number;
  readonly type: string;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Ask {
  readonly method?: string;
  readonly json?: unknown;
  readonly origin?: string;
}

export async function ask(mf: Miniflare, path: string, { method = "GET", json, origin }: Ask = {}): Promise<Answer> {
  const headers: Record<string, string> = json === undefined ? {} : { "content-type": "application/json" };
  if (origin !== undefined) headers.origin = origin;
  const response = await mf.dispatchFetch(`https://spike.test${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) });
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  return { status: response.status, type, body: type.startsWith("application/json") && text !== "" ? JSON.parse(text) : text, headers: Object.fromEntries(response.headers) };
}

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runProgram(file: string, args: ReadonlyArray<string>): Promise<Ran> {
  return new Promise((resolve) => {
    execFile(process.execPath, [file, ...args], (error, stdout, stderr) => resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, stdout, stderr }));
  });
}

export function sizes(file: string): { readonly bytes: number; readonly gzip: number } {
  const bytes = readFileSync(file);
  return { bytes: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
}

export const spikeCache = join(import.meta.dirname, "../../.cache/spike");
export const backendRoot = join(import.meta.dirname, "../../../../apps/backend");

/** @throws {Error} */
export function readText(file: string): string {
  return readFileSync(file, "utf8");
}

/** @throws {Error} */
export function bundleSizes(files: Readonly<Record<string, string>>): Record<string, { readonly bytes: number; readonly gzip: number }> {
  return Object.fromEntries(Object.entries(files).map(([name, file]) => [name, sizes(file)]));
}

export const exploreRoot = join(import.meta.dirname, "explore");

export type Reported = readonly [ok: boolean, stage: string, summary: string, detail?: string, where?: string];
type Remember = <T>(fingerprint: string, run: () => Promise<T>, keep: (result: T) => boolean) => Promise<T>;
interface ExploreStage {
  explore(directory: string, remember: Remember, mode: "normal"): Promise<ReadonlyArray<Reported>>;
}

export async function exploreStage(directory: string): Promise<ReadonlyArray<Reported>> {
  const stage = (await import(join(import.meta.dirname, "../../../../vibestack/explore.ts"))) as ExploreStage;
  return stage.explore(directory, (_fingerprint, run) => run(), "normal");
}
