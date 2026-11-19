// spec/settlement/escrow.md, "Events apply once, in canonical block and event order"; spec/settlement/escrow.md, "A proven leaf reclassifies pool gross into one award without debiting free funds"; spec/contracts/evmEscrow.md, "The owner pledges an amount to each of up to twelve months, raising but never lowering an open pledge"; spec/contracts/evmEscrow.md, "Anyone expires a pledge whose period's window closed without admission"; spec/settlement/monthPledges.md, "A finalized read reports no pledge support, or each month's pledge and the vault's open total"
import { encodeFunctionData } from "viem";
import { privateSplitPossible } from "../../kernels/fees.ts";
import { isPeriod } from "../../kernels/calendar.ts";
import { type Bytes32, type Hex, U32_MAX, U64_MAX, U128_MAX, type VaultPurpose, answerWords, checked, escrowAbi, isZero, wordBool, wordUint } from "./abi.ts";
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

/** @throws {RangeError} */
function pledgePeriod(period: number): number {
  if (!isPeriod(period)) throw new RangeError("Invalid pledge period");
  return period;
}

/** @throws {RangeError} */
export function pledgeMonthsCalldata(fromPeriod: number, count: number, gross: bigint): Hex {
  const from = pledgePeriod(fromPeriod);
  if (!Number.isSafeInteger(count) || count < 1 || count > 12) throw new RangeError("A pledge covers 1 to 12 periods");
  return encodeFunctionData({ abi: escrowAbi, functionName: "pledgeMonths", args: [from, count, amount(gross)] });
}

/** @throws {RangeError} */
export function expirePledgeCalldata(period: number): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "expirePledge", args: [pledgePeriod(period)] });
}

export const CURRENT_PERIOD_CALL: Hex = encodeFunctionData({ abi: escrowAbi, functionName: "currentPeriod" });

export const OPEN_PLEDGED_GROSS_CALL: Hex = encodeFunctionData({ abi: escrowAbi, functionName: "openPledgedGross" });

/** @throws {RangeError} */
export function monthPledgeCall(period: number): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: "monthPledges", args: [pledgePeriod(period)] });
}

export interface ChainMonthPledge {
  readonly period: number;
  readonly amount: bigint;
  readonly open: boolean;
}

/** @throws {never} */
export function decodeCurrentPeriod(data: string): number | undefined {
  const [word] = answerWords(data, 1) ?? [];
  const value = word === undefined ? undefined : wordUint(word, U32_MAX);
  return value !== undefined && isPeriod(Number(value)) ? Number(value) : undefined;
}

/** @throws {never} */
export function decodeOpenPledgedGross(data: string): bigint | undefined {
  const [word] = answerWords(data, 1) ?? [];
  return word === undefined ? undefined : wordUint(word, U128_MAX);
}

/** @throws {RangeError} */
export function decodeMonthPledge(period: number, data: string): ChainMonthPledge {
  const [amountWord, openWord] = answerWords(data, 2) ?? [];
  const pledged = amountWord === undefined ? undefined : wordUint(amountWord, U128_MAX);
  const open = openWord === undefined ? undefined : wordBool(openWord);
  if (pledged === undefined || open === undefined) throw new RangeError("Malformed month pledge");
  return { period, amount: pledged, open };
}
