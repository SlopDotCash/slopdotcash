// spec/fees/buybackPool.md, "Half of all acquired SLOP is burned, and a failed burn retries the same share"
import { type Hex, decodeEventLog, erc20Abi } from "viem";
import type { TransferLog } from "../evm/abi.ts";

export interface Moved {
  readonly left: bigint;
  readonly burned: bigint;
}

const lower = (text: string) => text.toLowerCase();

/** @throws {never} */
export function burnTransfers(logs: readonly TransferLog[], token: string, wallet: string, dead: string): Moved {
  let left = 0n;
  let burned = 0n;
  for (const log of logs) {
    if (lower(log.address) !== lower(token)) continue;
    try {
      const { args } = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (lower(args.from) !== lower(wallet)) continue;
      left += args.value;
      if (lower(args.to) === lower(dead)) burned += args.value;
    } catch {
      continue;
    }
  }
  return { left, burned };
}
