/** PRD section 5: immutable attempt records, duplicate refusal and queue
 * limits. A retry after a provider failure or an invalid provider result is a
 * new paid attempt, so one source digest may start only
 * VALUE_INFERENCE_ATTEMPT_LIMIT of them. A local provider fixture proves the
 * control; it is not a live provider receipt or model qualification.
 */
import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { PROVIDER_BUDGET_EXHAUSTED, TRIAGE_ROUTE } from "./models";
import { recordCalls } from "./persistence";
import {
  countedValueAttemptsSql,
  reserveValueInferenceBudget,
} from "./value-budget";
import {
  runValueInference,
  VALUE_INFERENCE_ATTEMPT_LIMIT,
} from "./value-inference";

const MIGRATIONS = [
  "0013_slopbot.sql",
  "0039_slopbot_provider_cost.sql",
  "0041_slopbot_immutable_ledger.sql",
  "0043_slopbot_provider_request.sql",
  "0047_slopbot_review_billing.sql",
  "0049_slopbot_spend_alerts.sql",
  "0051_slopbot_value_budget.sql",
  "0054_slopbot_value_inference_results.sql",
  "0077_slopbot_alerts_only.sql",
  "0084_slopbot_attempt_accounting.sql",
  "0085_slopbot_provider_failure_notices.sql",
  "0104_slopbot_value_inference_attempts.sql",
  "0118_slopbot_value_attempt_completion.sql",
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

async function providerRetries(knownCost: boolean) {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  let requests = 0;
  // Every response is non-free and invalid; one variant omits its actual cost.
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
        { headers: knownCost ? { "x-si-buyer-cost-micro": "1000" } : {} },
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
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM slopbot_value_attempt_completions")
        .get(),
    ).toEqual({ n: VALUE_INFERENCE_ATTEMPT_LIMIT });
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM slopbot_value_budget_reconciliations")
        .get(),
    ).toEqual({ n: knownCost ? VALUE_INFERENCE_ATTEMPT_LIMIT : 0 });
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
}

test("provider retries of one source are bounded and recorded immutably", () =>
  providerRetries(true),
);
test("completed attempts with unknown cost amounts still have a terminal cap", () =>
  providerRetries(false),
);

test("concurrent admitted inferences cannot reserve the same final attempt slot", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  let requests = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++;
      const input = (await request.json()) as { model: string };
      return Response.json(
        {
          id: `concurrent-${requests}`,
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
  const sourceDigest = "d".repeat(64);
  const invoke = (
    attemptId: string,
    database = db,
    mayCall = async () => true,
  ) =>
    runValueInference(env, prompt, output(sourceDigest), mayCall, {
      db: database,
      installationId: 1,
      attemptId,
      maximumMicroUsd: null,
      approvedMonthlyMicroUsd: null,
    });
  let entered = () => {};
  let release = () => {};
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reservationPrepared = false;
  const delayedDb = {
    ...db,
    prepare(sql: string) {
      if (sql.includes("INSERT INTO slopbot_value_budget_reservations"))
        reservationPrepared = true;
      return db.prepare(sql);
    },
    async batch(statements: Parameters<typeof db.batch>[0]) {
      if (reservationPrepared) {
        entered();
        await held;
      }
      return db.batch(statements);
    },
  };
  const delayedId = `value:${crypto.randomUUID()}`;
  const winningId = `value:${crypto.randomUUID()}`;
  let delayedMayCall = true;
  let pending: ReturnType<typeof runValueInference> | undefined;
  try {
    for (let index = 0; index < VALUE_INFERENCE_ATTEMPT_LIMIT - 1; index++) {
      const result = await invoke(`value:${crypto.randomUUID()}`);
      expect(result.blocked).toBe(false);
      expect(result.verdict).toBeNull();
    }
    const priorRequests = requests;
    pending = invoke(delayedId, delayedDb, async () => delayedMayCall);
    await waiting;
    const winner = await invoke(winningId);
    expect(winner.blocked).toBe(false);
    expect(winner.calls.length).toBeGreaterThan(0);
    delayedMayCall = false;
    release();
    expect(await pending).toMatchObject({
      blocked: true,
      blockReason: "attempts",
      calls: [],
    });
    expect(requests).toBe(priorRequests + winner.calls.length);
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM slopbot_value_inference_attempts")
        .get(),
    ).toEqual({ n: VALUE_INFERENCE_ATTEMPT_LIMIT + 1 });
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM slopbot_value_budget_reservations")
        .get(),
    ).toEqual({ n: VALUE_INFERENCE_ATTEMPT_LIMIT });
    expect(
      sqlite
        .query(
          "SELECT attempt_id FROM slopbot_value_inference_attempts WHERE attempt_id=?",
        )
        .get(delayedId),
    ).toEqual({ attempt_id: delayedId });
    expect(
      sqlite
        .query(
          "SELECT attempt_id FROM slopbot_value_budget_reservations WHERE attempt_id=?",
        )
        .get(delayedId),
    ).toBeNull();
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM slopbot_costs WHERE review_key=?")
        .get(delayedId),
    ).toEqual({ n: 0 });
    const refused = await invoke(`value:${crypto.randomUUID()}`);
    expect(refused).toMatchObject({
      blocked: true,
      blockReason: "attempts",
      calls: [],
    });
    expect(requests).toBe(priorRequests + winner.calls.length);
  } finally {
    release();
    await pending?.catch(() => {});
    server.stop(true);
    sqlite.close();
  }
});

test("an atomic attempt refusal is retained when a free receipt arrives before its response", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const key = "e".repeat(64);
  const ids = Array.from({ length: 5 }, () => `value:${crypto.randomUUID()}`);
  const reserve = (id: string, database = db) =>
    reserveValueInferenceBudget(
      database,
      id,
      key,
      VALUE_INFERENCE_ATTEMPT_LIMIT,
      null,
      null,
    );
  try {
    // These immutable admissions precede the three reservation commits.
    for (const id of ids)
      await db
        .prepare(
          "INSERT INTO slopbot_value_inference_attempts (attempt_id,inference_key,started_at) VALUES (?,?,?)",
        )
        .bind(id, key, new Date().toISOString())
        .run();
    for (const id of ids.slice(0, VALUE_INFERENCE_ATTEMPT_LIMIT))
      expect(await reserve(id)).toBe("reserved");
    const delayedReply = {
      ...db,
      async batch(statements: Parameters<typeof db.batch>[0]) {
        const results = await db.batch(statements);
        const step = TRIAGE_ROUTE[0];
        await recordCalls(db, ids[2], 1, "triage", [
          {
            routeStep: 1,
            provider: step.provider,
            requestedModel: step.model,
            servedModel: null,
            priceKey: step.priceKey,
            outcome: "failed",
            failure: PROVIDER_BUDGET_EXHAUSTED,
            usage: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
            providerCostMicroUsd: 0,
            providerRequestId: "local-free-receipt",
          },
        ]);
        return results;
      },
    };
    expect(await reserve(ids[3], delayedReply)).toBe("attempts-pending");
    expect(
      await db
        .prepare(`SELECT ${countedValueAttemptsSql("?1", "?2")} AS n`)
        .bind(key, PROVIDER_BUDGET_EXHAUSTED)
        .first(),
    ).toEqual({ n: 2 });
    expect(
      sqlite
        .query(
          "SELECT attempt_id FROM slopbot_value_budget_reservations WHERE attempt_id=?",
        )
        .get(ids[3]),
    ).toBeNull();
    expect(await reserve(ids[4])).toBe("reserved");
  } finally {
    sqlite.close();
  }
});

test("inference without atomic reservation storage refuses before a provider call", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  const attemptId = `value:${crypto.randomUUID()}`;
  try {
    await expect(
      runValueInference({}, prompt, output("f".repeat(64)), async () => true, {
        db: { prepare: (sql) => db.prepare(sql) },
        installationId: 1,
        attemptId,
        maximumMicroUsd: null,
        approvedMonthlyMicroUsd: null,
      }),
    ).rejects.toThrow("Transactional inference storage is required");
    expect(
      sqlite
        .query("SELECT attempt_id FROM slopbot_value_inference_attempts")
        .get(),
    ).toBeNull();
    expect(
      sqlite
        .query("SELECT COUNT(*) AS n FROM slopbot_value_budget_reservations")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      sqlite.query("SELECT COUNT(*) AS n FROM slopbot_costs").get(),
    ).toEqual({ n: 0 });
  } finally {
    sqlite.close();
  }
});

/** README "Free reviews, budget blocks, spend": a provider spending denial
 * stops the route, and the item waits and resumes. The denial is free, so it
 * is not one of the paid attempts.
 */
test("a provider spending denial waits as a budget block and uses no paid attempt", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  let requests = 0;
  let denied = true;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      requests++;
      const input = (await request.json()) as { model: string };
      if (denied)
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
            usage: { buyer_cost_micro: 0 },
          },
          { status: 400 },
        );
      // After the reset: billable but invalid responses.
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
  const attempt = async () => {
    const before = requests;
    const result = await runValueInference(
      env,
      prompt,
      output("c".repeat(64)),
      async () => true,
      {
        db,
        installationId: 1,
        attemptId: `value:${crypto.randomUUID()}`,
        maximumMicroUsd: null,
        approvedMonthlyMicroUsd: null,
      },
    );
    return { requests: requests - before, blockReason: result.blockReason };
  };
  try {
    // More denials than the attempt limit: every retry still reaches the
    // provider, so the request resumes when the provider budget resets.
    const deniedAttempts = [];
    for (let i = 0; i <= VALUE_INFERENCE_ATTEMPT_LIMIT; i++)
      deniedAttempts.push(await attempt());
    expect(deniedAttempts.map((a) => a.requests)).toEqual(
      Array(VALUE_INFERENCE_ATTEMPT_LIMIT + 1).fill(1),
    );
    expect(deniedAttempts.map((a) => a.blockReason)).toEqual(
      Array(VALUE_INFERENCE_ATTEMPT_LIMIT + 1).fill("budget"),
    );
    // After the reset, paid attempts are still bounded at the full limit.
    denied = false;
    for (let i = 0; i < VALUE_INFERENCE_ATTEMPT_LIMIT; i++) {
      const paid = await attempt();
      expect(paid.requests).toBeGreaterThan(0);
      expect(paid.blockReason).not.toBe("attempts");
    }
    expect(await attempt()).toEqual({ requests: 0, blockReason: "attempts" });
  } finally {
    server.stop(true);
    sqlite.close();
  }
});
