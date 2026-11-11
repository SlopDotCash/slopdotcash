import { expect, test } from "bun:test";
import { type ModelEnv, runStructuredRoute, TRIAGE_ROUTE } from "./models";

// Transport/accounting regression evidence only. These synthetic envelopes go
// through the real SDK and loopback HTTP; they do not qualify model behavior.
type Packet = {
  body: Record<string, unknown>;
  headers?: Record<string, string>;
  status?: number;
  prefix?: string;
};

const SURPLUS_ROUTE = TRIAGE_ROUTE.filter(
  (step) => step.provider === "surplus",
);

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
    model: SURPLUS_ROUTE[0].model,
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
  route = SURPLUS_ROUTE,
  configured: Partial<ModelEnv> = {},
) {
  const requests: Record<string, unknown>[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(new URL(request.url).pathname).toMatch(
        /^(\/orbio)?\/v1\/messages$/u,
      );
      expect(request.method).toBe("POST");
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${new URL(request.url).pathname.startsWith("/orbio/") ? "orbio-local" : "local-only"}`,
      );
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
        ORBIO_API_KEY: "orbio-local",
        ORBIO_BASE_URL: `${server.url.origin}/orbio`,
        ...configured,
      },
      route,
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
  expect(requests.map((request) => request.model)).toEqual([
    "claude-sonnet-5.5",
  ]);
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
          { model: SURPLUS_ROUTE[1].model },
          { buyer_cost_micro: 100 },
        ),
      },
    ]);
    expect(result.verdict).toEqual({ accepted: true });
    expect(requests.map((request) => request.model)).toEqual([
      "claude-sonnet-5.5",
      "gpt-6.1-terra",
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
        { model: SURPLUS_ROUTE[1].model },
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
        { model: SURPLUS_ROUTE[1].model },
        { buyer_cost_micro: 100 },
      ),
    },
  ]);
  expect(requests.map((request) => request.model)).toEqual([
    "claude-sonnet-5.5",
    "gpt-6.1-terra",
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
        { model: SURPLUS_ROUTE[1].model },
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
        model: SURPLUS_ROUTE[1].model,
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

test("Orbio handles the primary call with its credential and retains unknown billing", async () => {
  const { result, requests } = await run(
    [
      {
        body: message(
          { model: TRIAGE_ROUTE[0].model },
          { buyer_cost_micro: 999 },
        ),
        headers: {
          "x-si-buyer-cost-micro": "999",
          "x-request-id": "orbio-local",
        },
      },
    ],
    async () => true,
    TRIAGE_ROUTE,
  );
  expect(requests.map((request) => request.model)).toEqual([
    "anthropic/claude-sonnet-5.5",
  ]);
  expect(result.verdict).toEqual({ accepted: true });
  expect(result.servedBy?.provider).toBe("orbio");
  expect(result.servedBy?.providerCostMicroUsd).toBeNull();
});

test("Orbio exhausted credits try Surplus immediately and retain both attempt records", async () => {
  const { result, requests } = await run(
    [
      {
        status: 402,
        body: {
          error: { type: "insufficient_quota", message: "private-detail" },
        },
      },
      {
        body: message(
          { model: TRIAGE_ROUTE[1].model },
          { buyer_cost_micro: 100 },
        ),
      },
    ],
    async () => true,
    TRIAGE_ROUTE,
  );
  expect(requests.map((request) => request.model)).toEqual([
    "anthropic/claude-sonnet-5.5",
    "claude-sonnet-5.5",
  ]);
  expect(result.calls.map((call) => call.provider)).toEqual([
    "orbio",
    "surplus",
  ]);
  expect(result.calls.map((call) => call.routeStep)).toEqual([1, 2]);
  expect(result.calls.map((call) => call.providerCostMicroUsd)).toEqual([
    null,
    100,
  ]);
  expect(result.verdict).toEqual({ accepted: true });
  expect(result.servedBy).toBe(result.calls[1]);
  expect(JSON.stringify(result)).not.toContain("private-detail");
});

test("missing Orbio credentials use Surplus without invented call records", async () => {
  let checks = 0;
  const { result, requests } = await run(
    [{ body: message({ model: TRIAGE_ROUTE[1].model }) }],
    async () => {
      checks++;
      return true;
    },
    TRIAGE_ROUTE,
    { ORBIO_API_KEY: undefined },
  );
  expect(requests.map((request) => request.model)).toEqual([
    "claude-sonnet-5.5",
  ]);
  expect(checks).toBe(1);
  expect(result.calls).toHaveLength(1);
  expect(result.servedBy?.provider).toBe("surplus");
  expect(result.servedBy?.routeStep).toBe(2);
});

test("authority loss before Surplus preserves the failed Orbio attempt", async () => {
  let checks = 0;
  const { result, requests } = await run(
    [{ status: 503, body: { error: { type: "api_error" } } }],
    async () => ++checks < 2,
    TRIAGE_ROUTE,
  );
  expect(requests).toHaveLength(1);
  expect(result.blocked).toBe(true);
  expect(result.verdict).toBeNull();
  expect(result.calls.map((call) => call.provider)).toEqual(["orbio"]);
});

test("Orbio Terra supports an explicit route with its catalogue identity", async () => {
  const terra = {
    provider: "orbio" as const,
    model: "openai/gpt-6.1-terra",
    priceKey: "orbio/openai/gpt-6.1-terra",
  };
  const { result, requests } = await run(
    [{ body: message({ model: terra.model }) }],
    async () => true,
    [terra],
  );
  expect(requests.map((request) => request.model)).toEqual([
    "openai/gpt-6.1-terra",
  ]);
  expect(result.servedBy?.provider).toBe("orbio");
  expect(result.verdict).toEqual({ accepted: true });
});

test("all three failed requests leave an unavailable result with complete attempt records", async () => {
  const { result, requests } = await run(
    TRIAGE_ROUTE.map(() => ({
      status: 503,
      body: { error: { type: "api_error", message: "private-detail" } },
    })),
    async () => true,
    TRIAGE_ROUTE,
  );
  expect(requests.map((request) => request.model)).toEqual([
    "anthropic/claude-sonnet-5.5",
    "claude-sonnet-5.5",
    "gpt-6.1-terra",
  ]);
  expect(result.verdict).toBeNull();
  expect(result.servedBy).toBeNull();
  expect(result.calls.map((call) => call.routeStep)).toEqual([1, 2, 3]);
  expect(result.calls.every((call) => call.outcome === "failed")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private-detail");
});

test("Orbio receipts record exact charged micro-dollars and preserve uncertain amounts", async () => {
  for (const [cost, expected] of [
    [0.000564, 564],
    [0, 0],
    [0.0000001, null],
    ["0.000564", null],
  ] as const) {
    const { result } = await run(
      [
        {
          body: message(
            { model: TRIAGE_ROUTE[0].model },
            { cost, cost_details: { upstream_inference_cost: 999 } },
          ),
          headers: {
            "x-si-buyer-cost-micro": "999",
            "x-request-id": "orbio-receipt",
          },
        },
      ],
      async () => true,
      TRIAGE_ROUTE,
    );
    expect(result.verdict).toEqual({ accepted: true });
    expect(result.servedBy?.providerCostMicroUsd).toBe(expected);
    expect(result.servedBy?.providerRequestId).toBe("orbio-receipt");
  }
});

test("Orbio invalid output, model mismatch, and truncation each try Surplus next", async () => {
  for (const body of [
    message({ model: "wrong-model" }),
    message({
      model: TRIAGE_ROUTE[0].model,
      content: [{ type: "text", text: "invalid JSON" }],
    }),
    message({ model: TRIAGE_ROUTE[0].model, stop_reason: "max_tokens" }),
    { type: "error", error: { type: "api_error", message: "private-detail" } },
  ]) {
    const { result, requests } = await run(
      [{ body }, { body: message({ model: TRIAGE_ROUTE[1].model }) }],
      async () => true,
      TRIAGE_ROUTE,
    );
    expect(requests.map((request) => request.model)).toEqual([
      "anthropic/claude-sonnet-5.5",
      "claude-sonnet-5.5",
    ]);
    expect(result.calls.map((call) => call.provider)).toEqual([
      "orbio",
      "surplus",
    ]);
    expect(result.calls[0].outcome).toBe("failed");
    expect(result.verdict).toEqual({ accepted: true });
  }
});
