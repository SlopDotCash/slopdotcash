import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleNotifyRequest } from "../notify/handler";
import { dispatchFailureAlert } from "./failure-alerts";
import { dispatchSpendAlert } from "./spend-alerts";
import { reconcileValueBudget, reserveValueBudget } from "./value-budget";
import { runValueInference } from "./value-inference";

// Real migrations, SQL and HTTP handler. Only the external mail service is
// captured; this does not claim provider acceptance or an inbox delivery.
function harness(rejectMail = false) {
  const { db, sqlite } = sqliteD1([
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
  ]);
  const mail: string[] = [];
  const notify = {
    fetch: (request: Request) =>
      handleNotifyRequest(request, {
        adminEmails: "admin@example.test",
        fromAddress: "notifications@slop.cash",
        now: () => new Date(),
        randomId: () => crypto.randomUUID(),
        sendEmail: async (_from, _to, body) => {
          mail.push(body);
          if (rejectMail) throw new Error("mail outcome unknown");
        },
      }),
  };
  const add = (
    month: string,
    estimated: number,
    provider: number | null,
    outcome = "ok",
    failure: string | null = null,
  ) =>
    sqlite
      .prepare(`
    INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,
    input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at,provider_cost_micro_usd,failure)
    VALUES ('review',1,'triage',0,'surplus','model',?,0,0,0,0,'price',?,0,'estimated',?,?,?)
  `)
      .run(outcome, estimated, `${month}-01T00:00:00.000Z`, provider, failure);
  return { sqlite, db, mail, notify, add };
}

test("monthly cost ledger sends every crossed $500 milestone once, including failed calls and prior months", async () => {
  const h = harness();
  try {
    h.add("2026-09", 499_999_999, null);
    h.add("2026-09", 900_000_000, 0); // A real zero overrides the estimate.
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(0);
    h.add("2026-09", 0, 500_000_001, "failed");
    await Promise.all([
      dispatchSpendAlert(h.db, h.notify),
      dispatchSpendAlert(h.db, h.notify),
    ]);
    expect(h.mail).toHaveLength(1);
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(2);
    expect(h.mail[0]).toContain("crossed $500.00");
    expect(h.mail[1]).toContain("crossed $1000.00");
    expect(h.mail[0]).toContain("rather than provider-reported charges: 1");
    h.add("2026-10", 500_000_000, null);
    await dispatchSpendAlert(h.db, h.notify);
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(3);
    expect(h.mail[2]).toContain("2026-10 crossed $500.00");
    expect(
      h.sqlite
        .query(
          "SELECT count(*) AS n FROM slopbot_spend_alert_receipts WHERE outcome='accepted'",
        )
        .get(),
    ).toEqual({ n: 3 });
  } finally {
    h.sqlite.close();
  }
});

test("ambiguous mail is retained and not resent by the next scheduled invocation", async () => {
  const h = harness(true);
  try {
    h.add("2026-10", 500_000_000, null);
    await expect(dispatchSpendAlert(h.db, h.notify)).rejects.toThrow(
      "operator reconciliation",
    );
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(1);
    expect(
      h.sqlite.query("SELECT outcome FROM slopbot_spend_alert_receipts").get(),
    ).toEqual({ outcome: "ambiguous" });
  } finally {
    h.sqlite.close();
  }
});

test("alerts-only inference continues beyond $500 while notices and attempt identity remain enforced", async () => {
  const h = harness();
  try {
    h.add("2026-11", 1_000_000_000, null);
    const at = new Date("2026-11-02T00:00:00Z");
    const id = `value:${crypto.randomUUID()}`;
    expect(await reserveValueBudget(h.db, id, null, null, at)).toBe(true);
    expect(await reserveValueBudget(h.db, id, null, null, at)).toBe(false);
    expect(
      await reserveValueBudget(
        h.db,
        `value:${crypto.randomUUID()}`,
        1_000_000,
        500_000_000,
        at,
      ),
    ).toBe(false);
    expect(
      h.sqlite
        .query(
          "SELECT approved_limit_micro_usd,reserved_micro_usd FROM slopbot_value_budget_reservations",
        )
        .get(),
    ).toEqual({ approved_limit_micro_usd: null, reserved_micro_usd: null });
    await dispatchSpendAlert(h.db, h.notify);
    await dispatchSpendAlert(h.db, h.notify);
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(2);
    expect(h.mail[0]).toContain("$500.00");
    expect(h.mail[1]).toContain("$1000.00");
    expect(() =>
      h.sqlite.exec(
        "UPDATE slopbot_value_budget_reservations SET reserved_micro_usd=2",
      ),
    ).toThrow("immutable");
    expect(() =>
      h.sqlite.exec("DELETE FROM slopbot_value_budget_reservations"),
    ).toThrow("immutable");
  } finally {
    h.sqlite.close();
  }
});

test("alerts-only migration preserves earlier capped reservations and reconciliations", () => {
  const sqlite = new Database(":memory:");
  const migration = (file: string) =>
    sqlite.exec(
      readFileSync(
        new URL(`../../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  try {
    sqlite.exec("PRAGMA foreign_keys=ON");
    migration("0051_slopbot_value_budget.sql");
    sqlite.exec(
      "INSERT INTO slopbot_value_budget_reservations VALUES ('old','2026-10',100,500,'2026-10-01'); INSERT INTO slopbot_value_budget_reconciliations VALUES ('old',1,75,'2026-10-02')",
    );
    const before = sqlite
      .query("SELECT * FROM slopbot_value_budget_reservations")
      .all();
    const receipts = sqlite
      .query("SELECT * FROM slopbot_value_budget_reconciliations")
      .all();
    migration("0077_slopbot_alerts_only.sql");
    expect(
      sqlite.query("SELECT * FROM slopbot_value_budget_reservations").all(),
    ).toEqual(before);
    expect(
      sqlite.query("SELECT * FROM slopbot_value_budget_reconciliations").all(),
    ).toEqual(receipts);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() =>
      sqlite.exec("DELETE FROM slopbot_value_budget_reconciliations"),
    ).toThrow("immutable");
    expect(() =>
      sqlite.exec(
        "UPDATE slopbot_value_budget_reconciliations SET recorded_micro_usd=0",
      ),
    ).toThrow("immutable");
    expect(() =>
      sqlite.exec(
        "INSERT OR REPLACE INTO slopbot_value_budget_reservations VALUES ('old','2026-10',100,NULL,'2026-10-01')",
      ),
    ).toThrow("already exists");
  } finally {
    sqlite.close();
  }
});

// This qualifies cost accounting through the actual SDK and local HTTP, not
// model quality, a live provider receipt or a production notification.
test("alerts-only route retains unknown fallback costs without a reserve or duplicate call", async () => {
  const h = harness();
  let requests = 0;
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
          content: [
            {
              type: "text",
              text: requests === 1 ? "invalid JSON" : '{"accepted":true}',
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        },
        {
          headers:
            requests === 1 ? {} : { "x-si-buyer-cost-micro": "500000001" },
        },
      );
    },
  });
  const id = `value:${crypto.randomUUID()}`;
  const output = {
    sourceDigest: "a".repeat(64),
    name: "accounting_transport",
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
  };
  const budget = {
    db: h.db,
    installationId: 1,
    attemptId: id,
    maximumMicroUsd: null,
    approvedMonthlyMicroUsd: null,
  };
  const env = {
    SURPLUS_API_KEY: "local-only",
    SURPLUS_BASE_URL: `http://127.0.0.1:${server.port}`,
  };
  const prompt = {
    system: "Local accounting fixture",
    policy: "No publication",
    item: "No source material",
  };
  try {
    const result = await runValueInference(
      env,
      prompt,
      output,
      async () => true,
      budget,
    );
    expect(result.verdict).toEqual({ accepted: true });
    expect(requests).toBe(2);
    expect(
      h.sqlite
        .query(
          "SELECT reserved_micro_usd,approved_limit_micro_usd FROM slopbot_value_budget_reservations",
        )
        .get(),
    ).toEqual({ reserved_micro_usd: null, approved_limit_micro_usd: null });
    expect(
      h.sqlite
        .query(
          "SELECT provider_cost_micro_usd FROM slopbot_costs ORDER BY route_step",
        )
        .all(),
    ).toEqual([
      { provider_cost_micro_usd: null },
      { provider_cost_micro_usd: 500000001 },
    ]);
    expect(await reconcileValueBudget(h.db, id, 2)).toBe(false);
    expect(
      await reserveValueBudget(
        h.db,
        `value:${crypto.randomUUID()}`,
        1,
        1000000000,
        new Date("2026-12-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      await reserveValueBudget(
        h.db,
        `value:${crypto.randomUUID()}`,
        null,
        null,
      ),
    ).toBe(true);
    expect(await reserveValueBudget(h.db, id, null, null)).toBe(false);
    const repeated = await runValueInference(
      env,
      prompt,
      output,
      async () => true,
      { ...budget, attemptId: `value:${crypto.randomUUID()}` },
    );
    expect(repeated.verdict).toEqual(result.verdict);
    expect(requests).toBe(2);
    expect(
      h.sqlite
        .query("SELECT count(*) AS n FROM slopbot_value_inference_results")
        .get(),
    ).toEqual({ n: 1 });
    await dispatchSpendAlert(h.db, h.notify);
    await dispatchSpendAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]).toContain("$500.00");
    expect(h.mail[0]).toContain("rather than provider-reported charges: 1");
    await Promise.all([
      dispatchFailureAlert(h.db, h.notify),
      dispatchFailureAlert(h.db, h.notify),
    ]);
    await dispatchFailureAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(2);
    expect(h.mail[1]).toContain("Surplus request failed");
    expect(h.mail[1]).toContain("claude-opus-5.5");
    expect(h.mail[1]).toContain("Cause: schema-invalid verdict.");
    expect(h.mail[1]).not.toContain(prompt.item);
    expect(h.mail[1]).not.toContain("invalid JSON");
    expect(h.mail[1]).not.toContain("local-only");
    expect(
      h.sqlite
        .query("SELECT outcome FROM slopbot_provider_failure_receipts")
        .all(),
    ).toEqual([{ outcome: "accepted" }]);
  } finally {
    server.stop(true);
    h.sqlite.close();
  }
});

test("attempt migration preserves populated children; known alerts-only costs reconcile above old estimates", async () => {
  // Migrate existing capped and alerts-only rows in a transaction with active
  // foreign keys, including both kinds of retained child record.
  const { db, sqlite } = sqliteD1([
    "0013_slopbot.sql",
    "0039_slopbot_provider_cost.sql",
    "0051_slopbot_value_budget.sql",
    "0054_slopbot_value_inference_results.sql",
    "0077_slopbot_alerts_only.sql",
  ]);
  const migration = (file: string) =>
    sqlite.exec(
      readFileSync(
        new URL(`../../migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );
  sqlite.exec("PRAGMA foreign_keys=ON");
  const cap = `value:${crypto.randomUUID()}`;
  const alert = `value:${crypto.randomUUID()}`;
  const complete = `value:${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  for (const [id, limit] of [
    [cap, 1000],
    [alert, null],
    [complete, 1000],
  ] as const)
    sqlite
      .query("INSERT INTO slopbot_value_budget_reservations VALUES (?,?,?,?,?)")
      .run(id, at.slice(0, 7), 10, limit, at);
  sqlite
    .query("INSERT INTO slopbot_value_budget_reconciliations VALUES (?,1,5,?)")
    .run(complete, at);
  sqlite
    .query("INSERT INTO slopbot_value_inference_results VALUES (?,?,?,?,?)")
    .run("a".repeat(64), complete, '{"retained":true}', "b".repeat(64), at);
  const tables = [
    "slopbot_value_budget_reservations",
    "slopbot_value_budget_reconciliations",
    "slopbot_value_inference_results",
  ];
  const before = tables.map((table) =>
    sqlite.query(`SELECT * FROM ${table}`).all(),
  );
  try {
    sqlite.transaction(() =>
      migration("0084_slopbot_attempt_accounting.sql"),
    )();
    expect(
      tables.map((table) => sqlite.query(`SELECT * FROM ${table}`).all()),
    ).toEqual(before);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
    for (const table of tables)
      expect(() => sqlite.exec(`DELETE FROM ${table}`)).toThrow("immutable");
    // Old alerts-only estimates are not charge ceilings. Preserve their bytes,
    // but do not admit capped work until the unknown actual cost is reconciled.
    expect(
      await reserveValueBudget(db, `value:${crypto.randomUUID()}`, 1, 1000),
    ).toBe(false);
    for (const id of [cap, alert])
      sqlite
        .query(
          `INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at,provider_cost_micro_usd) VALUES (?,1,'triage',1,'surplus','local','ok',0,0,0,0,'local',50,0,'estimated',?,50)`,
        )
        .run(id, at);
    expect(await reconcileValueBudget(db, alert, 1)).toBe(true);
    expect(await reconcileValueBudget(db, cap, 1)).toBe(false);
    expect(await reconcileValueBudget(db, alert, 1)).toBe(false);
    // A new alerts-only record reconciles a real reported zero. Until that
    // receipt exists, switching to capped mode cannot lose its unknown charge.
    const unknown = `value:${crypto.randomUUID()}`;
    expect(await reserveValueBudget(db, unknown, null, null)).toBe(true);
    expect(
      await reserveValueBudget(db, `value:${crypto.randomUUID()}`, 1, 1000),
    ).toBe(false);
    sqlite
      .query(
        `INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at,provider_cost_micro_usd) VALUES (?,1,'triage',1,'surplus','local','failed',0,0,0,0,'local',50,0,'estimated',?,0)`,
      )
      .run(unknown, at);
    expect(await reconcileValueBudget(db, unknown, 1)).toBe(true);
    expect(
      await reserveValueBudget(db, `value:${crypto.randomUUID()}`, 1, 1000),
    ).toBe(true);
    expect(() =>
      sqlite
        .query(
          "INSERT INTO slopbot_value_budget_reservations VALUES (?,?,?,?,?)",
        )
        .run(`value:${crypto.randomUUID()}`, at.slice(0, 7), null, 1000, at),
    ).toThrow();
  } finally {
    sqlite.close();
  }
});

test("provider failure mail includes safe causes and retains ambiguous delivery without a blind resend", async () => {
  const h = harness();
  try {
    h.add("2026-11", 0, null, "failed", "provider returned HTTP 500");
    await Promise.all([
      dispatchFailureAlert(h.db, h.notify),
      dispatchFailureAlert(h.db, h.notify),
    ]);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]).toContain("Cause: provider returned HTTP 500.");
    const privateFailure = "provider body with a private prompt and credential";
    h.add("2026-11", 0, null, "failed", privateFailure);
    await dispatchFailureAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(2);
    expect(h.mail[1]).toContain("Cause: provider call failed.");
    expect(h.mail[1]).not.toContain(privateFailure);

    const legacyNotice = {
      callId: 1,
      model: "claude-opus-5.5",
      kind: "request-failed",
      occurredAt: "2026-11-01T00:00:00.000Z",
    };
    const send = (notice: unknown) =>
      h.notify.fetch(
        new Request("https://notify.internal/v1/slopbot-failure", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(notice),
        }),
      );
    expect((await send(legacyNotice)).status).toBe(202);
    expect(h.mail).toHaveLength(3);
    expect(h.mail[2]).toContain("Cause: provider call failed.");
    for (const unsafe of [
      { ...legacyNotice, failure: privateFailure },
      { ...legacyNotice, rawResponse: privateFailure },
    ])
      expect((await send(unsafe)).status).toBe(400);
    expect(h.mail).toHaveLength(3);

    h.add("2026-11", 0, null, "failed");
    await expect(
      dispatchFailureAlert(h.db, {
        async fetch(request) {
          await h.notify.fetch(request);
          throw new Error("mail outcome unknown");
        },
      }),
    ).rejects.toThrow("operator reconciliation");
    await dispatchFailureAlert(h.db, h.notify);
    expect(h.mail).toHaveLength(4);
    expect(
      h.sqlite
        .query(
          "SELECT outcome FROM slopbot_provider_failure_receipts ORDER BY call_id",
        )
        .all(),
    ).toEqual([
      { outcome: "accepted" },
      { outcome: "accepted" },
      { outcome: "ambiguous" },
    ]);
  } finally {
    h.sqlite.close();
  }
});
