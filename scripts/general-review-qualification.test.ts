import { expect, test } from "bun:test";
import {
  qualificationTransport,
  qualifyGeneralReview,
} from "./qualify-value-models";

// Synthetic transport outputs prove the qualification wiring and refusal
// controls. Only the protected release's real call qualifies model behavior.
const verdict = {
  category: "empty",
  confidence: 0.99,
  rule_refs: [{ source: "universal", quote: ".plugin-root" }],
  evidence: [".plugin-root"],
  summary: "The file is empty, but its role is not established.",
  limitations: [
    "The loader and marker-path behavior of .plugin-root is unknown.",
  ],
  objective_defect: null,
};

function provider(result: unknown = verdict, status = 200) {
  const requests: Record<string, unknown>[] = [];
  return {
    requests,
    fetch: (async (input, init) => {
      const request = new Request(input, init);
      requests.push((await request.json()) as Record<string, unknown>);
      return Response.json(
        status === 200
          ? {
              type: "message",
              role: "assistant",
              model: "claude-sonnet-5.5",
              usage: {
                input_tokens: 20,
                output_tokens: 30,
                buyer_cost_micro: 0,
              },
              content: [{ type: "text", text: JSON.stringify(result) }],
              stop_reason: "end_turn",
            }
          : {
              type: "error",
              error: { type: "api_error", message: "Synthetic refusal" },
              usage: { buyer_cost_micro: 0 },
            },
        { status },
      );
    }) as typeof fetch,
  };
}

test("general-review qualification retains marker uncertainty", async () => {
  const source = provider();
  const result = await qualifyGeneralReview(
    { SURPLUS_API_KEY: "synthetic-only" },
    false,
    source.fetch,
  );
  expect(result).toMatchObject({
    path: "general-review-counterexample",
    provider: "surplus",
    model: "claude-sonnet-5.5",
    requests: 1,
  });
  expect(source.requests).toHaveLength(1);
  expect(source.requests[0].max_tokens).toBe(2048);
  expect(JSON.stringify(source.requests[0].messages)).toContain(".plugin-root");
});

test("general-review qualification refuses an absent or irrelevant limitation", async () => {
  for (const limitations of [[], ["Tests were not run."]]) {
    const source = provider({ ...verdict, limitations });
    await expect(
      qualifyGeneralReview(
        { SURPLUS_API_KEY: "synthetic-only" },
        false,
        source.fetch,
      ),
    ).rejects.toThrow();
    expect(source.requests).toHaveLength(1);
  }
});

test("general-review receipted failures retain the two-request ceiling", async () => {
  const source = provider(null, 503);
  await expect(
    qualifyGeneralReview(
      { SURPLUS_API_KEY: "synthetic-only" },
      false,
      source.fetch,
    ),
  ).rejects.toThrow();
  expect(source.requests).toHaveLength(2);
});

test("general-review transport allows only two zero-cost requests", async () => {
  const source = provider();
  const transport = qualificationTransport(source.fetch, "general-review");
  const request = () =>
    new Request("https://api.surplusintelligence.ai/anthropic/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-5.5",
        item: "Synthetic marker-file review qualification",
      }),
    });
  await transport.fetch(request());
  expect(await transport.mayCall()).toBe(true);
  await transport.fetch(request());
  expect(await transport.mayCall()).toBe(false);
  await expect(transport.fetch(request())).rejects.toThrow();
  expect(source.requests).toHaveLength(2);
});

test("general-review dry run prepares the case without calling a provider", async () => {
  const source = provider();
  expect(await qualifyGeneralReview({}, true, source.fetch)).toMatchObject({
    path: "general-review-counterexample",
    provider: null,
    model: null,
    requests: 0,
  });
  expect(source.requests).toHaveLength(0);
});

test("general review follows a Surplus spending denial to a real Orbio verdict", async () => {
  const requests: { url: string; model: string }[] = [];
  const result = await qualifyGeneralReview(
    { ORBIO_API_KEY: "synthetic-orbio", SURPLUS_API_KEY: "synthetic-surplus" },
    false,
    (async (input, init) => {
      const request = new Request(input, init);
      const wire = (await request.json()) as { model: string };
      requests.push({ url: request.url, model: wire.model });
      if (requests.length === 1)
        return Response.json(
          {
            type: "error",
            error: {
              type: "invalid_request_error",
              detail: {
                window: "month",
                limit_micro: 100,
                spent_micro: 100,
                resets_at: "2026-12-01T00:00:00.000Z",
              },
            },
          },
          { status: 400 },
        );
      return Response.json({
        type: "message",
        role: "assistant",
        model: "anthropic/claude-sonnet-5.5",
        usage: { input_tokens: 20, output_tokens: 30, cost: 0.0001 },
        content: [{ type: "text", text: JSON.stringify(verdict) }],
        stop_reason: "end_turn",
      });
    }) as typeof fetch,
  );
  expect(result.provider).toBe("orbio");
  expect(result.model).toBe("anthropic/claude-sonnet-5.5");
  expect(result.requests).toBe(2);
  expect(result.outcome).toBe("marker uncertainty preserved");
  expect(requests.map((request) => request.model)).toEqual([
    "claude-sonnet-5.5",
    "anthropic/claude-sonnet-5.5",
  ]);
});

test("an Orbio quota rejection after a Surplus denial fails qualification within two requests", async () => {
  let calls = 0;
  await expect(
    qualifyGeneralReview(
      {
        ORBIO_API_KEY: "synthetic-orbio",
        SURPLUS_API_KEY: "synthetic-surplus",
      },
      false,
      (async (_input: RequestInfo | URL, _init?: RequestInit) => {
        calls++;
        if (calls === 1)
          return Response.json(
            {
              type: "error",
              error: {
                type: "invalid_request_error",
                detail: {
                  window: "month",
                  limit_micro: 100,
                  spent_micro: 100,
                  resets_at: "2026-12-01T00:00:00.000Z",
                },
              },
            },
            { status: 400 },
          );
        return Response.json(
          { error: { type: "insufficient_quota" } },
          { status: 402 },
        );
      }) as typeof fetch,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(2);
});
