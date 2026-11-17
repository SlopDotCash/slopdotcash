// spec/settlement/money.md, "Ordinary fees round upward and private splits require exact division"; spec/settlement/money.md, "Contract amounts stay inside the unsigned integer range of their network"
import { MAX_BASE_UNITS } from "@repo/settlement/kernels/amounts";
import { bountyFeeBase, ordinaryFeeBase, privateSplitPossible } from "@repo/settlement/kernels/fees";

export type PayoutPolicy = "ordinary" | "security-bounty";

/** @throws {never} */
export function payoutFee({ gross, policy, maximum = MAX_BASE_UNITS }: { gross: bigint; policy: PayoutPolicy; maximum?: bigint }): bigint | undefined {
  if (gross <= 0n || gross > maximum) return undefined;
  if (policy === "ordinary") return ordinaryFeeBase(gross);
  return privateSplitPossible(gross) ? bountyFeeBase(gross) : undefined;
}
