import { expect, test } from "bun:test";
import { runStructuredRoute, TRIAGE_ROUTE } from "./models";

// Transport/accounting regression evidence only. These synthetic envelopes go
// through the real SDK and loopback HTTP; they do not qualify model behavior.
type Packet = {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  status?: number;
  prefix?: string;
};

const prompt = {
  system: "Local transport fixture",
  policy: "No repository data or publication",
  item: "Synthetic accounting fixture",
};
const output = {
  name: "transport_fixture",
  schema: {
    type: "object",
    properties: { accepted: { type: "boolean" } },
    required: ["accepted"],
    additionalProperties: false,
  },
  validate(value: unknown) {
    return typeof value === "object" &&
      value !== null &&
      Object.keys(value).length === 1 &&
      (value as { accepted?: unknown }).accepted === true
      ? { accepted: true }
      : null;
  },
};

function message(
  fields: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "upstream-object-not-receipt",
    type: "message",
    role: "assistant",
    model: TRIAGE_ROUTE[0].model,
    content: [{ type: "text", text: '{"accepted":true}' }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 3,
      cache_creation_input_tokens: 3896,
      cache_read_input_tokens: 0,
      output_tokens: 170,
      ...usage,
    },
    ...fields,
  };
}

async function run(
  packets: Packet[],
  mayCall: () => Promise<boolean> = async () => true,
) {
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toBe("/v1/messages");
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe("Bearer local-only");
      requests.push((await request.json()) as Record<string, unknown>);
      const packet = packets[requests.length - 1];
      if (!packet) return new Response(null, { status: 599 });
      return new Response((packet.prefix ?? "") + JSON.stringify(packet.body), {
        status: packet.status ?? 200,
        headers: { "content-type": "application/json", ...packet.headers },
      });
    },
  });
  try {
    const result = await runStructuredRoute(
      {
        SURPLUS_API_KEY: "local-only",
        SURPLUS_BASE_URL: server.url.origin,
      },
      TRIAGE_ROUTE,
      prompt,
      "medium",
      output,
      mayCall,
    );
    expect(requests.length).toBeLessThanOrEqual(packets.length);
    return { result, requests };
  } finally {
    server.stop(true);
  }
}

test("body-only receipt survives SDK parsing of a long response", async () => {
  const { result, requests } = await run([
    {
      body: message(
        { surplus: { truncated: false } },
        { buyer_cost_micro: 5151 },
      ),
      prefix: " \n\t\n",
      headers: { "x-request-id": "local-receipt" },
    },
  ]);
  expect(result.verdict).toEqual({ accepted: true });
  expect(result.calls).toHaveLength(1);
  expect(result.servedBy?.providerCostMicroUsd).toBe(5151);
  expect(result.servedBy?.providerRequestId).toBe("local-receipt");
  expect(result.servedBy?.usage).toEqual({
    input: 3,
    cacheWrite: 3896,
    cacheRead: 0,
    output: 170,
  });
  expect(requests.map((request) => request.model)).toEqual(["claude-opus-5.5"]);
  expect(requests[0].output_config).toEqual({
    effort: "medium",
    format: { type: "json_schema", schema: output.schema },
  });
});

test("canonical body cost replaces the legacy header exactly once, including zero", async () => {
  for (const cost of [5151, 0]) {
    const { result, requests } = await run([
      {
        body: message({}, { buyer_cost_micro: cost }),
        headers: { "x-si-buyer-cost-micro": "99999" },
      },
    ]);
    expect(result.verdict).toEqual({ accepted: true });
    expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
      cost,
    ]);
    expect(requests).toHaveLength(1);
  }
});

test("absent body cost retains legacy-header and unknown receipt behavior", async () => {
  for (const [headers, cost] of [
    [{ "x-si-buyer-cost-micro": "5151" }, 5151],
    [{ "x-si-buyer-cost-micro": "0" }, 0],
    [{ "x-si-buyer-cost-micro": "5.5" }, null],
    [{}, null],
  ] as [Record<string, string>, number | null][]) {
    const { result } = await run([{ body: message(), headers }]);
    expect(result.verdict).toEqual({ accepted: true });
    expect(result.servedBy?.providerCostMicroUsd).toBe(cost);
    expect(result.servedBy?.providerRequestId).toBeNull();
  }
});

test("malformed present body cost stays unknown despite a valid header", async () => {
  for (const cost of ["5151", null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { result } = await run([
      {
        body: message({}, { buyer_cost_micro: cost }),
        headers: { "x-si-buyer-cost-micro": "5151" },
      },
    ]);
    expect(result.verdict).toEqual({ accepted: true });
    expect(result.servedBy?.providerCostMicroUsd).toBeNull();
  }
});

test("body and legacy truncation refuse valid-looking output and retain both attempt costs", async () => {
  for (const packet of [
    {
      body: message({ surplus: { truncated: true } }, { buyer_cost_micro: 51 }),
    },
    {
      body: message({}, { buyer_cost_micro: 51 }),
      headers: { "x-si-truncated": "1" },
    },
  ]) {
    const { result, requests } = await run([
      packet,
      {
        body: message(
          { model: TRIAGE_ROUTE[1].model },
          { buyer_cost_micro: 100 },
        ),
      },
    ]);
    expect(result.verdict).toEqual({ accepted: true });
    expect(requests.map((request) => request.model)).toEqual([
      "claude-opus-5.5",
      "gpt-6.1-sol",
    ]);
    expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
      51, 100,
    ]);
    expect(result.calls[0].outcome).toBe("failed");
    expect(result.servedBy).toBe(result.calls[1]);
  }
});

test("HTTP-200 Anthropic error body remains failed with its receipt retained", async () => {
  const { result, requests } = await run([
    {
      body: {
        type: "error",
        error: { type: "api_error", message: "untrusted-error-detail" },
        usage: { buyer_cost_micro: 75 },
      },
      prefix: " \n",
      headers: { "x-request-id": "local-error-receipt" },
    },
    {
      body: message(
        { model: TRIAGE_ROUTE[1].model },
        { buyer_cost_micro: 100 },
      ),
    },
  ]);
  expect(result.verdict).toEqual({ accepted: true });
  expect(requests).toHaveLength(2);
  expect(result.calls[0].outcome).toBe("failed");
  expect(result.calls[0].providerCostMicroUsd).toBe(75);
  expect(result.calls[0].providerRequestId).toBe("local-error-receipt");
  expect(result.calls[0].usage).toEqual({
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
  });
  expect(JSON.stringify(result)).not.toContain("untrusted-error-detail");
});

test("SDK HTTP errors use canonical body receipts and do not hide retries", async () => {
  const { result, requests } = await run([
    {
      status: 429,
      body: {
        type: "error",
        error: { type: "rate_limit_error", message: "untrusted-error-detail" },
        usage: { buyer_cost_micro: 75 },
      },
      headers: {
        "x-si-buyer-cost-micro": "999",
        "x-request-id": "local-http-receipt",
      },
    },
    {
      body: message(
        { model: TRIAGE_ROUTE[1].model },
        { buyer_cost_micro: 100 },
      ),
    },
  ]);
  expect(requests.map((request) => request.model)).toEqual([
    "claude-opus-5.5",
    "gpt-6.1-sol",
  ]);
  expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
    75, 100,
  ]);
  expect(result.calls[0].providerRequestId).toBe("local-http-receipt");
  expect(JSON.stringify(result)).not.toContain("untrusted-error-detail");
});

test("structured spending denial keeps its receipt and prevents fallback at HTTP 200 or 400", async () => {
  for (const status of [200, 400]) {
    const { result, requests } = await run([
      {
        status,
        body: {
          type: "error",
          error: {
            type: "invalid_request_error",
            detail: {
              window: "month",
              limit_micro: 100,
              spent_micro: 100,
              resets_at: "2026-11-01T00:00:00.000Z",
            },
          },
          usage: { buyer_cost_micro: 0 },
        },
        headers: { "x-si-buyer-cost-micro": "999" },
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(result.verdict).toBeNull();
    expect(result.calls[0].providerCostMicroUsd).toBe(0);
    expect(result.calls[0].failure).toBe("provider budget exhausted");
    expect(result.budgetResetAt).toBe("2026-11-01T00:00:00.000Z");
  }
});

test("malformed budget detail does not turn an ordinary provider failure into a denial", async () => {
  const { result, requests } = await run([
    {
      body: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "budget exhausted",
          detail: {
            window: "month",
            limit_micro: 100,
            spent_micro: "100",
            resets_at: "2026-11-01T00:00:00.000Z",
          },
        },
        usage: { buyer_cost_micro: 0 },
      },
    },
    {
      body: message(
        { model: TRIAGE_ROUTE[1].model },
        { buyer_cost_micro: 100 },
      ),
    },
  ]);
  expect(requests).toHaveLength(2);
  expect(result.verdict).toEqual({ accepted: true });
  expect(result.budgetResetAt).toBeUndefined();
  expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
    0, 100,
  ]);
});

test("model and schema guards preserve known and unknown attempt costs", async () => {
  const { result, requests } = await run([
    { body: message({ model: "wrong-model" }, { buyer_cost_micro: 51 }) },
    {
      body: message({
        model: TRIAGE_ROUTE[1].model,
        content: [{ type: "text", text: '{"accepted":true,"extra":1}' }],
      }),
    },
  ]);
  expect(requests).toHaveLength(2);
  expect(result.verdict).toBeNull();
  expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
    51,
    null,
  ]);
  expect(result.calls.map((call) => call.failure)).toEqual([
    "provider did not report the requested model",
    "schema-invalid verdict",
  ]);
});

test("fallback authority denial preserves the first attempt receipt", async () => {
  let checks = 0;
  const { result, requests } = await run(
    [
      {
        body: message(
          { surplus: { truncated: true } },
          { buyer_cost_micro: 51 },
        ),
      },
    ],
    async () => ++checks === 1,
  );
  expect(requests).toHaveLength(1);
  expect(checks).toBe(2);
  expect(result.blocked).toBe(true);
  expect(result.verdict).toBeNull();
  expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([51]);
});
