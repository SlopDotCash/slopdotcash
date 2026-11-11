import { expect, test } from "bun:test";
import {
  MAXIMUM_ATTEMPTS,
  qualifySecurityScreening,
  ScreeningQualificationError,
} from "./qualify-security-screening";
import { providerCost } from "../workers/slopbot/models";
import { qualificationResponse } from "./qualification-response";
import { qualificationTransport } from "./qualify-value-models";

// Deterministic transport fixtures for the real release wrappers. They prove
// receipt handling and refusals, not real-provider or model qualification.
const ENDPOINT = "https://api.surplusintelligence.ai/anthropic/v1/messages";
const body = {
  model: "claude-sonnet-5.5",
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
      model: "claude-sonnet-5.5",
      item: { contentOmittedFromModel: true },
    }),
  });
}

const noSleep = async () => {};

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
      noSleep,
    );
    expect(result.requests).toBe(1);
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
      qualifySecurityScreening("synthetic-only", false, source.fetch, noSleep),
    ).rejects.toThrow();
    expect(source.calls()).toBe(1);
  }
});

test("screening refuses body-marked truncation and committed errors after bounded retries", async () => {
  for (const value of [
    { ...body, surplus: { truncated: true }, usage: { buyer_cost_micro: 75 } },
    {
      model: body.model,
      error: { type: "api_error" },
      usage: { buyer_cost_micro: 75 },
    },
  ]) {
    // Each billed, incomplete answer is a bounded transient retry; the
    // release still fails once every attempt is incomplete.
    const source = transport(value, { "x-si-buyer-cost-micro": "75" });
    const error = await failure(
      qualifySecurityScreening("synthetic-only", false, source.fetch, noSleep),
    );
    expect(error.category).toBe("incomplete");
    expect(source.calls()).toBe(MAXIMUM_ATTEMPTS);
  }
});

/** Replies with each queued response in order, then repeats the last. */
function sequence(replies: (() => Response)[]) {
  let calls = 0;
  return {
    calls: () => calls,
    fetch: (async () => {
      const reply = replies[Math.min(calls, replies.length - 1)];
      calls++;
      return reply();
    }) as unknown as typeof fetch,
  };
}

const json =
  (value: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });
const ok = json({ ...body, usage: { buyer_cost_micro: 75 } });
const answer = (text: string) =>
  json({
    ...body,
    content: [{ type: "text", text }],
    usage: { buyer_cost_micro: 75 },
  });

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ScreeningQualificationError);
    return error as ScreeningQualificationError;
  }
  throw new Error("expected the qualification to fail");
}

test("screening dry run checks the request and price bounds without a call", async () => {
  const source = sequence([ok]);
  const result = await qualifySecurityScreening(
    undefined,
    true,
    source.fetch,
    noSleep,
  );
  expect(result.requests).toBe(0);
  expect(source.calls()).toBe(0);
});

test("screening retries transient failures within the attempt bound", async () => {
  for (const transient of [
    json({ type: "error", error: { type: "overloaded_error" } }, 503),
    json({ type: "error", error: { type: "rate_limit_error" } }, 429),
    answer("The report looks legitimate."),
    json({
      ...body,
      stop_reason: "max_tokens",
      usage: { buyer_cost_micro: 75 },
    }),
  ]) {
    const source = sequence([transient, ok]);
    const result = await qualifySecurityScreening(
      "synthetic-only",
      false,
      source.fetch,
      noSleep,
    );
    expect(result.requests).toBe(2);
    expect(result.failedAttempts).toHaveLength(1);
    expect(source.calls()).toBe(2);
  }
});

test("screening reports the category after exhausting transient retries", async () => {
  const source = sequence([
    json({ type: "error", error: { type: "overloaded_error" } }, 503),
  ]);
  const error = await failure(
    qualifySecurityScreening("synthetic-only", false, source.fetch, noSleep),
  );
  expect(error.category).toBe("http-status");
  expect(error.detail).toEqual({
    status: 503,
    errorType: "overloaded_error",
    retryable: true,
  });
  expect(error.attempts).toHaveLength(MAXIMUM_ATTEMPTS);
  expect(source.calls()).toBe(MAXIMUM_ATTEMPTS);
  const thrown = sequence([
    () => {
      throw new TypeError("fetch failed");
    },
  ]);
  const network = await failure(
    qualifySecurityScreening("synthetic-only", false, thrown.fetch, noSleep),
  );
  expect(network.category).toBe("network");
  expect(thrown.calls()).toBe(MAXIMUM_ATTEMPTS);
});

test("screening retries a committed provider error that names no served model", async () => {
  // Surplus commits HTTP 200 before a long call ends. A later failure is an
  // error envelope with its receipt but without a model field.
  const committed = json({
    type: "error",
    error: { type: "api_error", message: "Upstream request failed" },
    usage: { buyer_cost_micro: 75 },
  });
  const recovered = sequence([committed, ok]);
  const result = await qualifySecurityScreening(
    "synthetic-only",
    false,
    recovered.fetch,
    noSleep,
  );
  expect(result.failedAttempts).toEqual([
    {
      attempt: 1,
      category: "incomplete",
      errorType: "api_error",
      stopReason: null,
      truncated: false,
    },
  ]);
  expect(recovered.calls()).toBe(2);
  const persistent = sequence([committed]);
  const error = await failure(
    qualifySecurityScreening(
      "synthetic-only",
      false,
      persistent.fetch,
      noSleep,
    ),
  );
  expect(error.category).toBe("incomplete");
  expect(error.detail.errorType).toBe("api_error");
  expect(persistent.calls()).toBe(MAXIMUM_ATTEMPTS);
});

test("screening fails closed at once on a wrong decision or a rejected key", async () => {
  for (const verdict of ["needs-information", "spam"]) {
    const wrong = sequence([
      answer(
        JSON.stringify({ decision: verdict, reason: "Synthetic refusal" }),
      ),
      ok,
    ]);
    const decision = await failure(
      qualifySecurityScreening("synthetic-only", false, wrong.fetch, noSleep),
    );
    expect(decision.category).toBe("wrong-decision");
    expect(decision.detail).toEqual({ decision: verdict });
    expect(wrong.calls()).toBe(1);
  }
  for (const status of [401, 402, 403]) {
    for (const readable of [true, false]) {
      const rejected = sequence([
        readable
          ? json(
              { type: "error", error: { type: "authentication_error" } },
              status,
            )
          : () => new Response("Unauthorized", { status }),
        ok,
      ]);
      const error = await failure(
        qualifySecurityScreening(
          "synthetic-only",
          false,
          rejected.fetch,
          noSleep,
        ),
      );
      expect(error.category).toBe("http-status");
      expect(error.detail.status).toBe(status);
      expect(rejected.calls()).toBe(1);
    }
  }
});

test("screening categories never carry the key or model text", async () => {
  const secret = "inf_SYNTHETIC_SECRET_VALUE";
  const source = sequence([answer(`not json ${secret}`)]);
  const error = await failure(
    qualifySecurityScreening(secret, false, source.fetch, noSleep),
  );
  expect(error.category).toBe("schema-invalid");
  expect(JSON.stringify(error.attempts)).not.toContain(secret);
  expect(error.message).not.toContain(secret);
});

test("screening accepts the requested JSON inside one Markdown fence", async () => {
  const source = sequence([
    answer('```json\n{"decision":"legitimate","reason":"Concrete"}\n```'),
  ]);
  const result = await qualifySecurityScreening(
    "synthetic-only",
    false,
    source.fetch,
    noSleep,
  );
  expect(result.requests).toBe(1);
});

test("Orbio qualification refuses a Surplus receipt and stops after the unknown charge", async () => {
  const value = {
    ...body,
    model: "anthropic/claude-sonnet-5.5",
    usage: { buyer_cost_micro: 0 },
  };
  const source = transport(value, { "x-si-buyer-cost-micro": "0" });
  const wrapped = qualificationTransport(source.fetch);
  const orbioRequest = () =>
    new Request("https://api.orbio.so/api/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-5.5",
        item: { contentOmittedFromModel: true },
      }),
    });
  await expect(wrapped.fetch(orbioRequest())).rejects.toThrow();
  expect(await wrapped.mayCall()).toBe(false);
  await expect(wrapped.fetch(orbioRequest())).rejects.toThrow();
  expect(source.calls()).toBe(1);
});

test("qualification rejects a model sent to the other provider before spending", async () => {
  const source = transport({ ...body, usage: { buyer_cost_micro: 0 } });
  const wrapped = qualificationTransport(source.fetch);
  for (const [endpoint, model] of [
    [ENDPOINT, "anthropic/claude-sonnet-5.5"],
    ["https://api.orbio.so/api/v1/messages", "claude-sonnet-5.5"],
  ]) {
    await expect(
      wrapped.fetch(
        new Request(endpoint, {
          method: "POST",
          body: JSON.stringify({
            model,
            item: { contentOmittedFromModel: true },
          }),
        }),
      ),
    ).rejects.toThrow();
  }
  expect(source.calls()).toBe(0);
  expect(wrapped.requestCount()).toBe(0);
});

test("Orbio qualification retains its USD cost receipt without consuming SDK output", async () => {
  for (const cost of [0, 0.000075]) {
    const value = {
      ...body,
      model: "anthropic/claude-sonnet-5.5",
      usage: { cost },
    };
    const source = transport(value);
    const wrapped = qualificationTransport(source.fetch);
    const response = await wrapped.fetch(
      new Request("https://api.orbio.so/api/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: value.model,
          item: { contentOmittedFromModel: true },
        }),
      }),
    );
    expect(await response.json()).toEqual(value);
    expect(source.calls()).toBe(1);
    expect(wrapped.requestCount()).toBe(1);
    expect(await wrapped.mayCall()).toBe(true);
  }
});

test("fractional Orbio receipts bound qualification spending without inventing an actual ledger charge", async () => {
  const value = {
    ...body,
    model: "anthropic/claude-sonnet-5.5",
    usage: { cost: 0.0000755 },
  };
  expect(providerCost(new Headers(), value, "orbio")).toBeNull();
  const receipt = await qualificationResponse(Response.json(value), "orbio");
  expect(receipt.cost).toBe(76);
  const source = transport({ ...value, usage: { cost: 0.9999995 } });
  const wrapped = qualificationTransport(source.fetch);
  await wrapped.fetch(
    new Request("https://api.orbio.so/api/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: value.model,
        item: { contentOmittedFromModel: true },
      }),
    }),
  );
  expect(await wrapped.mayCall()).toBe(false);
  expect(source.calls()).toBe(1);
});
