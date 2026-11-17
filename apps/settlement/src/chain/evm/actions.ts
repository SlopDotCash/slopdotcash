// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/escrow.md, "A proven leaf reclassifies pool gross into one award without debiting free funds"
import { encodeFunctionData } from "viem";
import { privateSplitPossible } from "../../kernels/fees.ts";
import { type Bytes32, type Hex, U64_MAX, U128_MAX, type VaultPurpose, checked, escrowAbi, isZero } from "./abi.ts";
import { monthlyCommitmentChecked } from "./factories.ts";

/** @throws {RangeError} */
function amount(gross: bigint): bigint {
  if (gross === 0n) throw new RangeError("Amount must be 1 to uint128 max base units");
  return checked(gross, U128_MAX, "Amount must be 1 to uint128 max base units");
}

/** @throws {RangeError} */
export function depositCalldata(gross: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "deposit", args: [amount(gross)] });
}

/** @throws {RangeError} */
export function withdrawCalldata(gross: bigint): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "withdrawUnused", args: [amount(gross)] });
}

/** @throws {never} */
export function claimFeesCalldata(): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "claimFees" });
}

/** @throws {RangeError} */
export function setMonthlyCommitmentCalldata(cap: bigint, enabled: boolean): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "setMonthlyCommitment", args: [monthlyCommitmentChecked(cap, enabled), enabled] });
}

export interface AwardCommitment {
  readonly purpose: VaultPurpose;
  readonly id: Bytes32;
  readonly actor: bigint;
  readonly gross: bigint;
  readonly sourceDigest: Bytes32;
}

/** @throws {RangeError} */
export function commitAwardCalldata(award: AwardCommitment): Hex {
  if (award.actor === 0n || isZero(award.id) || isZero(award.sourceDigest)) throw new RangeError("Invalid award input");
  const actor = checked(award.actor, U64_MAX, "Invalid uint64 input");
  const gross = amount(award.gross);
  if (award.purpose === "BountyPurpose" && !privateSplitPossible(gross)) throw new RangeError("Bounty split must be exact");
  return encodeFunctionData({ abi: escrowAbi, functionName: award.purpose === "BountyPurpose" ? "commitBountyAward" : "commitAward", args: [award.id, actor, gross, award.sourceDigest] });
}

/** @throws {RangeError} */
export function payCalldata(id: Bytes32, expectedBindingVersion: bigint): Hex {
  if (expectedBindingVersion === 0n) throw new RangeError("Payment needs an active binding");
  return encodeFunctionData({ abi: escrowAbi, functionName: "pay", args: [id, checked(expectedBindingVersion, U64_MAX, "Invalid uint64 input")] });
}
