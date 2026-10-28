/** PRD section 5: immutable attempt records, duplicate refusal and queue
 * limits. A retry after a provider failure or an invalid provider result is a
 * new paid attempt, so one source digest may start only
 * VALUE_INFERENCE_ATTEMPT_LIMIT of them. A local provider fixture proves the
 * control; it is not a live provider receipt or model qualification.
 */
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  runValueInference,
  VALUE_INFERENCE_ATTEMPT_LIMIT,
} from "./value-inference";

const MIGRATIONS = [
  "0013_slopbot.sql",
  "0039_slopbot_provider_cost.sql",
  "0043_slopbot_provider_request.sql",
  "0047_slopbot_review_billing.sql",
  "0049_slopbot_spend_alerts.sql",
  "0051_slopbot_value_budget.sql",
  "0054_slopbot_value_inference_results.sql",
  "0077_slopbot_alerts_only.sql",
  "0084_slopbot_attempt_accounting.sql",
  "0085_slopbot_provider_failure_notices.sql",
  "0104_slopbot_value_inference_attempts.sql",
];

const output = (sourceDigest: string) => ({
  sourceDigest,
  name: "attempt_limit_fixture",
  schema: {
    type: "object",
    properties: { accepted: { type: "boolean" } },
    required: ["accepted"],
    additionalProperties: false,
  },
  validate: (value: unknown) =>
    (value as { accepted?: boolean })?.accepted === true
      ? { accepted: true }
      : null,
});
const prompt = {
  system: "Local attempt-limit fixture",
  policy: "No publication",
  item: "No source material",
};

test("provider retries of one source are bounded and recorded immutably", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  let requests = 0;
  // Every provider response is billable but invalid, the re-billing case.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++;
      const input = (await request.json()) as { model: string };
      return Response.json(
        {
          id: `local-${requests}`,
          type: "message",
          role: "assistant",
          model: input.model,
          content: [{ type: "text", text: "invalid JSON" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        { headers: { "x-si-buyer-cost-micro": "1000" } },
      );
    },
  });
  const env = {
    SURPLUS_API_KEY: "local-only",
    SURPLUS_BASE_URL: `http://127.0.0.1:${server.port}`,
  };
  const attempt = (sourceDigest: string) =>
    runValueInference(env, prompt, output(sourceDigest), async () => true, {
      db,
      installationId: 1,
      attemptId: `value:${crypto.randomUUID()}`,
      maximumMicroUsd: null,
      approvedMonthlyMicroUsd: null,
    }).then(
      (result) => result,
      () => ({ verdict: null, blocked: false, blockReason: null }),
    );
  try {
    const perAttempt: number[] = [];
    for (let i = 0; i < VALUE_INFERENCE_ATTEMPT_LIMIT; i++) {
      const before = requests;
      const result = await attempt("a".repeat(64));
      expect(result.verdict).toBeNull();
      expect(result.blockReason).not.toBe("attempts");
      perAttempt.push(requests - before);
    }
    expect(perAttempt.every((n) => n > 0)).toBe(true);
    const spent = requests;
    // The next retry of the same source is refused before any provider call.
    const refused = await attempt("a".repeat(64));
    expect(refused).toMatchObject({ blocked: true, blockReason: "attempts" });
    expect(requests).toBe(spent);
    expect(
      sqlite
        .query(
          "SELECT COUNT(*) AS n FROM slopbot_value_inference_attempts a JOIN slopbot_value_budget_reservations r USING (attempt_id)",
        )
        .get(),
    ).toEqual({ n: VALUE_INFERENCE_ATTEMPT_LIMIT });
    expect(() =>
      sqlite.exec("DELETE FROM slopbot_value_inference_attempts"),
    ).toThrow("immutable");
    expect(() =>
      sqlite.exec("UPDATE slopbot_value_inference_attempts SET started_at=''"),
    ).toThrow("immutable");
    // A changed source has its own digest and its own attempts.
    const changed = await attempt("b".repeat(64));
    expect(changed.blockReason).not.toBe("attempts");
    expect(requests).toBeGreaterThan(spent);
  } finally {
    server.stop(true);
    sqlite.close();
  }
});
