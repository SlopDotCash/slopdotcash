// spec/operations/escrowQualification.md, "Each new attempt passes current checks, fits the remaining budget, and binds the exact scoped operation"
import type { Abi } from "@repo/platform/chain/evm";

const input = (name: string, type: string) => ({ name, type });
const indexed = (name: string, type: string) => ({ name, type, indexed: true });
const unindexed = (name: string, type: string) => ({ name, type, indexed: false });

export const tokenAbi = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [input("spender", "address"), input("amount", "uint256")], outputs: [input("", "bool")] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [input("owner", "address")], outputs: [input("", "uint256")] },
  { type: "event", name: "Transfer", inputs: [indexed("from", "address"), indexed("to", "address"), unindexed("value", "uint256")] },
  { type: "event", name: "Approval", inputs: [indexed("owner", "address"), indexed("spender", "address"), unindexed("value", "uint256")] },
] as const satisfies Abi;

export const vaultAbi = [
  { type: "function", name: "token", stateMutability: "view", inputs: [], outputs: [input("", "address")] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [input("", "address")] },
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [input("", "address")] },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [input("amount", "uint128")], outputs: [] },
  { type: "function", name: "commitAward", stateMutability: "nonpayable", inputs: [input("id", "bytes32"), input("actorId", "uint64"), input("gross", "uint128"), input("sourceDigest", "bytes32")], outputs: [] },
  { type: "function", name: "awardId", stateMutability: "view", inputs: [input("sourceDigest", "bytes32")], outputs: [input("", "bytes32")] },
  { type: "function", name: "payableBinding", stateMutability: "view", inputs: [input("actorId", "uint64")], outputs: [input("destination", "address"), input("version", "uint64")] },
  { type: "function", name: "pay", stateMutability: "nonpayable", inputs: [input("id", "bytes32"), input("expectedBindingVersion", "uint64")], outputs: [] },
  { type: "event", name: "Deposited", inputs: [indexed("depositor", "address"), unindexed("amount", "uint128")] },
  { type: "event", name: "AwardCommitted", inputs: [indexed("id", "bytes32"), indexed("actorId", "uint64"), unindexed("gross", "uint128"), unindexed("fee", "uint128"), unindexed("sourceDigest", "bytes32")] },
  { type: "event", name: "Paid", inputs: [indexed("id", "bytes32"), indexed("actorId", "uint64"), indexed("destination", "address"), unindexed("version", "uint64"), unindexed("gross", "uint128"), unindexed("net", "uint128"), unindexed("fee", "uint128")] },
  { type: "event", name: "UnusedWithdrawn", inputs: [indexed("destination", "address"), unindexed("gross", "uint128"), unindexed("net", "uint128"), unindexed("fee", "uint128")] },
  { type: "event", name: "FeesClaimed", inputs: [indexed("feeRecipient", "address"), unindexed("amount", "uint128")] },
] as const satisfies Abi;

export const factoryAbi = [
  { type: "function", name: "upgradeAuthority", stateMutability: "view", inputs: [], outputs: [input("", "address")] },
] as const satisfies Abi;

export const implementationSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

/** @throws {never} */
export function units(value: number): bigint {
  return Number.isSafeInteger(value) ? BigInt(value) : -1n;
}

/** @throws {never} */
export function wordValue(hex: string): bigint {
  return /^0x[0-9a-f]{1,64}$/u.test(hex) ? BigInt(hex) : -1n;
}

/** @throws {never} */
export function chainIdOf(identity: string): bigint {
  return /^[1-9][0-9]{0,18}$/u.test(identity) ? BigInt(identity) : 0n;
}
