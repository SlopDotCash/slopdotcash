import { expect, test } from "bun:test";
import { qualifySecurityScreening } from "./qualify-security-screening";
import { qualificationTransport } from "./qualify-value-models";

// Deterministic transport fixtures for the real release wrappers. They prove
// receipt handling and refusals, not real-provider or model qualification.
const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
const body = {
  model: "claude-opus-5.5",
  stop_reason: "end_turn",
  content: [
    {
      type: "text",
      text: '{"decision":"legitimate","reason":"Concrete synthetic evidence"}',
    },
  ],
};

function request() {
  return new Request(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      model: "claude-opus-5.5",
      item: { contentOmittedFromModel: true },
    }),
  });
}

function transport(value: unknown, headers: Record<string, string> = {}) {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: (async () => {
      calls++;
      return new Response(` \n${JSON.stringify(value)}`, {
        headers: { "content-type": "application/json", ...headers },
      });
    }) as unknown as typeof fetch,
  };
}

test("release value wrapper retains body-only, zero and legacy receipts without consuming SDK output", async () => {
  for (const [value, headers] of [
    [{ ...body, usage: { buyer_cost_micro: 75 } }, {}],
    [
      { ...body, usage: { buyer_cost_micro: 0 } },
      { "x-si-buyer-cost-micro": "99" },
    ],
    [body, { "x-si-buyer-cost-micro": "75" }],
  ] as [unknown, Record<string, string>][]) {
    const source = transport(value, headers);
    const wrapped = qualificationTransport(source.fetch);
    const response = await wrapped.fetch(request());
    expect(await response.json()).toEqual(value);
    expect(source.calls()).toBe(1);
    expect(wrapped.requestCount()).toBe(1);
    expect(await wrapped.mayCall()).toBe(true);
  }
});

test("unknown value qualification costs stop further requests even with a valid legacy header", async () => {
  for (const value of [body, { ...body, usage: { buyer_cost_micro: "75" } }]) {
    const source = transport(
      value,
      value === body ? {} : { "x-si-buyer-cost-micro": "75" },
    );
    const wrapped = qualificationTransport(source.fetch);
    await expect(wrapped.fetch(request())).rejects.toThrow();
    expect(await wrapped.mayCall()).toBe(false);
    await expect(wrapped.fetch(request())).rejects.toThrow();
    expect(source.calls()).toBe(1);
  }
});

test("value qualification retains its request and total-cost ceilings", async () => {
  const capped = transport({ ...body, usage: { buyer_cost_micro: 1_000_000 } });
  const budget = qualificationTransport(capped.fetch);
  await budget.fetch(request());
  expect(await budget.mayCall()).toBe(false);
  await expect(budget.fetch(request())).rejects.toThrow();
  expect(capped.calls()).toBe(1);
  const zero = transport({ ...body, usage: { buyer_cost_micro: 0 } });
  const requests = qualificationTransport(zero.fetch);
  await requests.fetch(request());
  await requests.fetch(request());
  expect(await requests.mayCall()).toBe(false);
  await expect(requests.fetch(request())).rejects.toThrow();
  expect(zero.calls()).toBe(2);
});

test("oversized receipt bodies leave value qualification uncertain with no retry", async () => {
  let calls = 0;
  const wrapped = qualificationTransport((async () => {
    calls++;
    return new Response(" ".repeat(1_048_577), {
      headers: { "x-si-buyer-cost-micro": "1" },
    });
  }) as unknown as typeof fetch);
  await expect(wrapped.fetch(request())).rejects.toThrow();
  expect(await wrapped.mayCall()).toBe(false);
  expect(calls).toBe(1);
});

test("release screening wrapper accepts canonical body and legacy receipts", async () => {
  for (const [value, headers] of [
    [{ ...body, usage: { buyer_cost_micro: 75 } }, {}],
    [
      { ...body, usage: { buyer_cost_micro: 0 } },
      { "x-si-buyer-cost-micro": "99" },
    ],
    [body, { "x-si-buyer-cost-micro": "75" }],
  ] as [unknown, Record<string, string>][]) {
    const source = transport(value, headers);
    const result = await qualifySecurityScreening(
      "synthetic-only",
      false,
      source.fetch,
    );
    expect(result.requests).toBe(1);
    expect(result.outcome).toBe("synthetic report classified legitimate");
    expect(source.calls()).toBe(1);
  }
});

test("screening qualification refuses unknown or over-budget costs without retries", async () => {
  for (const cost of ["75", 1_000_001]) {
    const source = transport(
      { ...body, usage: { buyer_cost_micro: cost } },
      { "x-si-buyer-cost-micro": "75" },
    );
    await expect(
      qualifySecurityScreening("synthetic-only", false, source.fetch),
    ).rejects.toThrow();
    expect(source.calls()).toBe(1);
  }
});

test("screening qualification still refuses incomplete evidence and spam after one call", async () => {
  for (const decision of ["needs-information", "spam"]) {
    const source = transport({
      ...body,
      content: [
        {
          type: "text",
          text: JSON.stringify({ decision, reason: "Synthetic refusal" }),
        },
      ],
      usage: { buyer_cost_micro: 75 },
    });
    await expect(
      qualifySecurityScreening("synthetic-only", false, source.fetch),
    ).rejects.toThrow(`Synthetic screening returned ${decision}`);
    expect(source.calls()).toBe(1);
  }
});

test("screening refuses body-marked truncation and committed errors despite valid receipts", async () => {
  for (const value of [
    { ...body, surplus: { truncated: true }, usage: { buyer_cost_micro: 75 } },
    {
      model: body.model,
      error: { type: "api_error" },
      usage: { buyer_cost_micro: 75 },
    },
  ]) {
    const source = transport(value, { "x-si-buyer-cost-micro": "75" });
    await expect(
      qualifySecurityScreening("synthetic-only", false, source.fetch),
    ).rejects.toThrow();
    expect(source.calls()).toBe(1);
  }
});
