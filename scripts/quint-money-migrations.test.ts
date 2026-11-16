/** Populated upgrades preserve unresolved sends and immutable finalized outcomes. */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MIGRATIONS, sqliteD1 } from "../tests/sqlite-d1";

test("fee schema upgrades retain populated history and unresolved signed bytes", () => {
  const boundary = "0076_fee_conversion_pending.sql";
  const { sqlite } = sqliteD1(MIGRATIONS.filter((name) => name < boundary));
  try {
    const at = "2026-10-01T00:00:00.000Z";
    const states = [
      "quoted",
      "skipped",
      "no_route",
      "unknown",
      "submitted",
      "finalized",
      "failed",
    ];
    for (const [index, state] of states.entries()) {
      const sent = ["unknown", "submitted", "finalized"].includes(state);
      sqlite
        .query(`INSERT INTO fee_conversions
        (id,run_id,network,mode,fee_wallet,token,target_token,amount_in,route,quote_amount_out,min_amount_out,
         quote_value_micro,price_impact_bps,quote,tx_id,raw_tx,evm_nonce,expires_at,amount_out,
         token_balance_before,target_balance_before,target_balance_after,state,reason,created_at,updated_at,submitted_at,finalized_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(
          `history_${state}`,
          "run_history",
          "base",
          "live",
          `0x${"1".repeat(40)}`,
          `0x${(index + 2).toString().repeat(40)}`,
          `0x${"f".repeat(40)}`,
          "1000000",
          "kyberswap",
          "2000000",
          "1900000",
          2000000,
          5,
          "{}",
          sent ? `0x${(index + 2).toString().repeat(64)}` : null,
          sent ? "0x010203" : null,
          sent ? index : null,
          sent ? 1999999999 : null,
          state === "finalized" ? "2000000" : null,
          "1000000",
          "0",
          state === "finalized" ? "2000000" : null,
          state,
          ["skipped", "no_route", "failed"].includes(state)
            ? "retained outcome"
            : null,
          at,
          at,
          sent ? at : null,
          state === "finalized" ? at : null,
        );
    }
    const columns = (
      sqlite.query("PRAGMA table_info(fee_conversions)").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    const selected = columns.join(",");
    const before = sqlite
      .query(`SELECT ${selected} FROM fee_conversions ORDER BY id`)
      .all();
    for (const migration of MIGRATIONS.filter((name) => name >= boundary)) {
      sqlite.exec(readFileSync(`migrations/${migration}`, "utf8"));
      if (
        [
          "0076_fee_conversion_pending.sql",
          "0078_fee_conversion_transaction_size.sql",
          "0082_fee_claim_journal.sql",
          "0087_fee_send_replacements.sql",
          "0088_fee_approval_journal.sql",
        ].includes(migration)
      ) {
        expect(
          sqlite
            .query(`SELECT ${selected} FROM fee_conversions ORDER BY id`)
            .all(),
        ).toEqual(before);
        expect(() =>
          sqlite
            .query(
              "UPDATE fee_conversions SET amount_in='9' WHERE id='history_finalized'",
            )
            .run(),
        ).toThrow();
        expect(() =>
          sqlite
            .query("DELETE FROM fee_conversions WHERE id='history_unknown'")
            .run(),
        ).toThrow();
      }
    }
    expect(
      sqlite
        .query("SELECT kind FROM fee_conversions WHERE id='history_unknown'")
        .get(),
    ).toEqual({ kind: "conversion" });
    expect(() =>
      sqlite
        .query(
          "UPDATE fee_conversions SET raw_tx='0xchanged' WHERE id='history_unknown'",
        )
        .run(),
    ).toThrow();
    expect(
      sqlite
        .query(
          "SELECT raw_tx,tx_id,state FROM fee_conversions WHERE id='history_unknown'",
        )
        .get(),
    ).toEqual({
      raw_tx: "0x010203",
      tx_id: `0x${"5".repeat(64)}`,
      state: "unknown",
    });
    expect(sqlite.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});
