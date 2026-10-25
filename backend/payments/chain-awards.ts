/**
 * Which finalized chain obligation, if any, already holds a monthly award's
 * source. Funding, award states and the monthly attestation use one rule.
 */
import { acceptsPayoutFee } from "../../src/lib/payments/contracts";
import type { D1TransactionalDatabase as D1Database } from "../d1";

/** A finalized chain obligation recorded for a monthly award's source. */
export interface ChainAward {
  githubUserId: string;
  grossBase: string;
  feeBase: string;
  state: "reserved" | "paid";
}
/** Whether the chain obligation under a source is this monthly award: the same
 * actor and gross, with a genuine 2% fee. The source digest is public, so anyone
 * reserving another award under it must never make the frozen award look
 * reserved, paid or funded. */
export function holdsAward(
  chain: ChainAward | undefined,
  award: { githubUserId: string; grossBase: string },
): chain is ChainAward {
  return (
    chain !== undefined &&
    chain.githubUserId === award.githubUserId &&
    chain.grossBase === award.grossBase &&
    /^(0|[1-9][0-9]*)$/.test(chain.feeBase) &&
    acceptsPayoutFee(BigInt(chain.grossBase), BigInt(chain.feeBase))
  );
}
export async function chainAwards(
  db: D1Database,
  network: string,
  vault: string,
): Promise<Map<string, ChainAward>> {
  const row = await db
    .prepare(
      "SELECT json_group_array(json_object('sourceDigest',source_digest,'githubUserId',github_user_id,'grossBase',gross_base,'feeBase',fee_base,'state',state)) items FROM payment_obligations WHERE network=? AND vault=?",
    )
    .bind(network, vault)
    .first<{ items: string }>();
  return new Map(
    (
      JSON.parse(row?.items ?? "[]") as (ChainAward & {
        sourceDigest: string;
      })[]
    ).map(({ sourceDigest, ...award }) => [sourceDigest, award]),
  );
}
