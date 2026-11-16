/** Historical upgrades retain actual call facts; new queues never invent old
 * send obligations. These use migrated SQLite, not a schema mock. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import {
  claimValueRequest,
  finishValueRequest,
} from "../../workers/slopbot/value-processing";

const at = "2026-11-01T00:00:00.000Z";
const sql = (name: string) =>
  readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

test("provider cost upgrades preserve old unknown evidence and do not enqueue historical failures", () => {
  const { sqlite } = sqliteD1(
    MIGRATIONS.filter((name) => name < "0039_slopbot_provider_cost.sql"),
  );
  const insert = `INSERT INTO slopbot_costs(review_key,installation_id,call_kind,route_step,provider,requested_model,served_model,outcome,failure,input_tokens,cache_write_tokens,cache_read_tokens,output_tokens,price_version,cost_micro_usd,billed_micro_usdc,reconciliation,created_at) VALUES ('review',1,'triage',1,'surplus','model',NULL,'failed','unavailable',4,0,0,0,'v1',17,19,'estimated',?)`;
  try {
    sqlite.run(insert, [at]);
    const original = sqlite
      .prepare("SELECT * FROM slopbot_costs WHERE id=1")
      .get() as Record<string, unknown>;
    for (const name of MIGRATIONS.filter(
      (name) =>
        name >= "0039_slopbot_provider_cost.sql" &&
        name <= "0085_slopbot_provider_failure_notices.sql",
    ))
      sqlite.exec(sql(name));
    const after = sqlite
      .prepare("SELECT * FROM slopbot_costs WHERE id=1")
      .get() as Record<string, unknown>;
    for (const [key, value] of Object.entries(original))
      expect(after[key]).toEqual(value);
    expect(after).toMatchObject({
      provider_cost_micro_usd: null,
      provider_request_id: null,
      billing_rule: "call-v1",
      billable_cost_micro_usd: 0,
    });
    expect(
      sqlite
        .query("SELECT count(*) AS n FROM slopbot_provider_failure_notices")
        .get(),
    ).toEqual({ n: 0 });
    expect(() =>
      sqlite.exec("UPDATE slopbot_costs SET input_tokens=0 WHERE id=1"),
    ).toThrow(/immutable/);
    expect(() =>
      sqlite.exec(
        "INSERT OR REPLACE INTO slopbot_costs SELECT * FROM slopbot_costs WHERE id=1",
      ),
    ).toThrow(/cannot be replaced/);
    sqlite.run(insert, [at]);
    expect(
      sqlite
        .query(
          "SELECT call_id,claimed_at FROM slopbot_provider_failure_notices",
        )
        .all(),
    ).toEqual([{ call_id: 2, claimed_at: null }]);
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test("incomplete-source upgrade backfills only known gaps and real retry preserves the marker", async () => {
  const migration = "0115_incomplete_value_inbox.sql";
  const { sqlite, db } = sqliteD1(
    MIGRATIONS.filter((name) => name < migration),
  );
  try {
    for (const [index, outcome] of [
      "source-incomplete",
      "retry",
      "attempts-exhausted",
    ].entries()) {
      const id = `gap-${index}`;
      sqlite.run(
        "INSERT INTO slopbot_deliveries(delivery_id,event,received_at) VALUES(?,'pull_request',?)",
        [id, at],
      );
      sqlite.run(
        "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES(?,1,2,'example','repo',?,?)",
        [id, index + 1, at],
      );
      sqlite.run(
        "INSERT INTO slopbot_value_processing(delivery_id,claim_token,lease_until,state,outcome,retry_at,updated_at,attempts) VALUES(?,? ,?,'waiting',?,?,?,1)",
        [id, `claim-${index}`, at, outcome, "2026-11-01T01:00:00.000Z", at],
      );
    }
    sqlite.exec(sql(migration));
    expect(
      sqlite
        .query(
          "SELECT delivery_id,incomplete_since FROM slopbot_value_processing ORDER BY delivery_id",
        )
        .all(),
    ).toEqual([
      { delivery_id: "gap-0", incomplete_since: at },
      { delivery_id: "gap-1", incomplete_since: null },
      { delivery_id: "gap-2", incomplete_since: null },
    ]);
    // Preserve the historical migration rows and backfill expectations above.
    // Only this new operational lease must clear SQLite's execution clock.
    const clock = sqlite
      .query("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS at")
      .get() as { at: string };
    const resumedAt = new Date(
      Math.max(Date.parse(clock.at), Date.parse(at)) + 2 * 3_600_000,
    );
    const claim = await claimValueRequest(db, "gap-0", resumedAt);
    if (!claim) throw new Error("Expected retry lease");
    expect(
      sqlite
        .query(
          "SELECT incomplete_since FROM slopbot_value_processing WHERE delivery_id='gap-0'",
        )
        .get(),
    ).toEqual({ incomplete_since: at });
    await finishValueRequest(
      db,
      claim,
      "current",
      null,
      new Date(resumedAt.getTime() + 60_000),
    );
    expect(
      sqlite
        .query(
          "SELECT incomplete_since,state FROM slopbot_value_processing WHERE delivery_id='gap-0'",
        )
        .get(),
    ).toEqual({ incomplete_since: null, state: "completed" });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});
