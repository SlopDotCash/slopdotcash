// spec/fees/buybackPool.md, "Half of all acquired SLOP is burned, and a failed burn retries the same share"
import { type TransferLog, tokenTransfers } from "../evm/abi.ts";

export interface Moved {
  readonly left: bigint;
  readonly burned: bigint;
}

const lower = (text: string) => text.toLowerCase();

/** @throws {never} */
export function burnTransfers(logs: readonly TransferLog[], token: string, wallet: string, dead: string): Moved {
  let left = 0n;
  let burned = 0n;
  for (const transfer of tokenTransfers(logs, token)) {
    if (lower(transfer.from) !== lower(wallet)) continue;
    left += transfer.value;
    if (lower(transfer.to) === lower(dead)) burned += transfer.value;
  }
  return { left, burned };
}
