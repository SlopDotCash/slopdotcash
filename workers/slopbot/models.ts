// Model route (PRD BOT-09). The model gets no tools, secrets or network access;
// it returns one schema-valid verdict about the item it was shown, nothing else.
import Anthropic from "@anthropic-ai/sdk";
import { type Usage, VERDICT_SCHEMA, validateVerdict } from "./contracts";

export type ModelEnv = {
  SURPLUS_API_KEY?: string;
  SURPLUS_BASE_URL?: string;
};

type Step = {
  provider: "surplus";
  model: string;
  priceKey: string;
};

const SURPLUS: Step = {
  provider: "surplus",
  model: "claude-opus-5.5",
  priceKey: "surplus/claude-opus-5.5",
};
const FALLBACK: Step = {
  provider: "surplus",
  model: "gpt-6.1-sol",
  priceKey: "surplus/gpt-6.1-sol",
};

// Owner decision (10 October 2026): Surplus serves both Opus 5.5 and
// the GPT-6.1 Sol fallback. Confirmation reuses this route as a second,
// independent call at higher effort, not a different seller guarantee.
export const TRIAGE_ROUTE = [SURPLUS, FALLBACK];

export type CallRecord = {
  routeStep: number;
  provider: Step["provider"];
  requestedModel: string;
  servedModel: string | null;
  priceKey: string;
  outcome: "ok" | "failed";
  failure: string | null;
  usage: Usage;
  providerCostMicroUsd: number | null;
  providerRequestId: string | null;
};

export type Prompt = { system: string; policy: string; item: string };

const ZERO: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

export async function runRoute(
  env: ModelEnv,
  route: Step[],
  prompt: Prompt,
  effort: "medium" | "high",
  mayCall: () => Promise<boolean>,
) {
  return runStructuredRoute(
    env,
    route,
    prompt,
    effort,
    {
      name: "slopbot_verdict",
      schema: VERDICT_SCHEMA,
      validate: validateVerdict,
    },
    mayCall,
  );
}

/** The recorded failure of a call the provider refused under its spending
 * limit. The provider served nothing for it.
 */
export const PROVIDER_BUDGET_EXHAUSTED = "provider budget exhausted";

// The Anthropic wire reports budget exhaustion as invalid_request_error,
// with structured budget detail rather than the OpenAI budget_exceeded code.
// A long-running response may commit HTTP 200 before that denial is known.
// Do not retry another model when the provider has denied spending.
function budgetResetAt(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = error as {
    status?: unknown;
    error?: { error?: { type?: unknown; detail?: unknown } };
  };
  const payload = value.error?.error;
  if (
    (value.status !== 400 && value.status !== 200) ||
    payload?.type !== "invalid_request_error" ||
    typeof payload.detail !== "object" ||
    payload.detail === null
  )
    return null;
  const detail = payload.detail as Record<string, unknown>;
  const valid =
    typeof detail.window === "string" &&
    detail.window.length > 0 &&
    Number.isSafeInteger(detail.limit_micro) &&
    Number(detail.limit_micro) >= 0 &&
    Number.isSafeInteger(detail.spent_micro) &&
    Number(detail.spent_micro) >= 0 &&
    typeof detail.resets_at === "string" &&
    Number.isFinite(Date.parse(detail.resets_at));
  return valid ? new Date(detail.resets_at as string).toISOString() : null;
}

export async function runStructuredRoute<T>(
  env: ModelEnv,
  route: Step[],
  prompt: Prompt,
  effort: "medium" | "high",
  output: {
    name: string;
    schema: Record<string, unknown>;
    validate(value: unknown): T | null;
  },
  mayCall: () => Promise<boolean>,
): Promise<{
  verdict: T | null;
  calls: CallRecord[];
  servedBy: CallRecord | null;
  budgetResetAt?: string;
  blocked: boolean;
  /** The authority check failed. The caller records `calls`, then rethrows. */
  failure?: unknown;
}> {
  const calls: CallRecord[] = [];
  for (const [index, step] of route.entries()) {
    // Recheck after a failed provider call, before starting the fallback.
    try {
      if (!(await mayCall()))
        return { verdict: null, calls, servedBy: null, blocked: true };
    } catch (failure) {
      // Return prior usage so the caller records it before retrying the job.
      return { verdict: null, calls, servedBy: null, blocked: true, failure };
    }
    const record: CallRecord = {
      routeStep: index + 1,
      provider: step.provider,
      requestedModel: step.model,
      servedModel: null,
      priceKey: step.priceKey,
      outcome: "failed",
      failure: null,
      usage: ZERO,
      providerCostMicroUsd: null,
      providerRequestId: null,
    };
    try {
      const result = await callClaude(env, step, prompt, effort, output);
      record.usage = result.usage;
      record.providerCostMicroUsd = result.providerCostMicroUsd;
      record.providerRequestId = result.providerRequestId;
      record.servedModel = result.servedModel;
      if (result.servedModel !== step.model) {
        record.failure = "provider did not report the requested model";
        calls.push(record);
        continue;
      }
      const verdict =
        result.json === null ? null : output.validate(result.json);
      if (verdict === null) {
        record.failure = result.failure ?? "schema-invalid verdict";
        calls.push(record);
        continue;
      }
      record.outcome = "ok";
      calls.push(record);
      return { verdict, calls, servedBy: record, blocked: false };
    } catch (error) {
      // SDK errors can include provider response bodies. Never persist those
      // bodies: they may echo credentials or repository prompt material.
      const status = (error as { status?: unknown })?.status;
      const headers = (error as { headers?: unknown })?.headers;
      if (headers instanceof Headers) {
        record.providerCostMicroUsd = providerCost(
          headers,
          (error as { error?: unknown }).error,
        );
        record.providerRequestId = providerRequestId(headers);
      }
      const resetAt = budgetResetAt(error);
      if (resetAt !== null) {
        record.failure = PROVIDER_BUDGET_EXHAUSTED;
        calls.push(record);
        return {
          verdict: null,
          calls,
          servedBy: null,
          blocked: false,
          budgetResetAt: resetAt,
        };
      }
      record.failure =
        typeof status === "number" && Number.isInteger(status)
          ? `provider returned HTTP ${status}`
          : "provider call failed";
      calls.push(record);
    }
  }
  return { verdict: null, calls, servedBy: null, blocked: false };
}

type CallResult = {
  json: unknown;
  usage: Usage;
  servedModel: string | null;
  failure: string | null;
  providerCostMicroUsd: number | null;
  providerRequestId: string | null;
};

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function providerCost(headers: Headers, body?: unknown): number | null {
  const usage = (body as { usage?: { buyer_cost_micro?: unknown } } | null)
    ?.usage;
  // Surplus's canonical receipt is in the body on both fast and long calls.
  // A malformed present field stays unknown; a legacy header cannot repair it.
  if (
    typeof usage === "object" &&
    usage !== null &&
    Object.hasOwn(usage, "buyer_cost_micro")
  ) {
    const cost = usage.buyer_cost_micro;
    return typeof cost === "number" && Number.isSafeInteger(cost) && cost >= 0
      ? cost
      : null;
  }
  const cost = headers.get("x-si-buyer-cost-micro");
  return cost !== null &&
    /^(0|[1-9][0-9]*)$/u.test(cost) &&
    Number.isSafeInteger(Number(cost))
    ? Number(cost)
    : null;
}

function providerRequestId(headers: Headers): string | null {
  // This is Surplus's receipt identity. The model response body's id identifies
  // a different upstream object and cannot be used for cost reconciliation.
  const id = headers.get("x-request-id");
  return id !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
}

async function callClaude(
  env: ModelEnv,
  step: Step,
  prompt: Prompt,
  effort: "medium" | "high",
  output: { name: string; schema: Record<string, unknown> },
): Promise<CallResult> {
  const key = env.SURPLUS_API_KEY;
  if (key === undefined || key === "")
    throw new Error("surplus key not configured");
  // Surplus exposes an Anthropic Messages endpoint; it is a reseller, so the
  // request goes through the official SDK with only the base URL changed.
  const client = new Anthropic({
    apiKey: null,
    authToken: key,
    baseURL:
      env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai/anthropic",
    // Each explicit route attempt gets its own cost record. SDK retries hide
    // extra provider requests from that ledger.
    maxRetries: 0,
    timeout: 120_000,
  });
  const { data: response, response: transport } = await client.messages
    .create({
      model: step.model,
      max_tokens: 16000,
      system: [
        {
          type: "text",
          // The marketplace can translate the Anthropic wire to another
          // provider. Include the contract in the prompt as well as the API
          // option; otherwise a transport that drops output_config leaves the
          // model unaware of the required schema. Local validation stays strict.
          text: `${prompt.system}\n\nReturn one raw JSON object, without Markdown fences, matching this exact JSON Schema:\n${JSON.stringify(output.schema)}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt.policy,
              cache_control: { type: "ephemeral" },
            },
            { type: "text", text: prompt.item },
          ],
        },
      ],
      output_config: {
        effort,
        format: { type: "json_schema", schema: output.schema },
      },
    } as unknown as Anthropic.MessageCreateParamsNonStreaming)
    .withResponse();
  // The SDK preserves Surplus's additive fields even though its types do not
  // declare them. Read the receipt before handling a committed error response.
  const surplusResponse = response as Anthropic.Message & {
    error?: unknown;
    surplus?: { truncated?: unknown };
  };
  const providerCostMicroUsd = providerCost(transport.headers, response);
  const requestId = providerRequestId(transport.headers);
  if (Object.hasOwn(surplusResponse, "error")) {
    // Reuse the SDK-error path so receipts and structured budget denials get
    // the same handling even when the HTTP status was committed early.
    throw new Anthropic.APIError(
      transport.status,
      response,
      undefined,
      transport.headers,
    );
  }
  const truncated =
    surplusResponse.surplus?.truncated === true ||
    transport.headers.get("x-si-truncated") === "1";
  const usage: Usage = {
    input: response.usage.input_tokens,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    output: response.usage.output_tokens,
  };
  if (
    truncated ||
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    return {
      json: null,
      usage,
      servedModel: response.model,
      failure: truncated
        ? "provider deadline truncated the response"
        : response.stop_reason,
      providerCostMicroUsd,
      providerRequestId: requestId,
    };
  }
  const text = (response.content as { type: string; text?: string }[]).find(
    (block) => block.type === "text",
  )?.text;
  return {
    json: parseJson(text),
    usage,
    servedModel: response.model,
    failure: null,
    providerCostMicroUsd,
    providerRequestId: requestId,
  };
}
