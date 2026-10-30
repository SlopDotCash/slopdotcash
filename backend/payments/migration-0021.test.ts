// Migration 0021 converts payment obligations to base units of a named asset,
// accepts the ethereum chain, and adds the finalized vault snapshot cache.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const files = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const target = files.find((f) => f.startsWith("0021_")) as string;
const t = "2026-10-01T00:00:00.000Z";

// bun:sqlite exec() and run() can return without an error for a failed
// INSERT ... SELECT (sqlite3 -bail and D1 abort). Each statement is prepared
// and run on its own, so a failed statement fails the test.
function migrate(db: Database) {
  let statement = "";
  let trigger = false;
  for (const line of readFileSync(`migrations/${target}`, "utf8").split("\n")) {
    if (!statement && (line.startsWith("--") || !line.trim())) continue;
    statement += `${line}\n`;
    if (/^CREATE TRIGGER/.test(line)) trigger = true;
    if (trigger ? /END;\s*$/.test(line) : /;\s*$/.test(line)) {
      db.prepare(statement).run();
      statement = "";
      trigger = false;
    }
  }
  expect(statement.trim()).toBe("");
}
function open() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const f of files.filter((f) => f < "0021"))
    db.exec(readFileSync(`migrations/${f}`, "utf8"));
  return db;
}
function seed(db: Database) {
  db.exec(`INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
    VALUES ('c1','1','one','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','d1_registry',NULL,NULL,'${"c".repeat(64)}','${t}','${"d".repeat(64)}',NULL,'${t}','base')`);
  db.exec(
    `INSERT INTO payment_wallet_challenges (id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES ('ch1','c1','1','m','${t}',NULL)`,
  );
  db.exec(
    `INSERT INTO payment_wallet_authorizations (claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES ('c1','1','${t}','ch1','0xsig')`,
  );
  db.exec(
    `INSERT INTO payment_obligations VALUES ('o1','p','1','base-sepolia','base','0x2222222222222222222222222222222222222222','100000000','2000000','${"9".repeat(64)}','paid','${t}','0xabc')`,
  );
  db.exec(
    `INSERT INTO payment_obligations VALUES ('o2','q','1','solana-mainnet','solana','vault1111111111111111111111111111','7','0','${"8".repeat(64)}','reserved','${t}',NULL)`,
  );
  db.exec(
    `INSERT INTO payment_outbox (obligation_id,state,lease_token,lease_until,updated_at) VALUES ('o1','paid',NULL,NULL,'${t}')`,
  );
  db.exec(
    `INSERT INTO payment_attempts (id,obligation_id,claim_id,created_at,transaction_id,state) VALUES ('at1','o1','c1','${t}','0xabc','finalized')`,
  );
  db.exec(
    `INSERT INTO payment_wallet_proposals VALUES ('pr1','1','base','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','op','r','${t}')`,
  );
}
const snapshot = (overrides: Record<string, string | number | null> = {}) => {
  const row: Record<string, string | number | null> = {
    project_id: "p",
    network: "ethereum",
    chain: "ethereum",
    vault: "0x2222222222222222222222222222222222222222",
    asset_address: "0x6b175474e89094c44da98b954eedeac495271d0f",
    asset_decimals: 18,
    total_deposited: "340282366920938463463374607431768211455",
    total_paid: "0",
    total_payout_fees: "0",
    total_gross_withdrawn: "0",
    total_withdrawal_fees: "0",
    total_service_fees: "0",
    free_balance: null,
    reserved_principal: null,
    reserved_fees: null,
    accrued_fees: null,
    reserved: null,
    block_number: "100",
    block_time: t,
    observed_at: t,
    ...overrides,
  };
  return [
    `INSERT INTO vault_snapshots(${Object.keys(row).join(",")}) VALUES(${Object.keys(
      row,
    )
      .map(() => "?")
      .join(",")})`,
    Object.values(row),
  ] as const;
};

describe("migration 0021", () => {
  test("keeps rows and children, names the reviewed asset, and copies amounts as 6-decimal base units", () => {
    const db = open();
    seed(db);
    db.exec("BEGIN");
    migrate(db);
    db.exec("COMMIT");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db
        .query(
          "SELECT id,asset_address,asset_decimals,gross_base,fee_base,state,paid_transaction FROM payment_obligations ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "o1",
        asset_address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        asset_decimals: 6,
        gross_base: "100000000",
        fee_base: "2000000",
        state: "paid",
        paid_transaction: "0xabc",
      },
      {
        id: "o2",
        asset_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        asset_decimals: 6,
        gross_base: "7",
        fee_base: "0",
        state: "reserved",
        paid_transaction: null,
      },
    ]);
    for (const table of [
      "payment_outbox",
      "payment_attempts",
      "payment_wallet_authorizations",
      "payment_wallet_proposals",
    ])
      expect(
        (db.query(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n,
      ).toBe(1);
    expect(() =>
      db.exec("UPDATE payment_obligations SET asset_decimals=18 WHERE id='o2'"),
    ).toThrow();
    expect(() =>
      db.exec("UPDATE payment_obligations SET gross_base='8' WHERE id='o2'"),
    ).toThrow();
    // A project vault keeps one asset.
    expect(() =>
      db.exec(
        `INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES ('o3','q','1','solana-mainnet','solana','vault1111111111111111111111111111','So11111111111111111111111111111111111111112',9,'7','0','${"7".repeat(64)}','reserved','${t}')`,
      ),
    ).toThrow();
    // Ethereum is accepted on claims, obligations and proposals.
    db.exec(`INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
      VALUES ('c2','1','one','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','d1_registry',NULL,NULL,'${"1".repeat(64)}','${t}','${"2".repeat(64)}',NULL,'${t}','ethereum')`);
    db.exec(
      `INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES ('o4','e','1','ethereum','ethereum','0x3333333333333333333333333333333333333333','0x6b175474e89094c44da98b954eedeac495271d0f',18,'340282366920938463463374607431768211455','6805647338418769269267492148635364229','${"6".repeat(64)}','reserved','${t}')`,
    );
    db.exec(
      `INSERT INTO payment_wallet_proposals VALUES ('pr2','1','ethereum','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','op','r','${t}')`,
    );
    // Amounts are integer text, never decimals or signs.
    for (const gross of ["1.5", "-1", "01", ""])
      expect(() =>
        db.exec(
          `INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES ('bad','e','1','ethereum','ethereum','0x3333333333333333333333333333333333333333','0x6b175474e89094c44da98b954eedeac495271d0f',18,'${gross}','0','${"5".repeat(64)}','reserved','${t}')`,
        ),
      ).toThrow(/CHECK/);
  });

  test("a row on a network without a reviewed asset fails the migration", () => {
    const db = open();
    db.exec(
      `INSERT INTO payment_obligations VALUES ('o1','p','1','solana-testnet','solana','vault1111111111111111111111111111','100','2','${"9".repeat(64)}','reserved','${t}',NULL)`,
    );
    db.exec("BEGIN");
    expect(() => migrate(db)).toThrow(/NOT NULL/);
    db.exec("ROLLBACK");
    expect(
      db.query("SELECT gross_micro FROM payment_obligations").get(),
    ).toEqual({ gross_micro: "100" });
  });

  test("vault snapshots keep uint128 text, NULL counters, a fixed asset and a monotonic block", () => {
    const db = open();
    migrate(db);
    const [insert, values] = snapshot();
    db.query(insert).run(...(values as string[]));
    expect(
      db
        .query(
          "SELECT total_deposited,free_balance FROM vault_snapshots WHERE project_id='p'",
        )
        .get(),
    ).toEqual({
      total_deposited: "340282366920938463463374607431768211455",
      free_balance: null,
    });
    expect(() =>
      db.exec(
        "UPDATE vault_snapshots SET asset_address='0x036cbd53842c5426634e7929541ec2318f3dcf7e'",
      ),
    ).toThrow();
    expect(() =>
      db.exec("UPDATE vault_snapshots SET asset_decimals=6"),
    ).toThrow();
    expect(() =>
      db.exec("UPDATE vault_snapshots SET block_number='99'"),
    ).toThrow();
    db.exec("UPDATE vault_snapshots SET block_number='101'");
    const [bad, badValues] = snapshot({
      project_id: "x",
      total_paid: "1.0",
    });
    expect(() => db.query(bad).run(...(badValues as string[]))).toThrow(
      /CHECK/,
    );
  });
});
