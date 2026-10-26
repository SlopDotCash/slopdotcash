import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { PostNetwork } from "./config";

/** Include every block once while respecting the supported RPC range limit. */
export async function scanReferralLogs<T>(
  network: PostNetwork,
  first: bigint,
  last: bigint,
  read: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>,
): Promise<T[]> {
  const configured = ESCROW_NETWORKS[network].scanPageBlocks;
  if (!configured || !/^[1-9][0-9]*$/u.test(configured))
    throw new Error("Referral event scan range is not configured");
  const size = BigInt(configured);
  const results: T[] = [];
  for (let from = first; from <= last; from += size) {
    const end = from + size - 1n;
    results.push(...(await read(from, end < last ? end : last)));
  }
  return results;
}
