import type { WalletChain } from "../../src/lib/wallets";
import { sha256Hex } from "../../workers/identity/crypto";
import type { D1Database } from "../trace/cloudflare-persistence";
/** Canonical registry bytes preserve the original Solana layout and Base chain field. */
export async function registerPaymentWallet(
  db: D1Database,
  actor: { github_id: string; login: string },
  chain: WalletChain,
  address: string,
  now: string,
): Promise<{ claimId: string; conflict?: boolean }> {
  const current = await db
    .prepare(
      "SELECT id,wallet_address,github_login FROM wallet_claims w WHERE github_user_id=? AND chain=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
    )
    .bind(actor.github_id, chain)
    .first<{ id: string; wallet_address: string; github_login: string }>();
  if (
    current?.wallet_address === address &&
    current.github_login.toLowerCase() === actor.login.toLowerCase()
  )
    return { claimId: current.id };
  const predecessor = current?.id ?? null;
  const { sourceBodySha256, recordDigest } = await canonicalWalletClaimDigests({
    githubActorId: actor.github_id,
    githubLogin: actor.login,
    address,
    chain,
    observedAt: now,
    supersedesClaimId: predecessor,
  });
  const id = crypto.randomUUID();
  try {
    const results = await db.batch([
      db
        .prepare(
          "INSERT INTO wallet_claims(id,github_user_id,github_login,wallet_address,chain,source,issue_repository,issue_number,source_body_sha256,observed_at,record_sha256,supersedes_claim_id,created_at) VALUES(?,?,?,?,?,'d1_registry',NULL,NULL,?,?,?,?,?)",
        )
        .bind(
          id,
          actor.github_id,
          actor.login,
          address,
          chain,
          sourceBodySha256,
          now,
          recordDigest,
          predecessor,
          now,
        ),
      db
        .prepare(
          "INSERT INTO private_audit_events(id,actor_github_id,action,target,request_id,created_at,details_json) VALUES(?,?,'wallet_claim.created',?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          actor.github_id,
          `wallet-claim:${id}`,
          crypto.randomUUID(),
          now,
          JSON.stringify({ recordDigest, supersedesClaimId: predecessor }),
        ),
    ]);
    if (results.some((r) => !r.success || r.meta?.changes !== 1))
      throw new Error("Atomic wallet registration failed");
    return { claimId: id };
  } catch (error) {
    const tip = await db
      .prepare(
        "SELECT id,wallet_address FROM wallet_claims w WHERE github_user_id=? AND chain=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
      )
      .bind(actor.github_id, chain)
      .first<{ id: string; wallet_address: string }>();
    if (tip && tip.id !== predecessor)
      return tip.wallet_address === address
        ? { claimId: tip.id }
        : { claimId: tip.id, conflict: true };
    throw error;
  }
}

export async function canonicalWalletClaimDigests(input: {
  githubActorId: string;
  githubLogin: string;
  address: string;
  chain: WalletChain;
  observedAt: string;
  supersedesClaimId: string | null;
}) {
  const chainField = input.chain === "solana" ? {} : { chain: input.chain };
  const sourceBodySha256 = await sha256Hex(
    JSON.stringify({
      schemaVersion: 1,
      githubActorId: input.githubActorId,
      address: input.address,
      ...chainField,
      supersedesClaimId: input.supersedesClaimId,
    }),
  );
  const recordDigest = await sha256Hex(
    JSON.stringify({
      schemaVersion: 1,
      githubActorId: input.githubActorId,
      githubLogin: input.githubLogin,
      address: input.address,
      ...chainField,
      source: "d1_registry",
      issueRepository: null,
      issueNumber: null,
      sourceBodySha256,
      observedAt: input.observedAt,
      supersedesClaimId: input.supersedesClaimId,
    }),
  );
  return { sourceBodySha256, recordDigest };
}
