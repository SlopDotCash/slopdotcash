// PRD12: the terminal-state schema upgrade must preserve existing requests,
// uncertain leases, retry timing and recorded outcomes on a populated database.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { admitValueAttempt } from "./value-budget";
import { claimValueRequest } from "./value-processing";

test("value terminal-state upgrade preserves populated processing rows and expired lease recovery", async () => {
  const upgrade = "0105_slopbot_value_terminal_states.sql";
  const boundary = MIGRATIONS.indexOf(upgrade);
  expect(boundary).toBeGreaterThan(0);
  const { db, sqlite } = sqliteD1(MIGRATIONS.slice(0, boundary));
  try {
    const outcomes = [
      "published",
      "current",
      "open",
      "historical",
      "source-incomplete",
      "authority",
      "budget",
      "retry",
    ];
    for (const [index, outcome] of outcomes.entries()) {
      const id = `prior-${index}`;
      const complete = index < 4;
      const state =
        index === 7 ? "running" : complete ? "completed" : "waiting";
      sqlite
        .query(
          "INSERT INTO slopbot_deliveries(delivery_id,event,received_at) VALUES(?,'pull_request','2026-11-01T00:00:00.000Z')",
        )
        .run(id);
      sqlite
        .query(
          "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES(?,1,2,'example','state',?,'2026-11-01T00:00:00.000Z')",
        )
        .run(id, index + 1);
      sqlite
        .query(
          "INSERT INTO slopbot_value_processing(delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,attempts) VALUES(?,?,'2026-11-01T00:10:00.000Z',?,?,?,'2026-11-01T00:00:00.000Z',2)",
        )
        .run(
          id,
          `claim-${index}`,
          state,
          outcome,
          complete ? null : "2026-11-01T01:00:00.000Z",
        );
    }
    const before = sqlite
      .query("SELECT * FROM slopbot_value_processing ORDER BY delivery_id")
      .all();
    sqlite.exec(readFileSync(`migrations/${upgrade}`, "utf8"));
    expect(
      sqlite
        .query("SELECT * FROM slopbot_value_processing ORDER BY delivery_id")
        .all(),
    ).toEqual(before);
    const recovered = await claimValueRequest(
      db,
      "prior-7",
      new Date("2026-11-01T02:00:00.000Z"),
    );
    expect(recovered).not.toBeNull();
    expect(recovered?.token).not.toBe("claim-7");
    for (const id of ["prior-0", "prior-1", "prior-2", "prior-3"])
      expect(
        await claimValueRequest(db, id, new Date("2026-11-01T02:00:00.000Z")),
      ).toBeNull();
  } finally {
    sqlite.close();
  }
});

test("completion upgrade preserves history without inventing finished attempts", async () => {
  const upgrade = "0120_slopbot_value_attempt_completion.sql";
  const boundary = MIGRATIONS.indexOf(upgrade);
  expect(boundary).toBeGreaterThan(0);
  const { db, sqlite } = sqliteD1(MIGRATIONS.slice(0, boundary));
  const key = "a".repeat(64);
  const ids = Array.from({ length: 3 }, () => `value:${crypto.randomUUID()}`);
  const at = "2026-11-01T00:00:00.000Z";
  try {
    for (const id of ids) {
      sqlite
        .query(
          "INSERT INTO slopbot_value_inference_attempts(attempt_id,inference_key,started_at) VALUES(?,?,?)",
        )
        .run(id, key, at);
      sqlite
        .query(
          "INSERT INTO slopbot_value_budget_reservations(attempt_id,month,reserved_micro_usd,approved_limit_micro_usd,reserved_at) VALUES(?,'2026-11',NULL,NULL,?)",
        )
        .run(id, at);
      sqlite
        .query(`INSERT INTO slopbot_costs
          (review_key,installation_id,call_kind,route_step,provider,requested_model,outcome,failure,
          input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,
          billed_micro_usdc,reconciliation,created_at,provider_cost_micro_usd)
          VALUES(?,1,'triage',1,'surplus','historical-model','failed','schema-invalid verdict',
          0,0,0,0,'historical-price',0,0,'estimated',?,NULL)`)
        .run(id, at);
    }
    // A retained row is preserved as a fact, not inferred to finish every
    // historical attempt. Its body is opaque to this migration-only test.
    sqlite
      .query(
        "INSERT INTO slopbot_value_inference_results(inference_key,attempt_id,result_json,result_digest,recorded_at) VALUES(?,?,'{}',?,?)",
      )
      .run(key, ids[0], "b".repeat(64), at);
    const tables = [
      "slopbot_value_inference_attempts",
      "slopbot_value_budget_reservations",
      "slopbot_costs",
      "slopbot_value_inference_results",
    ];
    const before = tables.map((table) =>
      sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    );
    sqlite.exec(readFileSync(`migrations/${upgrade}`, "utf8"));
    expect(
      tables.map((table) =>
        sqlite.query(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ),
    ).toEqual(before);
    expect(
      sqlite
        .query("SELECT COUNT(*) n FROM slopbot_value_attempt_completions")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      await admitValueAttempt(db, key, `value:${crypto.randomUUID()}`, 3),
    ).toBe("attempts-pending");
    sqlite
      .query("INSERT INTO slopbot_value_attempt_completions VALUES(?,?)")
      .run(ids[0], at);
    for (const statement of [
      "UPDATE slopbot_value_attempt_completions SET completed_at='changed'",
      "DELETE FROM slopbot_value_attempt_completions",
    ])
      expect(() => sqlite.exec(statement)).toThrow("immutable");
    expect(() =>
      sqlite
        .query(
          "INSERT OR REPLACE INTO slopbot_value_attempt_completions VALUES(?,?)",
        )
        .run(ids[0], at),
    ).toThrow("already exists");
    expect(
      sqlite.query("SELECT * FROM slopbot_value_attempt_completions").all(),
    ).toEqual([{ attempt_id: ids[0], completed_at: at }]);
  } finally {
    sqlite.close();
  }
});

test("zero-call upgrade preserves reconciliation history and immutable amounts", () => {
  const upgrade = "0118_slopbot_zero_call_reconciliation.sql";
  const boundary = MIGRATIONS.indexOf(upgrade);
  expect(boundary).toBeGreaterThan(0);
  const { sqlite } = sqliteD1(MIGRATIONS.slice(0, boundary));
  const paid = `value:${crypto.randomUUID()}`;
  const zero = `value:${crypto.randomUUID()}`;
  const at = "2026-11-01T00:00:00.000Z";
  try {
    for (const id of [paid, zero])
      sqlite
        .query(
          "INSERT INTO slopbot_value_budget_reservations VALUES(?,'2026-11',600,1000,?)",
        )
        .run(id, at);
    sqlite
      .query(
        "INSERT INTO slopbot_value_budget_reconciliations VALUES(?,1,100,?)",
      )
      .run(paid, at);
    const before = sqlite
      .query("SELECT * FROM slopbot_value_budget_reconciliations")
      .all();
    sqlite.exec(readFileSync(`migrations/${upgrade}`, "utf8"));
    expect(
      sqlite.query("SELECT * FROM slopbot_value_budget_reconciliations").all(),
    ).toEqual(before);
    expect(() =>
      sqlite
        .query(
          "INSERT INTO slopbot_value_budget_reconciliations VALUES(?,0,1,?)",
        )
        .run(zero, at),
    ).toThrow();
    sqlite
      .query("INSERT INTO slopbot_value_budget_reconciliations VALUES(?,0,0,?)")
      .run(zero, at);
    expect(() =>
      sqlite.exec(
        "UPDATE slopbot_value_budget_reconciliations SET recorded_micro_usd=1",
      ),
    ).toThrow("immutable");
    expect(() =>
      sqlite.exec("DELETE FROM slopbot_value_budget_reconciliations"),
    ).toThrow("immutable");
    expect(() =>
      sqlite
        .query(
          "INSERT OR REPLACE INTO slopbot_value_budget_reconciliations VALUES(?,0,0,?)",
        )
        .run(zero, at),
    ).toThrow("already exists");
  } finally {
    sqlite.close();
  }
});
