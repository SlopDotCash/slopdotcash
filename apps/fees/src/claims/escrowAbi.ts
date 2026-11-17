// spec/fees/conversion.md, "A claim delivers the accrued amount to the configured fee wallet and shares the native budget"
import { type Address, decodeEventLog, encodeFunctionData, erc20Abi, type Hex, parseAbi } from "viem";

const escrowAbi = parseAbi([
  "event FeesClaimed(address indexed feeRecipient, uint128 amount)",
  "function identityAuthority() view returns (address)",
  "function pendingIdentityAuthority() view returns (address)",
  "function pendingUpgradeAuthority() view returns (address)",
]);

export type RoleGetter = "identityAuthority" | "pendingIdentityAuthority" | "pendingUpgradeAuthority";

export interface EscrowLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface FeesClaimedLog {
  readonly recipient: string;
  readonly amount: bigint;
}

export interface TransferLog {
  readonly from: string;
  readonly to: string;
  readonly value: bigint;
}

const lower = (value: string) => value.toLowerCase();

/** @throws {never} */
export function roleCalldata(getter: RoleGetter): Hex {
  return encodeFunctionData({ abi: escrowAbi, functionName: getter });
}

/** @throws {never} */
export function roleAddress(answer: Hex): string | undefined {
  return /^0x0{24}[0-9a-fA-F]{40}$/u.test(answer) ? `0x${answer.slice(26).toLowerCase()}` : undefined;
}

/** @throws {never} */
export function feesClaimedLogs(logs: readonly EscrowLog[], vault: string): readonly FeesClaimedLog[] {
  const found: FeesClaimedLog[] = [];
  for (const log of logs) {
    if (lower(log.address) !== lower(vault)) continue;
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      found.push({ recipient: lower(decoded.args.feeRecipient as Address), amount: decoded.args.amount });
    } catch {
      continue;
    }
  }
  return found;
}

/** @throws {never} */
export function transferLogs(logs: readonly EscrowLog[], asset: string): readonly TransferLog[] {
  const found: TransferLog[] = [];
  for (const log of logs) {
    if (lower(log.address) !== lower(asset)) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true });
      found.push({ from: lower(decoded.args.from), to: lower(decoded.args.to), value: decoded.args.value });
    } catch {
      continue;
    }
  }
  return found;
}
