// Migration 0017 rebuilds five tables to accept chain = 'robinhood'. The
// rebuild must keep every row, child reference, index, trigger and column
// position, because several writers insert by position.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const files = readdirSync("migrations")
  .filter((f) => f.endsWith(".sql"))
  .sort();
const before = files.filter((f) => f < "0017");
const target = files.find((f) => f.startsWith("0017_"));

function open() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const f of before) db.exec(readFileSync(`migrations/${f}`, "utf8"));
  return db;
}

const tables = [
  "wallet_claims",
  "payment_obligations",
  "payment_wallet_proposals",
  "payment_direct_transfers",
  "wallet_observations",
] as const;

// Every table holding a foreign key to wallet_claims or payment_obligations
// (migrations 0003, 0007, 0011, 0016). Each gets one seeded row.
const children = [
  "wallet_possession_challenges",
  "wallet_possession_attestations",
  "payment_wallet_challenges",
  "payment_wallet_authorizations",
  "payment_outbox",
  "payment_attempts",
  "payment_binding_authorizations",
] as const;

function columns(db: Database, table: string): string[] {
  return (
    db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((c) => c.name);
}
function count(db: Database, table: string): number {
  return (db.query(`SELECT count(*) AS n FROM ${table}`).get() as { n: number })
    .n;
}

function seed(db: Database) {
  const t = "2026-10-01T00:00:00.000Z";
  db.exec(`INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
    VALUES ('c1','1','one','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','d1_registry',NULL,NULL,'${"a".repeat(64)}','${t}','${"b".repeat(64)}',NULL,'${t}','solana'),
           ('c2','1','one','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','d1_registry',NULL,NULL,'${"c".repeat(64)}','${t}','${"d".repeat(64)}',NULL,'${t}','base'),
           ('c3','1','one','0x1111111111111111111111111111111111111111','d1_registry',NULL,NULL,'${"e".repeat(64)}','${t}','${"f".repeat(64)}','c2','${t}','base')`);
  // Children of wallet_claims, column lists from migrations 0007, 0011, 0016.
  db.exec(`INSERT INTO wallet_possession_challenges (challenge_id,claim_id,github_user_id,wallet_address,issued_at,expires_at,consumed_at,created_at)
    VALUES ('${"5".repeat(32)}','c1','1','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','${t}','${t}','${t}','${t}')`);
  db.exec(`INSERT INTO wallet_possession_attestations (id,claim_id,challenge_id,github_user_id,wallet_address,signature,message_sha256,attested_at,created_at)
    VALUES ('a1','c1','${"5".repeat(32)}','1','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','${"s".repeat(88)}','${"6".repeat(64)}','${t}','${t}')`);
  db.exec(
    `INSERT INTO payment_wallet_challenges (id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES ('ch1','c2','1','m','${t}',NULL)`,
  );
  db.exec(
    `INSERT INTO payment_wallet_authorizations (claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES ('c2','1','${t}','ch1','0xsig')`,
  );
  db.exec(`INSERT INTO payment_binding_authorizations (claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at)
    VALUES ('c3','1','base-sepolia','0x2222222222222222222222222222222222222222','84532','0','${t}','0xsig','${t}')`);
  db.exec(
    `INSERT INTO payment_obligations VALUES ('o1','p','1','base-sepolia','base','0x2222222222222222222222222222222222222222','100000000','2000000','${"9".repeat(64)}','reserved','${t}',NULL)`,
  );
  // Children of payment_obligations (payment_attempts also references wallet_claims).
  db.exec(
    `INSERT INTO payment_outbox (obligation_id,state,lease_token,lease_until,updated_at) VALUES ('o1','ready',NULL,NULL,'${t}')`,
  );
  db.exec(
    `INSERT INTO payment_attempts (id,obligation_id,claim_id,created_at,transaction_id,state) VALUES ('at1','o1','c3','${t}',NULL,'prepared')`,
  );
  db.exec(
    `INSERT INTO payment_wallet_proposals VALUES ('pr1','1','solana','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','op','r','${t}')`,
  );
  db.exec(
    `INSERT INTO payment_direct_transfers VALUES ('solana-mainnet','sig1','p','2026-08','1','MDQ6VXNlcjE=','one','solana','4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY','1000000','${t}','1','disclosures/x.json','${t}')`,
  );
  db.exec(
    `INSERT INTO wallet_observations VALUES ('1','MDQ6VXNlcjE=','one','base','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','profile_readme','https://x','${"0".repeat(40)}','${t}','p','${t}')`,
  );
}

describe("migration 0017", () => {
  test("keeps rows, children and column order; then accepts robinhood", () => {
    const db = open();
    seed(db);
    for (const c of children) expect(count(db, c)).toBe(1);
    const snapshot = Object.fromEntries(
      [...tables, ...children].map((t) => [
        t,
        {
          rows: db.query(`SELECT * FROM ${t} ORDER BY rowid`).all(),
          cols: columns(db, t),
        },
      ]),
    );
    // D1 rebuilds tables inside a transaction with foreign keys enabled.
    db.exec("BEGIN");
    db.exec(readFileSync(`migrations/${target}`, "utf8"));
    db.exec("COMMIT");
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      (db.query("PRAGMA foreign_keys").get() as { foreign_keys: number })
        .foreign_keys,
    ).toBe(1);
    for (const t of [...tables, ...children]) {
      expect(db.query(`SELECT * FROM ${t} ORDER BY rowid`).all()).toEqual(
        snapshot[t].rows,
      );
      expect(columns(db, t)).toEqual(snapshot[t].cols);
    }
    // Children still resolve to the rebuilt parents.
    for (const c of children) expect(count(db, c)).toBe(1);
    expect(
      db
        .query(
          "SELECT DISTINCT \"table\" AS t FROM pragma_foreign_key_list('payment_attempts') ORDER BY t",
        )
        .all(),
    ).toEqual([{ t: "payment_obligations" }, { t: "wallet_claims" }]);
    expect(() =>
      db.exec(
        "INSERT INTO payment_outbox (obligation_id,state,lease_token,lease_until,updated_at) VALUES ('missing','ready',NULL,NULL,'x')",
      ),
    ).toThrow(/FOREIGN KEY/);
    // Immutability triggers still fire.
    expect(() => db.exec("DELETE FROM wallet_claims WHERE id='c1'")).toThrow();
    expect(() =>
      db.exec("UPDATE payment_wallet_proposals SET reason='x'"),
    ).toThrow();
    // The new value is accepted everywhere; the old values still are.
    const t = "2026-10-13T00:00:00.000Z";
    db.exec(`INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
      VALUES ('c4','1','one','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','d1_registry',NULL,NULL,'${"1".repeat(64)}','${t}','${"2".repeat(64)}',NULL,'${t}','robinhood')`);
    db.exec(
      `INSERT INTO payment_obligations VALUES ('o2','q','1','robinhood-testnet','robinhood','0x3333333333333333333333333333333333333333','100000000','2000000','${"8".repeat(64)}','reserved','${t}',NULL)`,
    );
    db.exec(
      `INSERT INTO payment_wallet_proposals VALUES ('pr2','1','robinhood','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','op','r','${t}')`,
    );
    db.exec(
      `INSERT INTO payment_direct_transfers VALUES ('robinhood-mainnet','0xabc','q','2026-11','1','MDQ6VXNlcjE=','one','robinhood','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','1000000','${t}','1','disclosures/y.json','${t}')`,
    );
    db.exec(
      `INSERT INTO wallet_observations VALUES ('1','MDQ6VXNlcjE=','one','robinhood','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','profile_readme','https://y','${"0".repeat(40)}','${t}','q','${t}')`,
    );
    expect(() =>
      db.exec(
        `INSERT INTO payment_wallet_proposals VALUES ('pr3','1','ethereum','0x8f77c37d8650776bfe73c9b12b15209ee15d9b86','op','r','${t}')`,
      ),
    ).toThrow(/CHECK/);
    // A successor on the new chain keeps its lineage rule.
    expect(() =>
      db.exec(`INSERT INTO wallet_claims (id,github_user_id,github_login,wallet_address,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain)
        VALUES ('c5','1','one','0x4444444444444444444444444444444444444444','d1_registry',NULL,NULL,'${"3".repeat(64)}','${t}','${"4".repeat(64)}','c4','${t}','base')`),
    ).toThrow();
  });
});
