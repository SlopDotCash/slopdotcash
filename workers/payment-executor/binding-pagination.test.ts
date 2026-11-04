import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { bindingCandidates } from "./core";

test("binding selection reaches recipients beyond the first 500 unpaid actors", async () => {
  const { db, sqlite } = sqliteD1([]);
  try {
    // Minimal relational fixture for the production selection query. No RPC or signing.
    sqlite.exec(`
      CREATE TABLE payment_obligations(id TEXT,network TEXT,vault TEXT,github_user_id TEXT,chain TEXT,state TEXT,created_at TEXT);
      CREATE TABLE effective_payment_wallet_claims(id TEXT,github_user_id TEXT,chain TEXT,record_sha256 TEXT,wallet_address TEXT,source TEXT);
      CREATE TABLE payment_wallet_authorizations(claim_id TEXT,github_user_id TEXT);
      CREATE TABLE payment_binding_authorizations(claim_id TEXT,github_user_id TEXT,network TEXT,vault TEXT,expires_at TEXT);
    `);
    for (let i = 1; i <= 501; i++) {
      const actor = String(i),
        claim = `claim-${i}`;
      sqlite
        .query("INSERT INTO payment_obligations VALUES(?,?,?,?,?,?,?)")
        .run(
          `award-${i}`,
          "base-mainnet",
          "vault",
          actor,
          "base",
          "reserved",
          "2026-11-04T00:00:00Z",
        );
      sqlite
        .query(
          "INSERT INTO effective_payment_wallet_claims VALUES(?,?,?,?,?,?)",
        )
        .run(claim, actor, "base", "digest", "destination", "d1_registry");
      sqlite
        .query("INSERT INTO payment_wallet_authorizations VALUES(?,?)")
        .run(claim, actor);
      sqlite
        .query("INSERT INTO payment_binding_authorizations VALUES(?,?,?,?,?)")
        .run(claim, actor, "base-mainnet", "vault", "2000000000");
    }
    const env = {
      PAYMENTS_DB: db,
      PAYMENT_DEPLOYMENTS: JSON.stringify([
        { network: "base-mainnet", vault: "vault" },
      ]),
    };
    const first = await bindingCandidates(
      env,
      new Date("2026-11-04T00:00:00Z"),
    );
    expect(new Set(first.map((row) => row.githubUserId)).size).toBe(501);
    const next = await bindingCandidates(env, new Date("2026-11-04T00:01:00Z"));
    expect(next).toEqual(first);
    expect(
      await bindingCandidates(env, new Date("2040-01-01T00:00:00Z")),
    ).toEqual([]);
  } finally {
    sqlite.close();
  }
});
