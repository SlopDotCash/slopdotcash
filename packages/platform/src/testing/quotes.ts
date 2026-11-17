// spec/fees/conversion.md, "Story: Sign only a reserved, inspected, same-wallet send"; spec/fees/buyback.md, "Story: Bridge the available share through one exact order at a time"
import { Option, Schema } from "effect";
import { Request, Response } from "miniflare";
import type { Handler } from "../testing.ts";
import { type DlnScript, dln, dlnOrigin, dlnRefusal } from "./quotes/dln.ts";
import { type JupiterScript, jupiter, jupiterOrigin, jupiterRefusal } from "./quotes/jupiter.ts";
import { type KyberSwapScript, kyberswap, kyberswapOrigin, kyberswapRefusal } from "./quotes/kyberswap.ts";
import { type SolanaHistoryScript, historyMethod, solanaHistory, solanaHistoryRefusal } from "./quotes/solanaHistory.ts";

export type { DlnEvmOrder, DlnOrderScript, DlnSolanaOrder, DlnSolanaRequest } from "./quotes/dln.ts";
export { dlnSolanaChainId, dlnSourceAbi } from "./quotes/dln.ts";
export type { JupiterQuoteScript, JupiterSwapRequest, JupiterSwapScript } from "./quotes/jupiter.ts";
export type { KyberRouteScript } from "./quotes/kyberswap.ts";
export { kyberNative, kyberRouterAbi } from "./quotes/kyberswap.ts";
export type { SignatureItem } from "./quotes/solanaHistory.ts";

export type QuoteService = "kyberswap" | "jupiter" | "dln" | "solanaHistory";
export type QuoteFailure = "noRoute" | "unavailable" | "malformed" | "tooLarge" | "timeout";

export interface FailureModes {
  readonly kyberswap: QuoteFailure;
  readonly jupiter: QuoteFailure;
  readonly dln: QuoteFailure;
  readonly solanaHistory: Exclude<QuoteFailure, "noRoute">;
}

export interface QuoteCall {
  readonly service: QuoteService;
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly scripted: boolean;
  readonly failure?: QuoteFailure;
}

export interface UnexpectedRequest {
  readonly method: string;
  readonly url: string;
}

export interface QuotesOptions {
  readonly chains?: { readonly evm?: Readonly<Record<number, string>>; readonly solana?: string };
  readonly origins?: { readonly kyberswap?: string; readonly jupiter?: string; readonly dln?: string };
  readonly holdMs?: number;
  readonly oversizeBytes?: number;
}

export interface QuotesFake {
  readonly handler: Handler;
  readonly calls: ReadonlyArray<QuoteCall>;
  readonly unexpected: ReadonlyArray<UnexpectedRequest>;
  readonly kyberswap: KyberSwapScript;
  readonly jupiter: JupiterScript;
  readonly dln: DlnScript;
  readonly solanaHistory: SolanaHistoryScript & { readonly rpc: Handler };
  /** @throws {never} */
  fail<S extends QuoteService>(service: S, mode: FailureModes[S]): void;
}

/** @throws {never} */
export function parsedJson(text: string): unknown {
  return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text));
}

/** @throws {never} */
export function held(signal: AbortSignal, holdMs: number): Promise<void> {
  const until = AbortSignal.any([signal, AbortSignal.timeout(holdMs)]);
  return new Promise((resolve) => {
    if (until.aborted) resolve();
    else until.addEventListener("abort", () => resolve(), { once: true });
  });
}

/** @throws {never} */
export function asFetch(handler: Handler): typeof globalThis.fetch {
  return async (input, init) => {
    const outgoing = new globalThis.Request(input, init);
    const body = outgoing.method === "GET" || outgoing.method === "HEAD" ? undefined : await outgoing.arrayBuffer();
    const answer = await handler(new Request(outgoing.url, { method: outgoing.method, headers: Object.fromEntries(outgoing.headers), body, signal: outgoing.signal }));
    const bytes = await answer.arrayBuffer();
    return new globalThis.Response([101, 204, 205, 304].includes(answer.status) ? null : bytes, {
      status: answer.status,
      statusText: answer.statusText,
      headers: Object.fromEntries(answer.headers),
    });
  };
}

function under(url: URL, base: string): string | undefined {
  const root = new URL(base);
  const prefix = root.pathname.replace(/\/$/u, "");
  if (url.origin !== root.origin || (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) return undefined;
  return url.pathname.slice(prefix.length);
}

/** @throws {never} */
export function quotesFake(options: QuotesOptions = {}): QuotesFake {
  const { chains = {}, origins = {}, holdMs = 30_000, oversizeBytes = 2_000_001 } = options;
  const evm = Object.fromEntries(Object.entries(chains.evm ?? {}));
  const calls: QuoteCall[] = [];
  const unexpected: UnexpectedRequest[] = [];
  const failures = new Map<QuoteService, QuoteFailure[]>();
  const kyber = kyberswap();
  const jup = jupiter(chains.solana);
  const bridge = dln({ evm, solana: chains.solana });
  const history = solanaHistory(chains.solana);
  const bases = {
    kyberswap: origins.kyberswap ?? kyberswapOrigin,
    jupiter: origins.jupiter ?? jupiterOrigin,
    dln: origins.dln ?? dlnOrigin,
  };

  function nextFailure(service: QuoteService) {
    return failures.get(service)?.shift();
  }

  function refusal(service: QuoteService, mode: "noRoute" | "unavailable") {
    switch (service) {
      case "kyberswap":
        return kyberswapRefusal(mode);
      case "jupiter":
        return jupiterRefusal(mode);
      case "dln":
        return dlnRefusal(mode);
      case "solanaHistory":
        return solanaHistoryRefusal();
      default: {
        const _exhaustive: never = service;
        return _exhaustive;
      }
    }
  }

  async function failed(service: QuoteService, mode: QuoteFailure, signal: AbortSignal): Promise<Response> {
    switch (mode) {
      case "noRoute":
      case "unavailable":
        return refusal(service, mode);
      case "malformed":
        return new Response("{\"truncated\":", { status: 200, headers: { "content-type": "application/json" } });
      case "tooLarge":
        return Response.json({ padding: "x".repeat(oversizeBytes) });
      case "timeout":
        await held(signal, holdMs);
        return new Response("upstream timed out", { status: 504 });
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  }

  async function received(request: Request) {
    const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    return {
      url: new URL(request.url),
      text,
      body: text === "" ? undefined : parsedJson(text),
      headers: Object.fromEntries(request.headers),
    };
  }

  const handler: Handler = async (request) => {
    const { url, body, headers } = await received(request);
    const kyberPath = under(url, bases.kyberswap);
    const jupiterPath = under(url, bases.jupiter);
    const dlnPath = under(url, bases.dln);
    const service = kyberPath !== undefined ? "kyberswap" : jupiterPath !== undefined ? "jupiter" : dlnPath !== undefined ? "dln" : undefined;
    if (service === undefined) {
      unexpected.push({ method: request.method, url: url.href });
      return new Response(`quotesFake serves no API at ${url.origin}${url.pathname}`, { status: 599 });
    }
    const call: Omit<QuoteCall, "scripted"> = { service, method: request.method, url: url.href, headers, body };
    const failure = nextFailure(service);
    if (failure !== undefined) {
      calls.push({ ...call, scripted: false, failure });
      return failed(service, failure, request.signal);
    }
    const answered = kyberPath !== undefined
      ? kyber.answer(request.method, kyberPath, url, body)
      : jupiterPath !== undefined
        ? await jup.answer(request.method, jupiterPath, url, body)
        : await bridge.answer(request.method, dlnPath ?? "", url);
    calls.push({ ...call, scripted: answered.scripted });
    return answered.response;
  };

  const rpc: Handler = async (request) => {
    const { url, text, body, headers } = await received(request);
    const rpcCall = history.decoded(body);
    if (rpcCall?.method !== historyMethod) return (await history.answer(text, rpcCall)).response;
    const call: Omit<QuoteCall, "scripted"> = { service: "solanaHistory", method: request.method, url: url.href, headers, body };
    const failure = nextFailure("solanaHistory");
    if (failure !== undefined) {
      calls.push({ ...call, scripted: false, failure });
      return failed("solanaHistory", failure, request.signal);
    }
    const answered = await history.answer(text, rpcCall);
    calls.push({ ...call, scripted: answered.scripted });
    return answered.response;
  };

  return {
    handler,
    calls,
    unexpected,
    kyberswap: kyber.script,
    jupiter: jup.script,
    dln: bridge.script,
    solanaHistory: { ...history.script, rpc },
    fail: (service, mode) => {
      failures.set(service, [...failures.get(service) ?? [], mode]);
    },
  };
}
