// spec/settlement/money.md, "Ordinary fees round upward and private splits require exact division"; spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"
import { MAX_BASE_UNITS, MAX_SOLANA_BASE_UNITS } from "@repo/settlement/kernels/amounts";
import { type PayoutPolicy, payoutFee } from "./payout.ts";
import { vectors } from "./vectors.ts";

export const payoutFeesFollowTheirPolicyWithinTheNetworkRange = vectors<readonly [bigint, PayoutPolicy, bigint | undefined], bigint | undefined>([
  [[0n, "ordinary", undefined], undefined],
  [[1n, "ordinary", undefined], 1n],
  [[50n, "ordinary", undefined], 1n],
  [[51n, "ordinary", undefined], 2n],
  [[1_000_000n, "ordinary", undefined], 20_000n],
  [[MAX_BASE_UNITS, "ordinary", undefined], (MAX_BASE_UNITS + 49n) / 50n],
  [[MAX_BASE_UNITS + 1n, "ordinary", undefined], undefined],
  [[MAX_SOLANA_BASE_UNITS + 1n, "ordinary", MAX_SOLANA_BASE_UNITS], undefined],
  [[4n, "security-bounty", undefined], 1n],
  [[1_000_000n, "security-bounty", undefined], 250_000n],
  [[5n, "security-bounty", undefined], undefined],
], ([gross, policy, maximum]) => payoutFee({ gross, policy, ...(maximum === undefined ? {} : { maximum }) }));
