/** Verified wallet rows for disposable local D1 in the bounty browser flows. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

export type BountyWalletActor = {
  githubId: string;
  githubLogin: string;
  address: string;
};

/**
 * Seed verified wallet claims, consumed challenges and authorizations for
 * disposable local D1. Each chain fixture supplies its own actor check.
 */
export function seedVerifiedWalletRows(
  persistTo: string,
  actors: BountyWalletActor[],
  options: {
    chain: "base" | "solana";
    idPrefix: string;
    valid: (actor: BountyWalletActor) => boolean;
    invalidMessage: string;
  },
) {
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const statements: string[] = [];
  for (const actor of actors) {
    if (!options.valid(actor)) throw new Error(options.invalidMessage);
    const id = `${options.idPrefix}${actor.githubId}`,
      challenge = `${id}-challenge`,
      at = new Date().toISOString();
    statements.push(
      `INSERT OR IGNORE INTO wallet_claims(id,github_user_id,github_login,wallet_address,source,source_body_sha256,observed_at,record_sha256,created_at,chain) VALUES(${[id, actor.githubId, actor.githubLogin, actor.address, "d1_registry", hash(id), at, hash(`${id}:${actor.address}`), at, options.chain].map(quote).join(",")});`,
    );
    statements.push(
      `INSERT OR IGNORE INTO payment_wallet_challenges(id,claim_id,github_user_id,message,expires_at,consumed_at) VALUES(${[challenge, id, actor.githubId, "disposable browser fixture", new Date(Date.now() + 86_400_000).toISOString(), at].map(quote).join(",")});`,
    );
    statements.push(
      `INSERT OR IGNORE INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) VALUES(${[id, actor.githubId, at, challenge, "disposable verified wallet fixture"].map(quote).join(",")});`,
    );
  }
  execFileSync(
    "node",
    [
      "node_modules/wrangler/bin/wrangler.js",
      "d1",
      "execute",
      "slop-private",
      "--local",
      "--persist-to",
      persistTo,
      "--command",
      statements.join("\n"),
    ],
    { stdio: "pipe", maxBuffer: 4 * 1024 * 1024 },
  );
}
