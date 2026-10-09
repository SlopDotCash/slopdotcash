// Model route (PRD BOT-09). The model gets no tools, secrets or network access;
// it returns one schema-valid verdict about the item it was shown, nothing else.
import Anthropic from "@anthropic-ai/sdk";
import {
  type Usage,
  VERDICT_SCHEMA,
  type Verdict,
  validateVerdict,
} from "./contracts";

export type ModelEnv = {
  SURPLUS_API_KEY?: string;
  SURPLUS_BASE_URL?: string;
  OPENAI_API_KEY?: string;
};

type Step = {
  provider: "surplus" | "openai";
  model: string;
  priceKey: string;
};

const SURPLUS: Step = {
  provider: "surplus",
  model: "claude-opus-5.5",
  priceKey: "surplus/claude-opus-5.5",
};
const OPENAI: Step = {
  provider: "openai",
  model: "gpt-6.1-sol",
  priceKey: "openai/gpt-6.1-sol",
};

// Owner decision (9 October 2026): Surplus serves triage and closure
// confirmation; GPT-6.1 Sol is the fallback. Confirmation is a second,
// independent call at higher effort, not a different seller guarantee.
export const TRIAGE_ROUTE = [SURPLUS, OPENAI];
export const CONFIRM_ROUTE = [SURPLUS, OPENAI];

export type CallRecord = {
  routeStep: number;
  provider: Step["provider"];
  requestedModel: string;
  servedModel: string | null;
  priceKey: string;
  outcome: "ok" | "failed";
  failure: string | null;
  usage: Usage;
};

export type Prompt = { system: string; policy: string; item: string };

const ZERO: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };

export async function runRoute(
  env: ModelEnv,
  route: Step[],
  prompt: Prompt,
  effort: "medium" | "high",
): Promise<{
  verdict: Verdict | null;
  calls: CallRecord[];
  servedBy: CallRecord | null;
}> {
  const calls: CallRecord[] = [];
  for (const [index, step] of route.entries()) {
    const record: CallRecord = {
      routeStep: index + 1,
      provider: step.provider,
      requestedModel: step.model,
      servedModel: null,
      priceKey: step.priceKey,
      outcome: "failed",
      failure: null,
      usage: ZERO,
    };
    try {
      const result =
        step.provider === "openai"
          ? await callOpenAI(env, step, prompt, effort)
          : await callClaude(env, step, prompt, effort);
      record.usage = result.usage;
      record.servedModel = result.servedModel;
      const verdict =
        result.json === null ? null : validateVerdict(result.json);
      if (verdict === null) {
        record.failure = result.failure ?? "schema-invalid verdict";
        calls.push(record);
        continue;
      }
      record.outcome = "ok";
      calls.push(record);
      return { verdict, calls, servedBy: record };
    } catch (error) {
      record.failure =
        error instanceof Error
          ? error.message.slice(0, 300)
          : "provider call failed";
      calls.push(record);
    }
  }
  return { verdict: null, calls, servedBy: null };
}

type CallResult = {
  json: unknown;
  usage: Usage;
  servedModel: string | null;
  failure: string | null;
};

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callClaude(
  env: ModelEnv,
  step: Step,
  prompt: Prompt,
  effort: "medium" | "high",
): Promise<CallResult> {
  const key = env.SURPLUS_API_KEY;
  if (key === undefined || key === "")
    throw new Error("surplus key not configured");
  // Surplus exposes an Anthropic Messages endpoint; it is a reseller, so the
  // request goes through the official SDK with only the base URL changed.
  const client = new Anthropic({
    apiKey: null,
    authToken: key,
    baseURL: env.SURPLUS_BASE_URL ?? "https://api.surplusintelligence.ai",
    maxRetries: 1,
    timeout: 120_000,
  });
  const response = await client.messages.create({
    model: step.model,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: prompt.system,
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
      format: { type: "json_schema", schema: VERDICT_SCHEMA },
    },
  } as unknown as Anthropic.MessageCreateParamsNonStreaming);
  const usage: Usage = {
    input: response.usage.input_tokens,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    output: response.usage.output_tokens,
  };
  if (
    response.stop_reason === "refusal" ||
    response.stop_reason === "max_tokens"
  ) {
    return {
      json: null,
      usage,
      servedModel: response.model,
      failure: response.stop_reason,
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
  };
}

async function callOpenAI(
  env: ModelEnv,
  step: Step,
  prompt: Prompt,
  effort: "medium" | "high",
): Promise<CallResult> {
  if (env.OPENAI_API_KEY === undefined || env.OPENAI_API_KEY === "")
    throw new Error("openai key not configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: step.model,
      reasoning: { effort },
      input: [
        { role: "system", content: prompt.system },
        { role: "user", content: `${prompt.policy}\n\n${prompt.item}` },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "slopbot_verdict",
          strict: true,
          schema: VERDICT_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`openai returned ${response.status}`);
  const body = (await response.json()) as {
    model?: string;
    status?: string;
    output?: { type: string; content?: { type: string; text?: string }[] }[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
  const cached = body.usage?.input_tokens_details?.cached_tokens ?? 0;
  const usage: Usage = {
    input: (body.usage?.input_tokens ?? 0) - cached,
    cacheWrite: 0,
    cacheRead: cached,
    output: body.usage?.output_tokens ?? 0,
  };
  if (body.status !== "completed") {
    return {
      json: null,
      usage,
      servedModel: body.model ?? null,
      failure: `status ${body.status}`,
    };
  }
  const text = body.output
    ?.find((item) => item.type === "message")
    ?.content?.find((part) => part.type === "output_text")?.text;
  return {
    json: parseJson(text),
    usage,
    servedModel: body.model ?? null,
    failure: null,
  };
}
