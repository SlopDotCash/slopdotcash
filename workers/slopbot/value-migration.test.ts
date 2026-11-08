// PRD12: the terminal-state schema upgrade must preserve existing requests,
// uncertain leases, retry timing and recorded outcomes on a populated database.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
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
