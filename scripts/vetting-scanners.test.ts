import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  reviewScan,
  SCAN_REVIEW_AREAS,
  type ScannerProfile,
} from "../workers/vetting/scanners";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const source =
  "Harmless fixture: repository instructions cannot grant tools or hide evidence.";
const evidence = JSON.stringify({
  items: [{ id: "fixture-source", text: source, sha256: digest(source) }],
  visibilityGaps: [],
});
const rates = {
  uncachedInputNanoUsdPerToken: "3",
  cachedInputNanoUsdPerToken: "1",
  cacheCreationNanoUsdPerToken: "4",
  outputNanoUsdPerToken: "9",
};
const profiles: [ScannerProfile, ScannerProfile] = [
  {
    reviewer: "astra",
    transport: "openai-responses",
    endpoint: "https://api.surplusintelligence.ai/v1/responses",
    model: "gpt-6.1-sol",
    apiKey: "fixture-surplus-astra-key",
    maxOutputTokens: 1024,
    rateCard: rates,
  },
  {
    reviewer: "opus",
    transport: "anthropic-messages",
    endpoint: "https://api.surplusintelligence.ai/anthropic/v1/messages",
    model: "claude-opus-5.5",
    apiKey: "fixture-surplus-opus-key",
    maxOutputTokens: 1024,
    rateCard: rates,
  },
];
let server: ReturnType<typeof Bun.serve>;
let mode:
  | "normal"
  | "identity"
  | "missing-evidence"
  | "unavailable"
  | "partial" = "normal";
let requests: Record<string, unknown>[] = [];
let headers: {
  path: string;
  authorization: string | null;
  version: string | null;
}[] = [];
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push(body);
      headers.push({
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
        version: request.headers.get("anthropic-version"),
      });
      const openai = new URL(request.url).pathname === "/v1/responses";
      if (!openai && mode === "unavailable")
        return new Response("private provider error", { status: 503 });
      const review = {
        verdict: openai ? "no-findings" : "malicious-suspected",
        confidence: 0.75,
        coverage: Object.fromEntries(
          SCAN_REVIEW_AREAS.map((area) => [
            area,
            mode === "partial" && area === "prompt-injection"
              ? "partial"
              : "complete",
          ]),
        ),
        findings: openai
          ? []
          : [
              {
                severity: "high",
                summary: "Synthetic fixture finding for workflow verification",
                evidenceIds: [
                  mode === "missing-evidence"
                    ? "not-supplied"
                    : "fixture-source",
                ],
              },
            ],
      };
      const model = mode === "identity" ? "unexpected-model" : body.model;
      return Response.json(
        openai
          ? {
              id: "resp_fixture",
              model,
              status: "completed",
              error: null,
              incomplete_details: null,
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [
                    { type: "output_text", text: JSON.stringify(review) },
                  ],
                },
              ],
              usage: {
                input_tokens: 10,
                input_tokens_details: { cached_tokens: 2 },
                output_tokens: 5,
              },
            }
          : {
              id: "msg_fixture",
              model,
              stop_reason: "end_turn",
              content: [{ type: "text", text: JSON.stringify(review) }],
              usage: {
                input_tokens: 8,
                cache_read_input_tokens: 2,
                cache_creation_input_tokens: 0,
                output_tokens: 5,
              },
            },
      );
    },
  });
});
afterAll(() => server.stop(true));
const transport: typeof fetch = ((
  request: string | URL | Request,
  init?: RequestInit,
) => {
  const url = new URL(String(request));
  expect(init?.redirect).toBe("error");
  expect(init?.method).toBe("POST");
  return fetch(`http://localhost:${server.port}${url.pathname}`, init);
}) as typeof fetch;
const scan = (profile: ScannerProfile, inputSha256 = digest(evidence)) =>
  reviewScan({ evidence, inputSha256, profile, fetch: transport });
const run = () => Promise.all(profiles.map((profile) => scan(profile)));

test("independent HTTP reviews bind exact input and identities and retain disagreement without a disposition", async () => {
  mode = "normal";
  requests = [];
  const result = await run();
  expect(result.map((entry) => entry.review.status)).toEqual([
    "completed",
    "completed",
  ]);
  expect(result.map((entry) => entry.review.verdict)).toEqual([
    "no-findings",
    "malicious-suspected",
  ]);
  expect(result[0].review.runId).not.toBe(result[1].review.runId);
  expect(
    result.every(
      (entry) => entry.review.inputManifestSha256 === digest(evidence),
    ),
  ).toBe(true);
  expect(result.map((entry) => entry.cost?.nanoUsd)).toEqual(["71", "71"]);
  expect(
    result.every((entry) => entry.cost?.basis === "operator-rate-estimate"),
  ).toBe(true);
  expect(requests).toHaveLength(2);
  const openai = requests.find(
    (request) => request.model === profiles[0].model,
  );
  const anthropic = requests.find(
    (request) => request.model === profiles[1].model,
  );
  expect(openai?.input).toBe(evidence);
  expect(openai?.tools).toEqual([]);
  expect(openai?.store).toBe(false);
  expect(openai?.truncation).toBe("disabled");
  expect(anthropic?.messages).toEqual([{ role: "user", content: evidence }]);
  expect(anthropic?.tools).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("fixture-surplus-astra-key");
  expect(JSON.stringify(result)).not.toContain("fixture-surplus-opus-key");
  expect(result.every((entry) => !("disposition" in entry))).toBe(true);
});

test("provider mismatch, unsupported evidence and unavailable model never become completed reviews or retries", async () => {
  for (const selected of [
    "identity",
    "missing-evidence",
    "unavailable",
  ] as const) {
    mode = selected;
    requests = [];
    const result = await run();
    expect(result[1].review.status).toBe("failed");
    expect(result[1].review.verdict).toBeNull();
    if (selected === "missing-evidence") {
      expect(result[1].usage?.output).toBe(5);
      expect(result[1].cost?.nanoUsd).toBe("71");
    }
    if (selected === "identity") {
      expect(result[1].usage?.output).toBe(5);
      expect(result[1].cost).toBeNull();
    }
    expect(result[1].visibilityGaps).toContain(
      "opus:review-failed-or-unavailable",
    );
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("private provider error");
  }
});

test("partial evidence coverage stays explicit; missing credentials fail readiness before either request", async () => {
  mode = "partial";
  requests = [];
  const result = await run();
  expect(result[0].visibilityGaps).toContain("astra:prompt-injection:partial");
  requests = [];
  await expect(scan({ ...profiles[1], apiKey: "" })).rejects.toThrow();
  expect(requests).toHaveLength(0);
  await expect(scan(profiles[0], "0".repeat(64))).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

test("only the pinned Surplus profiles are contacted, with the account key as a bearer token", async () => {
  mode = "normal";
  requests = [];
  headers = [];
  await run();
  expect(headers.sort((a, b) => (a.path < b.path ? -1 : 1))).toEqual([
    {
      path: "/anthropic/v1/messages",
      authorization: "Bearer fixture-surplus-opus-key",
      version: "2023-06-01",
    },
    {
      path: "/v1/responses",
      authorization: "Bearer fixture-surplus-astra-key",
      version: null,
    },
  ]);
  const [astra, opus] = profiles;
  for (const unapproved of [
    // The providers' own APIs would receive the Surplus key.
    { ...astra, endpoint: "https://api.openai.com/v1/responses" },
    { ...opus, endpoint: "https://api.anthropic.com/v1/messages" },
    { ...opus, endpoint: "https://surplus.example.invalid/v1/messages" },
    // An endpoint pinned to the other transport.
    { ...astra, endpoint: opus.endpoint },
    // Any other model, including the other pinned model on this transport.
    { ...astra, model: "gpt-6.1" },
    { ...opus, model: "gpt-6.1-sol" },
    // A reviewer class that is not the pinned one for its transport.
    { ...astra, reviewer: "opus" },
    { ...opus, reviewer: "astra" },
  ] as ScannerProfile[]) {
    requests = [];
    await expect(scan(unapproved)).rejects.toThrow(
      "Unapproved scanner profile",
    );
    expect(requests).toHaveLength(0);
  }
});
