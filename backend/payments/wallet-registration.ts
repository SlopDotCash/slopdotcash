import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import type { GithubActor } from "../../src/lib/project-contracts";
import type { WalletChain } from "../../src/lib/wallets";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import { insertWalletClaim } from "../trace/cloudflare-persistence";
/** Canonical registry bytes preserve the original Solana layout and Base chain field. */
export async function registerPaymentWallet(
  db: D1Database,
  actor: GithubActor,
  chain: WalletChain,
  address: string,
  now: string,
): Promise<{ claimId: string; conflict?: boolean }> {
  const tip = () =>
    db
      .prepare(
        "SELECT id,wallet_address,github_login FROM wallet_claims w WHERE github_user_id=? AND chain=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
      )
      .bind(actor.githubId, chain)
      .first<{ id: string; wallet_address: string; github_login: string }>();
  const current = await tip();
  if (
    current?.wallet_address === address &&
    current.github_login.toLowerCase() === actor.githubLogin.toLowerCase()
  )
    return { claimId: current.id };
  const predecessor = current?.id ?? null;
  const { sourceBodySha256, recordDigest } = await canonicalWalletClaimDigests({
    githubActorId: actor.githubId,
    githubLogin: actor.githubLogin,
    address,
    chain,
    observedAt: now,
    supersedesClaimId: predecessor,
  });
  const id = crypto.randomUUID();
  const result = await insertWalletClaim(
    db,
    {
      id,
      githubId: actor.githubId,
      githubLogin: actor.githubLogin,
      walletAddress: address,
      chain,
      source: "d1_registry",
      issueRepository: null,
      issueNumber: null,
      sourceBodySha256,
      observedAt: now,
      recordSha256: recordDigest,
      supersedesClaimId: predecessor,
      createdAt: now,
    },
    {
      id: crypto.randomUUID(),
      actorGithubId: actor.githubId,
      action: "wallet_claim.created",
      target: `wallet-claim:${id}`,
      requestId: crypto.randomUUID(),
      createdAt: now,
      details: { recordDigest, supersedesClaimId: predecessor },
    },
  );
  if (result.status !== "conflict") return { claimId: result.value.id };
  // A concurrent registration replaced the same predecessor first.
  const winner = await tip();
  if (winner === null)
    throw new Error("A wallet registration conflict left no current claim");
  return winner.wallet_address === address
    ? { claimId: winner.id }
    : { claimId: winner.id, conflict: true };
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
