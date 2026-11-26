// spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { keccak256 } from "viem";

export const STANDING_DEPOSIT_SLOP_DECIMALS = 18;

/** @throws {never} */
export function standingDepositItem(githubId: string, round: number): string {
  try {
    const tag = new TextEncoder().encode("slop-standing-v1");
    const packed = new Uint8Array(tag.length + 16);
    packed.set(tag, 0);
    const view = new DataView(packed.buffer);
    view.setBigUint64(tag.length, BigInt(githubId), false);
    view.setBigUint64(tag.length + 8, BigInt(round), false);
    return keccak256(packed).toLowerCase();
  } catch {
    return "";
  }
}

/** @throws {never} */
export function formatSlopAmount(amount: string, decimals = STANDING_DEPOSIT_SLOP_DECIMALS): string {
  try {
    return `${formatBaseUnits({ value: BigInt(amount), decimals })} SLOP`;
  } catch {
    return `${amount} SLOP`;
  }
}

/** @throws {never} */
export function formatTokenUnits(amount: string, decimals: number): string {
  try {
    return formatBaseUnits({ value: BigInt(amount), decimals });
  } catch {
    return amount;
  }
}
