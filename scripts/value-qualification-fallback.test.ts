import { expect, test } from "bun:test";
import { VALUE_DIMENSIONS } from "../src/lib/value-assessment";
import { qualifyValueModels } from "./qualify-value-models";

test("independent value paths each retain a rejected-call reserve and finish through fallback", async () => {
  const original = globalThis.fetch;
  const requests: { provider: string; model: string }[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init);
    const wire = (await request.json()) as {
      model: string;
      output_config: { format: { schema: { required: string[] } } };
      messages: { content: { text: string }[] }[];
    };
    const orbio = request.url.includes("orbio.so");
    requests.push({ provider: orbio ? "orbio" : "surplus", model: wire.model });
    if (orbio)
      return Response.json(
        { error: { type: "insufficient_quota", code: "insufficient_quota" } },
        { status: 402 },
      );
    const assessment = {
      status: "unresolved",
      tier: null,
      rationale: "Media was not viewed.",
      dimensions: Object.fromEntries(
        VALUE_DIMENSIONS.map((k) => [k, "Unviewed media prevents assessment."]),
      ),
      limitations: ["The media was not viewed."],
      evidenceUrls: [],
      relatedPullRequests: [],
      reviews: [],
    };
    const isJoint = wire.output_config.format.schema.required.includes("units");
    const item = JSON.parse(wire.messages[0].content[1].text) as {
      claims: { id: string }[];
    };
    const verdict = isJoint
      ? {
          units: [
            { claimIds: item.claims.map((claim) => claim.id), assessment },
          ],
        }
      : assessment;
    return Response.json({
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5.5",
      usage: { input_tokens: 1, output_tokens: 1, buyer_cost_micro: 100 },
      content: [{ type: "text", text: JSON.stringify(verdict) }],
      stop_reason: "end_turn",
    });
  }) as typeof fetch;
  try {
    const result = await qualifyValueModels({
      ORBIO_API_KEY: "synthetic",
      SURPLUS_API_KEY: "synthetic",
    });
    expect(result.map((r) => r.path)).toEqual(["single", "joint"]);
    expect(
      result.every((r) => r.provider === "surplus" && r.requests === 2),
    ).toBe(true);
    expect(requests.map((r) => r.provider)).toEqual([
      "orbio",
      "surplus",
      "orbio",
      "surplus",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
