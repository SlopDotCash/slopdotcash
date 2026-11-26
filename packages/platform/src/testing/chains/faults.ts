// spec/settlement/evmScan.md, "A run first authenticates the RPC chain, including for an empty page"; spec/settlement/solanaScan.md, "A fresh scan invocation verifies the selected endpoint's network"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { fetch, Request, Response } from "miniflare";
import type { Handler } from "../../testing.ts";

export type Fault = "timeout" | "http500" | "malformed" | "wrongChain" | "staleFinalized" | "lostResponse";

export interface FaultRule {
  readonly method?: string;
  readonly nth?: number;
  readonly fault: Fault;
}

export interface Fired {
  readonly method: string;
  readonly fault: Fault;
}

export interface RpcCall {
  readonly id: unknown;
  readonly method: string;
  readonly params: unknown;
}

export interface Served extends AsyncDisposable {
  readonly url: string;
  close(): Promise<void>;
}

const requestLimit = 1024 * 1024;
const json = { "content-type": "application/json" };
const solanaDevnet = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const solanaTestnet = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";

class LostResponse extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isCall = (value: unknown): value is RpcCall => isRecord(value) && typeof value.method === "string";

export function rpcCalls(bytes: Uint8Array): { readonly batch: boolean; readonly calls: ReadonlyArray<RpcCall> } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (Array.isArray(parsed)) return parsed.every(isCall) ? { batch: true, calls: parsed } : undefined;
  return isCall(parsed) ? { batch: false, calls: [parsed] } : undefined;
}

export function replaceStrings(value: unknown, replace: (text: string) => string): unknown {
  if (typeof value === "string") return replace(value);
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replace));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceStrings(item, replace)]));
  return value;
}

export function replay(request: Request, body: Uint8Array | string): Request {
  return new Request(request.url, { method: "POST", headers: json, body, signal: request.signal });
}

export function rewriteCalls(request: Request, batch: boolean, calls: ReadonlyArray<RpcCall>): Request {
  return replay(request, JSON.stringify(batch ? calls : calls[0]));
}

export async function mapResults(
  response: Response,
  calls: ReadonlyArray<RpcCall>,
  map: (call: RpcCall, result: unknown) => unknown,
): Promise<Response> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Response(text, { status: response.status, headers: json });
  }
  const answer = (item: unknown) => {
    if (!isRecord(item) || !("result" in item)) return item;
    const call = calls.find((candidate) => candidate.id === item.id);
    return call === undefined ? item : { ...item, result: map(call, item.result) };
  };
  const mapped = Array.isArray(parsed) ? parsed.map(answer) : answer(parsed);
  return new Response(JSON.stringify(mapped), { status: response.status, headers: json });
}

export async function rpc(url: string, method: string, params: ReadonlyArray<unknown> = []): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error(`${method} answered a non-object`);
  if (body.error !== undefined) throw new Error(`${method} failed: ${JSON.stringify(body.error)}`);
  return body.result;
}

/** @throws {never} */
export function forward(url: string): Handler {
  return async (request) => fetch(url, { method: "POST", headers: json, body: new Uint8Array(await request.arrayBuffer()), signal: request.signal });
}

const aborted = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    if (signal.aborted) reject(new LostResponse("aborted"));
    signal.addEventListener("abort", () => reject(new LostResponse("aborted")), { once: true });
  });

const identity = (call: RpcCall, result: unknown): unknown => {
  if (call.method === "eth_chainId" && typeof result === "string") return `0x${(BigInt(result) + 1n).toString(16)}`;
  if (call.method === "net_version" && typeof result === "string") return String(BigInt(result) + 1n);
  if (call.method === "getGenesisHash") return result === solanaDevnet ? solanaTestnet : solanaDevnet;
  return result;
};

const finalizedCommitment = (params: unknown) => Array.isArray(params) && params.some((item) => isRecord(item) && item.commitment === "finalized");

const earliest = (value: unknown) => (value === "finalized" || value === "safe" ? "earliest" : value);

const staleTags = (params: unknown) =>
  Array.isArray(params)
    ? params.map((item) => (isRecord(item) ? Object.fromEntries(Object.entries(item).map(([key, value]) => [key, key === "commitment" ? value : earliest(value)])) : earliest(item)))
    : params;

const stale = (call: RpcCall, result: unknown): unknown => {
  if (!finalizedCommitment(call.params)) return result;
  if (typeof result === "number") return 0;
  if (isRecord(result) && isRecord(result.context)) return { ...result, context: { ...result.context, slot: 0 } };
  return result;
};

/** @throws {RangeError} */
export function rpcFaults(upstream: Handler, plan: ReadonlyArray<FaultRule>): Handler & { readonly fired: ReadonlyArray<Fired> } {
  for (const rule of plan) {
    if (rule.nth !== undefined && (!Number.isSafeInteger(rule.nth) || rule.nth < 1)) throw new RangeError(`nth must be a positive integer, not ${rule.nth}`);
  }
  const counts = plan.map(() => 0);
  const fired: Fired[] = [];
  const choose = (calls: ReadonlyArray<RpcCall>): Fired | undefined => {
    let chosen: Fired | undefined;
    for (const call of calls) {
      plan.forEach((rule, index) => {
        if (rule.method !== undefined && rule.method !== call.method) return;
        counts[index] += 1;
        if (chosen === undefined && (rule.nth === undefined || rule.nth === counts[index])) chosen = { method: call.method, fault: rule.fault };
      });
    }
    return chosen;
  };
  const handler: Handler = async (request) => {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const parsed = rpcCalls(bytes);
    const original = () => replay(request, bytes);
    if (parsed === undefined) return upstream(original());
    const chosen = choose(parsed.calls);
    if (chosen === undefined) return upstream(original());
    fired.push(chosen);
    switch (chosen.fault) {
      case "timeout":
        return aborted(request.signal);
      case "http500":
        return new Response("upstream failure", { status: 500, headers: { "content-type": "text/plain" } });
      case "malformed": {
        const head = { jsonrpc: "2.0", id: parsed.calls[0]?.id ?? null };
        return new Response(`${parsed.batch ? "[" : ""}${JSON.stringify(head).slice(0, -1)},"result":`, { status: 200, headers: json });
      }
      case "lostResponse": {
        const answered = await upstream(original());
        await answered.arrayBuffer();
        throw new LostResponse(`${chosen.method} answer dropped`);
      }
      case "wrongChain":
        return mapResults(await upstream(original()), parsed.calls, identity);
      case "staleFinalized": {
        const calls = parsed.calls.map((call) => ({ ...call, params: staleTags(call.params) }));
        return mapResults(await upstream(rewriteCalls(request, parsed.batch, calls)), parsed.calls, stale);
      }
      default: {
        const _exhaustive: never = chosen.fault;
        return _exhaustive;
      }
    }
  };
  return Object.assign(handler, { fired });
}

async function readBody(incoming: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += part.length;
    if (size > requestLimit) return undefined;
    chunks.push(part);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function answer(handler: Handler, incoming: IncomingMessage, outgoing: ServerResponse, pending: Set<AbortController>): Promise<void> {
  const abort = new AbortController();
  pending.add(abort);
  outgoing.once("close", () => {
    if (!outgoing.writableFinished) abort.abort();
    pending.delete(abort);
  });
  try {
    const body = await readBody(incoming);
    if (body === undefined) {
      outgoing.writeHead(413).end();
      return;
    }
    const method = incoming.method ?? "GET";
    const headers = Object.fromEntries(Object.entries(incoming.headers).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])));
    const request = new Request(`http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url ?? "/"}`, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      signal: abort.signal,
    });
    const response = await handler(request);
    const bytes = new Uint8Array(await response.arrayBuffer());
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(bytes);
  } catch {
    outgoing.destroy();
  }
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("A loopback listener has no TCP port");
  return address.port;
}

export async function portsFree(ports: ReadonlyArray<number>): Promise<boolean> {
  const held: Server[] = [];
  try {
    for (const port of ports) {
      const server = createServer();
      await listen(server, port);
      held.push(server);
    }
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all(held.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

const inheritedEnvironment = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "TMP", "TEMP", "XDG_CACHE_HOME", "CI"] as const;

export function childEnvironment(extra: ReadonlyArray<"DOCKER_CONFIG" | "CARGO_HOME" | "RUSTUP_HOME"> = []): NodeJS.ProcessEnv {
  return Object.fromEntries([...inheritedEnvironment, ...extra].flatMap((name) => {
    const value = process.env[name];
    return value === undefined ? [] : [[name, value]];
  }));
}

const active = new Set<() => Promise<void>>();
let stopping = false;

async function stopOnSignal(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  const results = await Promise.allSettled([...active].map((close) => close()));
  for (const result of results) if (result.status === "rejected") process.emitWarning(result.reason instanceof Error ? result.reason : String(result.reason));
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onTerminate);
  process.kill(process.pid, signal);
}

const onInterrupt = () => void stopOnSignal("SIGINT");
const onTerminate = () => void stopOnSignal("SIGTERM");

export function supervised(close: () => Promise<void>): () => Promise<void> {
  let settled: Promise<void> | undefined;
  const run = () => {
    settled ??= close().finally(() => {
      active.delete(run);
      if (active.size === 0 && !stopping) {
        process.removeListener("SIGINT", onInterrupt);
        process.removeListener("SIGTERM", onTerminate);
      }
    });
    return settled;
  };
  if (active.size === 0) {
    stopping = false;
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);
  }
  active.add(run);
  return run;
}

export async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server, 0);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function serve(handler: Handler): Promise<Served> {
  const pending = new Set<AbortController>();
  const server = createServer((incoming, outgoing) => void answer(handler, incoming, outgoing, pending));
  const port = await listen(server, 0);
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= new Promise<void>((resolve) => {
      for (const abort of pending) abort.abort();
      server.closeAllConnections();
      server.close(() => resolve());
    });
    return closing;
  };
  return { url: `http://127.0.0.1:${port}`, close, [Symbol.asyncDispose]: close };
}
