// spec/slopbot/review.md, "Each call is recorded free, and only a Surplus spending denial blocks the route"
import { Option, Schema } from "effect";
import { Response } from "miniflare";
import type { Handler } from "../testing.ts";
import { held, parsedJson } from "./quotes.ts";

export type ProviderRoute = "surplus-anthropic" | "surplus-openai" | "orbio";
export type ProviderFailureMode = "spendDenied" | "rateLimited" | "unavailable" | "malformed" | "timeout" | "tooLarge";

export interface ProviderMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface ProviderCall {
  readonly route: ProviderRoute;
  readonly model: string;
  readonly system: string;
  readonly messages: ReadonlyArray<ProviderMessage>;
  readonly maxTokens: number | null;
  readonly key: string | null;
}

export type ProviderAnswer =
  | { readonly text: string; readonly model?: string; readonly stopReason?: string; readonly truncated?: boolean }
  | { readonly failure: "spendDenied"; readonly resetsAt?: string; readonly status?: 200 | 400 }
  | { readonly failure: "rateLimited"; readonly retryAfterSeconds?: number }
  | { readonly failure: Exclude<ProviderFailureMode, "spendDenied" | "rateLimited"> }
  | { readonly raw: { readonly status: number; readonly headers?: Readonly<Record<string, string>>; readonly body: unknown } };

export interface ProviderUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly costMicro?: number;
  readonly costHeader?: string;
}

export interface ProviderFakeOptions {
  readonly origins?: { readonly surplus?: string; readonly orbio?: string };
  readonly holdMs?: number;
  readonly oversizeBytes?: number;
}

export interface ProviderFake {
  readonly handler: Handler;
  readonly calls: ReadonlyArray<ProviderCall>;
  readonly unanswered: ReadonlyArray<ProviderCall>;
  readonly unexpected: ReadonlyArray<{ readonly method: string; readonly url: string }>;
  /** @throws {never} */
  reply(match: (call: ProviderCall) => boolean, answer: ProviderAnswer, usage?: ProviderUsage): void;
}

interface Scripted {
  readonly match: (call: ProviderCall) => boolean;
  readonly answer: ProviderAnswer;
  readonly usage: Required<Omit<ProviderUsage, "costMicro" | "costHeader">> & Pick<ProviderUsage, "costMicro" | "costHeader">;
}

const TextBlock = Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) });
const Content = Schema.Union([Schema.String, Schema.Array(TextBlock)]);
const Role = Schema.Literals(["user", "assistant"]);

const MessagesRequest = Schema.Struct({
  model: Schema.String,
  max_tokens: Schema.Number,
  system: Schema.optionalKey(Content),
  messages: Schema.Array(Schema.Struct({ role: Role, content: Content })),
});

const ResponsesRequest = Schema.Struct({
  model: Schema.String,
  instructions: Schema.optionalKey(Schema.String),
  input: Schema.Union([Schema.String, Schema.Array(Schema.Struct({ role: Role, content: Content }))]),
  max_output_tokens: Schema.optionalKey(Schema.Number),
});

const surplusOrigin = "https://api.surplusintelligence.ai";
const orbioOrigin = "https://api.orbio.so";

function text(content: typeof Content.Type): string {
  return typeof content === "string" ? content : content.flatMap((block) => block.text === undefined ? [] : [block.text]).join("\n");
}

function routeOf(url: URL, origins: { readonly surplus: string; readonly orbio: string }): ProviderRoute | undefined {
  if (url.origin === new URL(origins.orbio).origin && url.pathname.endsWith("/v1/messages")) return "orbio";
  if (url.origin !== new URL(origins.surplus).origin) return undefined;
  if (url.pathname.endsWith("/anthropic/v1/messages")) return "surplus-anthropic";
  if (url.pathname.endsWith("/v1/responses")) return "surplus-openai";
  return undefined;
}

function decodedCall(route: ProviderRoute, body: unknown, key: string | null): ProviderCall | undefined {
  if (route === "surplus-openai") {
    const request = Schema.decodeUnknownOption(ResponsesRequest)(body);
    if (Option.isNone(request)) return undefined;
    const { model, instructions = "", input, max_output_tokens } = request.value;
    const messages = typeof input === "string" ? [{ role: "user" as const, content: input }] : input.map((message) => ({ role: message.role, content: text(message.content) }));
    return { route, model, system: instructions, messages, maxTokens: max_output_tokens ?? null, key };
  }
  const request = Schema.decodeUnknownOption(MessagesRequest)(body);
  if (Option.isNone(request)) return undefined;
  const { model, system, messages, max_tokens } = request.value;
  return { route, model, system: system === undefined ? "" : text(system), messages: messages.map((message) => ({ role: message.role, content: text(message.content) })), maxTokens: max_tokens, key };
}

function anthropicError(status: number, type: string, message: string, extra: Readonly<Record<string, unknown>> = {}, headers: Readonly<Record<string, string>> = {}) {
  return Response.json({ type: "error", error: { type, message, ...extra } }, { status, headers });
}

function openaiError(status: number, type: string, code: string | null, message: string, extra: Readonly<Record<string, unknown>> = {}, headers: Readonly<Record<string, string>> = {}) {
  return Response.json({ error: { message, type, param: null, code, ...extra } }, { status, headers });
}

function nextMonth(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

function spendDenied(route: ProviderRoute, resetsAt: string, status: 200 | 400, headers: Readonly<Record<string, string>>) {
  const detail = { window: "month", limit_micro: 100, spent_micro: 100, resets_at: resetsAt };
  switch (route) {
    case "surplus-anthropic":
      return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Spending limit reached", detail }, usage: { buyer_cost_micro: 0 } }, { status, headers });
    case "surplus-openai":
      return Response.json({ error: { message: "Spending limit reached", type: "invalid_request_error", param: null, code: "budget_exceeded", detail }, usage: { buyer_cost_micro: 0 } }, { status, headers });
    case "orbio":
      return anthropicError(402, "billing_error", "Insufficient credits", {}, headers);
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}

function costHeaders(costHeader: string | undefined): Readonly<Record<string, string>> {
  return costHeader === undefined ? {} : { "x-si-buyer-cost-micro": costHeader };
}

function rawReply({ status, headers = {}, body }: { readonly status: number; readonly headers?: Readonly<Record<string, string>>; readonly body: unknown }) {
  return typeof body === "string" ? new Response(body, { status, headers }) : Response.json(body, { status, headers });
}

function costFields(route: ProviderRoute, costMicro: number | undefined) {
  if (costMicro === undefined) return {};
  return route === "orbio" ? { cost: costMicro / 1_000_000 } : { buyer_cost_micro: costMicro };
}

/** @throws {never} */
export function providerFake(options: ProviderFakeOptions = {}): ProviderFake {
  const origins = { surplus: options.origins?.surplus ?? surplusOrigin, orbio: options.origins?.orbio ?? orbioOrigin };
  const holdMs = options.holdMs ?? 30_000;
  const oversizeBytes = options.oversizeBytes ?? 1024 * 1024 + 1;
  const calls: ProviderCall[] = [];
  const unanswered: ProviderCall[] = [];
  const unexpected: { method: string; url: string }[] = [];
  const scripts: Scripted[] = [];

  function success(call: ProviderCall, answer: { readonly text: string; readonly model?: string; readonly stopReason?: string; readonly truncated?: boolean }, usage: Scripted["usage"], padding: number) {
    const sequence = calls.length;
    const reply = answer.text + " ".repeat(padding);
    const model = answer.model ?? call.model;
    const truncated = answer.truncated === true && call.route !== "orbio";
    const headers = { "x-request-id": `req_fake_${sequence}`, ...costHeaders(usage.costHeader), ...(truncated ? { "x-si-truncated": "1" } : {}) };
    if (call.route === "surplus-openai") {
      const incomplete = answer.stopReason === "max_output_tokens" || answer.stopReason === "content_filter";
      return Response.json({
        id: `resp_fake_${sequence}`,
        object: "response",
        created_at: Math.floor(Date.now() / 1000),
        status: incomplete ? "incomplete" : "completed",
        model,
        output: [{ type: "message", id: `msg_fake_${sequence}`, status: "completed", role: "assistant", content: [{ type: "output_text", text: reply, annotations: [] }] }],
        error: null,
        incomplete_details: incomplete ? { reason: answer.stopReason } : null,
        usage: {
          input_tokens: usage.input + usage.cacheRead,
          input_tokens_details: { cached_tokens: usage.cacheRead },
          output_tokens: usage.output,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: usage.input + usage.cacheRead + usage.output,
          ...costFields(call.route, usage.costMicro),
        },
        ...(truncated ? { surplus: { truncated: true } } : {}),
      }, { headers });
    }
    return Response.json({
      id: `msg_fake_${sequence}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: reply }],
      stop_reason: answer.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_creation_input_tokens: usage.cacheWrite,
        cache_read_input_tokens: usage.cacheRead,
        ...costFields(call.route, usage.costMicro),
      },
      ...(truncated ? { surplus: { truncated: true } } : {}),
    }, { headers });
  }

  async function answered(call: ProviderCall, scripted: Scripted, signal: AbortSignal): Promise<Response> {
    const { answer, usage } = scripted;
    if ("raw" in answer) return rawReply(answer.raw);
    if (!("failure" in answer)) return success(call, answer, usage, 0);
    const openai = call.route === "surplus-openai";
    switch (answer.failure) {
      case "spendDenied":
        return spendDenied(call.route, answer.resetsAt ?? nextMonth(), answer.status ?? 400, costHeaders(usage.costHeader));
      case "rateLimited": {
        const headers = { "retry-after": String(answer.retryAfterSeconds ?? 30) };
        return openai
          ? openaiError(429, "requests", "rate_limit_exceeded", "Rate limit reached", {}, headers)
          : anthropicError(429, "rate_limit_error", "Rate limit reached", {}, headers);
      }
      case "unavailable":
        return openai
          ? openaiError(503, "server_error", null, "Service unavailable")
          : anthropicError(503, "api_error", "Service unavailable");
      case "malformed":
        return new Response(`{"id":"msg_fake_${calls.length}","content":[`, { status: 200, headers: { "content-type": "application/json" } });
      case "tooLarge":
        return success(call, { text: "" }, usage, oversizeBytes);
      case "timeout":
        await held(signal, holdMs);
        return new Response("upstream timed out", { status: 504 });
      default: {
        const _exhaustive: never = answer;
        return _exhaustive;
      }
    }
  }

  const handler: Handler = async (request) => {
    const url = new URL(request.url);
    const route = routeOf(url, origins);
    if (route === undefined || request.method !== "POST") {
      unexpected.push({ method: request.method, url: url.href });
      return new Response(`providerFake serves no model API at ${url.origin}${url.pathname}`, { status: 599 });
    }
    const bearer = request.headers.get("authorization");
    const key = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : request.headers.get("x-api-key");
    const call = decodedCall(route, parsedJson(await request.text()), key);
    if (call === undefined)
      return route === "surplus-openai"
        ? openaiError(400, "invalid_request_error", null, "Request body is invalid")
        : anthropicError(400, "invalid_request_error", "Request body is invalid");
    calls.push(call);
    const index = scripts.findIndex((candidate) => candidate.match(call));
    const [scripted] = index === -1 ? [] : scripts.splice(index, 1);
    if (scripted === undefined) {
      unanswered.push(call);
      return route === "surplus-openai"
        ? openaiError(500, "server_error", null, "providerFake has no scripted reply for this call")
        : anthropicError(500, "api_error", "providerFake has no scripted reply for this call");
    }
    return answered(call, scripted, request.signal);
  };

  return {
    handler,
    calls,
    unanswered,
    unexpected,
    reply: (match, answer, usage = {}) => {
      scripts.push({
        match,
        answer,
        usage: { input: usage.input ?? 100, output: usage.output ?? 20, cacheRead: usage.cacheRead ?? 0, cacheWrite: usage.cacheWrite ?? 0, costMicro: usage.costMicro, costHeader: usage.costHeader },
      });
    },
  };
}
