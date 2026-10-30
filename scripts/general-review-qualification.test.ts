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
              model: "claude-opus-5.5",
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
    model: "claude-opus-5.5",
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

test("general-review provider failure never starts a fallback request", async () => {
  const source = provider(null, 503);
  await expect(
    qualifyGeneralReview(
      { SURPLUS_API_KEY: "synthetic-only" },
      false,
      source.fetch,
    ),
  ).rejects.toThrow();
  expect(source.requests).toHaveLength(1);
});

test("general-review transport allows only one zero-cost request", async () => {
  const source = provider();
  const transport = qualificationTransport(source.fetch, "general-review");
  const request = () =>
    new Request("https://api.surplusintelligence.ai/anthropic/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-opus-5.5",
        item: "Synthetic marker-file review qualification",
      }),
    });
  await transport.fetch(request());
  expect(await transport.mayCall()).toBe(false);
  await expect(transport.fetch(request())).rejects.toThrow();
  expect(source.requests).toHaveLength(1);
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
