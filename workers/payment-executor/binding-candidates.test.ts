// The scheduled binding run rotates by least recently checked across the
// candidate list, so the list must contain every eligible contributor. A cap
// on the oldest awards would starve newer contributors on a busy vault.
import { expect, test } from "bun:test";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import { MIGRATIONS, sqliteD1 } from "../../tests/sqlite-d1";
import { bindingCandidates } from "./core";

const vault = `0x${"1".repeat(40)}`;
const at = "2026-10-01T00:00:00.000Z";
const now = new Date("2026-11-01T00:00:00.000Z");
const expires = String(Math.floor(now.getTime() / 1000) + 30 * 24 * 3600);

test("binding candidates include every eligible contributor beyond one page", async () => {
  const { db, sqlite } = sqliteD1(MIGRATIONS);
  try {
    const actors = ["101", "102", "103", "104", "105"];
    for (const [index, actor] of actors.entries()) {
      const claim = `claim-${actor}`;
      const digest = String(index + 1).repeat(64);
      sqlite
        .query(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at,chain) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          claim,
          actor,
          `actor-${actor}`,
          `0x${String(index + 2).repeat(40)}`,
          "d1_registry",
          digest,
          at,
          digest,
          null,
          at,
          "base",
        );
      sqlite
        .query(
          "INSERT INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(?,?,?,?,?,?)",
        )
        .run(`challenge-${actor}`, claim, actor, "fixture", at, at);
      sqlite
        .query(
          "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(?,?,?,?,?)",
        )
        .run(claim, actor, at, `challenge-${actor}`, "0x00");
      sqlite
        .query(
          "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES(?,?,'base-sepolia',?,'84532','0',?,'0x00',?)",
        )
        .run(claim, actor, vault, expires, at);
      // Two reserved awards per actor: one candidate per actor, anchored to
      // the oldest award id.
      for (const award of [0, 1])
        sqlite
          .query(
            "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at) VALUES(?,'project-1',?,'base-sepolia','base',?,?,6,'100','2',?,'reserved',?)",
          )
          .run(
            `0x${actor}${award}`,
            actor,
            vault,
            `0x${"a".repeat(40)}`,
            `${actor}${award}`.padEnd(64, "0"),
            `2026-10-0${index + 1}T00:00:0${award}.000Z`,
          );
    }
    const env = {
      PAYMENTS_DB: db as unknown as D1Database,
      PAYMENT_DEPLOYMENTS: JSON.stringify([{ network: "base-sepolia", vault }]),
    };
    const all = await bindingCandidates(env, now, 2);
    expect(all.map((candidate) => candidate.githubUserId)).toEqual(actors);
    expect(all[0]).toEqual({
      obligationId: "0x1010",
      network: "base-sepolia",
      vault,
      githubUserId: "101",
      claimId: "claim-101",
      claimDigest: "1".repeat(64),
      destination: `0x${"2".repeat(40)}`,
    });
    // An exact multiple of the page size ends after an empty page.
    expect(await bindingCandidates(env, now, 5)).toEqual(all);
    expect(await bindingCandidates(env, now, 1)).toEqual(all);
  } finally {
    sqlite.close();
  }
});
