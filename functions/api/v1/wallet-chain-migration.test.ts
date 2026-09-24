import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("upgrades existing claims and enforces independent immutable chain lineages", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const migrations = readdirSync("migrations")
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrations.filter((name) => name < "0010"))
      db.exec(readFileSync(`migrations/${name}`, "utf8"));
    db.prepare(
      `INSERT INTO wallet_claims (id, github_user_id, github_login, wallet_address, source, source_body_sha256, observed_at, record_sha256, created_at) VALUES ('legacy', '42', 'octocat', 'legacy-address', 'd1_registry', ?, '2026-09-01T00:00:00.000Z', ?, '2026-09-01T00:00:00.000Z')`,
    ).run("a".repeat(64), "b".repeat(64));
    const before = db
      .prepare("SELECT * FROM wallet_claims WHERE id = 'legacy'")
      .get();
    for (const name of migrations.filter((name) => name >= "0010"))
      db.exec(readFileSync(`migrations/${name}`, "utf8"));
    expect(
      db.prepare("SELECT * FROM wallet_claims WHERE id = 'legacy'").get(),
    ).toEqual({ ...before, chain: "solana" });
    let sequence = 0;
    const insert = (
      id: string,
      chain: string,
      predecessor: string | null,
      actor = "42",
    ) =>
      db
        .prepare(
          `INSERT INTO wallet_claims (id, github_user_id, github_login, wallet_address, chain, source, source_body_sha256, observed_at, record_sha256, supersedes_claim_id, created_at) VALUES (?, ?, 'octocat', 'fixture-address', ?, 'd1_registry', ?, '2026-09-24T00:00:00.000Z', ?, ?, '2026-09-24T00:00:00.000Z')`,
        )
        .run(
          id,
          actor,
          chain,
          "c".repeat(64),
          (++sequence).toString(16).padStart(64, "0"),
          predecessor,
        );
    insert("base-root", "base", null);
    insert("base-next", "base", "base-root");
    insert("solana-next", "solana", "legacy");
    expect(() => insert("duplicate-root", "base", null)).toThrow();
    expect(() => insert("cross-chain", "base", "solana-next")).toThrow(
      /lineage/u,
    );
    expect(() => insert("cross-actor", "base", "base-next", "43")).toThrow(
      /lineage/u,
    );
    expect(() => insert("missing-parent", "base", "missing")).toThrow(
      /lineage/u,
    );
    expect(() => insert("fork", "base", "base-root")).toThrow();
    expect(() => insert("unknown", "ethereum", null, "44")).toThrow();
    expect(() =>
      db.exec(
        "UPDATE wallet_claims SET wallet_address = 'changed' WHERE id = 'base-next'",
      ),
    ).toThrow(/immutable/u);
    expect(() =>
      db.exec("DELETE FROM wallet_claims WHERE id = 'base-next'"),
    ).toThrow(/permanent/u);
  } finally {
    db.close();
  }
});
