// spec/frontend/feePages.md, "A pay page offers a way to pay only from a record that equals the published terms"; spec/frontend/feePages.md, "A deposit is received at canonical inclusion and finished only at finality, and a deposit from the tab blocks another for an hour"
import { type FeeNetwork, burnAddress, feeNetworks, feeWallet, validStableFee } from "@repo/backend/client";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { decodeAbiParameters, encodeFunctionData, parseAbi, toEventSelector } from "viem";
import type { WalletReceipt } from "../owner/evmEvidence.ts";

export type WayKind = "stable" | "slop";

export interface FeeWay {
  readonly network: string;
  readonly chainId: number;
  readonly contract: string;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly amount: string;
  readonly minimumAccepted: string;
  readonly keptTo: string;
  readonly kind: WayKind;
}

export interface SolanaFeeTerms {
  readonly network: string;
  readonly programId: string | null;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly keptTo: string;
  readonly switchedOn: boolean;
}

export interface SolanaFeeWay {
  readonly network: string;
  readonly programId: string;
  readonly token: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly amount: string;
  readonly minimumAccepted: string;
  readonly keptTo: string;
  readonly kind: "stable";
}

export interface FeeTerms {
  readonly networks: ReadonlyArray<FeeNetwork>;
  readonly feeWallet: string;
  readonly burn: string;
  readonly solana?: SolanaFeeTerms;
}

export type DepositStep = "approve" | "reset" | "send";
export type SavedStep = DepositStep | "batch";

export interface SavedDeposit {
  readonly wallet: string;
  readonly way: FeeWay;
  readonly step: SavedStep;
  readonly transaction: string;
}

export interface Call {
  readonly to: string;
  readonly data: string;
  readonly value: string;
}

export const publishedSolanaTerms: SolanaFeeTerms = {
  network: "solana-mainnet",
  programId: "4St4KPBhaHZw29gEaqstU9TzYHRfXLq7aat932r1uzW7",
  token: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  symbol: "USDC",
  decimals: 6,
  keptTo: "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
  switchedOn: true,
};

export const publishedTerms: FeeTerms = { networks: feeNetworks, feeWallet, burn: burnAddress, solana: publishedSolanaTerms };

const tokenAbi = parseAbi(["function approve(address,uint256) returns (bool)"]);
const depositsAbi = parseAbi([
  "function deposit(bytes32 item, address token, uint128 amount, address keptTo) returns (uint256 id)",
  "function depositsPaused() view returns (bool)",
]);
const depositedTopic = toEventSelector("Deposited(uint256,bytes32,address,address,uint128,address)");
const addressPattern = /^0x[0-9a-fA-F]{40}$/u;
const solanaAddressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
const solanaSignaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
const solanaSignatureOrAddressPattern = /^(?:[1-9A-HJ-NP-Za-km-z]{32,44}|[1-9A-HJ-NP-Za-km-z]{64,88})$/u;
const amountPattern = /^[1-9][0-9]{0,38}$/u;
const steps: ReadonlyArray<SavedStep> = ["approve", "reset", "send", "batch"];
const uint128Max = (1n << 128n) - 1n;

/** @throws {never} */
export function isSolanaFeeNetwork(network: string): boolean {
  return network.startsWith("solana-");
}

/** @throws {never} */
export function isSolanaRecordAddress(value: string): boolean {
  return solanaAddressPattern.test(value);
}

/** @throws {never} */
export function isSolanaSignature(value: string): boolean {
  return solanaSignaturePattern.test(value);
}

/** @throws {never} */
export function isSolanaTransactionOrAddress(value: string): boolean {
  return solanaSignatureOrAddressPattern.test(value);
}

/** @throws {never} */
function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** @throws {never} */
export function feeDepositKey(item: string): string {
  return `slop:fee-deposit:v1:${item.toLowerCase()}`;
}

/** @throws {never} */
export function depositedKey(item: string): string {
  return `${feeDepositKey(item)}:deposited`;
}

/** @throws {never} */
export function wayKey(way: Pick<FeeWay, "network" | "token">): string {
  return `${way.network}:${way.token.toLowerCase()}`;
}

/** @throws {never} */
export function amountText(amount: Pick<FeeWay, "amount" | "decimals" | "symbol">): string {
  return `${formatBaseUnits({ value: BigInt(amount.amount), decimals: amount.decimals })} ${amount.symbol}`;
}

/** @throws {never} */
export function keptToText(kind: WayKind): string {
  return kind === "slop" ? "the burn address" : "Slop's fee wallet";
}

/** @throws {never} */
export function termsOf(terms: FeeTerms, network: string): FeeNetwork | undefined {
  return terms.networks.find((entry) => entry.network === network);
}

/** @throws {never} */
export function tokenOf(terms: FeeTerms, network: string, token: string): { readonly kind: WayKind; readonly symbol: string; readonly decimals: number } | undefined {
  if (isSolanaFeeNetwork(network)) {
    const solana = terms.solana;
    if (solana === undefined || solana.network !== network || !solanaAddressPattern.test(token) || solana.token !== token) return undefined;
    return { kind: "stable", symbol: solana.symbol, decimals: solana.decimals };
  }
  if (!addressPattern.test(token)) return undefined;
  const found = termsOf(terms, network)?.tokens.find((entry) => same(entry.address, token));
  if (found === undefined || found.kind === "NoToken") return undefined;
  return { kind: found.kind === "SlopToken" ? "slop" : "stable", symbol: found.symbol, decimals: found.decimals };
}

/** @throws {never} */
export function publishedSolanaWay(terms: FeeTerms, stableMinor: string): SolanaFeeWay | null {
  const solana = terms.solana;
  if (
    solana === undefined
    || !solana.switchedOn
    || solana.programId === null
    || !solanaAddressPattern.test(solana.programId)
    || !solanaAddressPattern.test(solana.token)
    || !solanaAddressPattern.test(solana.keptTo)
    || !validStableFee(stableMinor)
  ) return null;
  return {
    network: solana.network,
    programId: solana.programId,
    token: solana.token,
    symbol: solana.symbol,
    decimals: solana.decimals,
    amount: stableMinor,
    minimumAccepted: stableMinor,
    keptTo: solana.keptTo,
    kind: "stable",
  };
}

/** @throws {never} */
export function checkSolanaWay(terms: FeeTerms, entry: unknown, stableMinor: string): SolanaFeeWay | null | "invalid" {
  const rec = recordOf(entry);
  if (rec === undefined) return "invalid";
  const published = publishedSolanaWay(terms, stableMinor);
  if (published === null) return null;
  const matches =
    rec.network === published.network
    && rec.contract === published.programId
    && (rec.chainId === null || rec.chainId === undefined)
    && rec.token === published.token
    && rec.keptTo === published.keptTo
    && rec.symbol === published.symbol
    && rec.decimals === published.decimals
    && rec.amount === stableMinor
    && rec.minimumAccepted === stableMinor;
  return matches ? published : "invalid";
}

/** @throws {never} */
export function keptToOf(terms: FeeTerms, kind: WayKind): string {
  return kind === "slop" ? terms.burn : terms.feeWallet;
}

/** @throws {never} */
export function publishedWay(terms: FeeTerms, entry: Omit<FeeWay, "kind">): FeeWay | undefined {
  const network = termsOf(terms, entry.network);
  const token = tokenOf(terms, entry.network, entry.token);
  if (network === undefined || token === undefined) return undefined;
  const keptTo = keptToOf(terms, token.kind);
  const published = same(entry.contract, network.contract) && entry.chainId === network.chainId && same(entry.keptTo, keptTo)
    && entry.symbol === token.symbol && entry.decimals === token.decimals && amountPattern.test(entry.amount) && amountPattern.test(entry.minimumAccepted);
  return published ? { network: network.network, chainId: network.chainId, contract: network.contract, token: entry.token, symbol: token.symbol, decimals: token.decimals, amount: entry.amount, minimumAccepted: entry.minimumAccepted, keptTo, kind: token.kind } : undefined;
}

/** @throws {never} */
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** @throws {never} */
export function savedDepositOf(plan: string, terms: FeeTerms): SavedDeposit | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plan);
  } catch {
    return undefined;
  }
  const saved = recordOf(parsed);
  const way = recordOf(saved?.way);
  if (saved === undefined || way === undefined || typeof saved.wallet !== "string" || !addressPattern.test(saved.wallet) || !steps.includes(saved.step as SavedStep) || typeof saved.transaction !== "string") return undefined;
  const { network, chainId, contract, token, symbol, decimals, amount, minimumAccepted, keptTo } = way;
  if (typeof network !== "string" || typeof chainId !== "number" || typeof contract !== "string" || typeof token !== "string" || typeof symbol !== "string" || typeof decimals !== "number"
    || typeof amount !== "string" || typeof minimumAccepted !== "string" || typeof keptTo !== "string") return undefined;
  const checked = publishedWay(terms, { network, chainId, contract, token, symbol, decimals, amount, minimumAccepted, keptTo });
  if (checked === undefined || BigInt(checked.amount) > uint128Max || BigInt(checked.minimumAccepted) > BigInt(checked.amount)) return undefined;
  if (checked.kind === "stable" && (!validStableFee(checked.amount) || checked.minimumAccepted !== checked.amount)) return undefined;
  return { wallet: saved.wallet.toLowerCase(), way: checked, step: saved.step as SavedStep, transaction: saved.transaction };
}

/** @throws {never} */
export function planText(saved: SavedDeposit): string {
  return JSON.stringify(saved);
}

/** @throws {never} */
export function approveCall(way: FeeWay, value: bigint): Call {
  return { to: way.token, data: encodeFunctionData({ abi: tokenAbi, functionName: "approve", args: [way.contract as `0x${string}`, value] }), value: "0x0" };
}

/** @throws {never} */
export function depositCall(way: FeeWay, item: string): Call {
  return {
    to: way.contract,
    data: encodeFunctionData({ abi: depositsAbi, functionName: "deposit", args: [item as `0x${string}`, way.token as `0x${string}`, BigInt(way.amount), way.keptTo as `0x${string}`] }),
    value: "0x0",
  };
}

/** @throws {never} */
export function pausedData(): string {
  return encodeFunctionData({ abi: depositsAbi, functionName: "depositsPaused" });
}

/** @throws {never} */
export function stepCall(way: FeeWay, item: string, step: DepositStep): Call {
  return step === "send" ? depositCall(way, item) : approveCall(way, step === "reset" ? 0n : BigInt(way.amount));
}

/** @throws {never} */
export function batchCalls(way: FeeWay, item: string, resetAllowance: boolean): ReadonlyArray<Call> {
  return [...(resetAllowance ? [approveCall(way, 0n)] : []), approveCall(way, BigInt(way.amount)), depositCall(way, item)];
}

/** @throws {never} */
function addressWord(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** @throws {never} */
export function depositEvents(way: FeeWay, item: string, payer: string, receipt: WalletReceipt): ReadonlyArray<WalletReceipt["logs"][number]> {
  return receipt.logs.filter((log) => same(log.address, way.contract) && same(log.topics[0] ?? "", depositedTopic) && same(log.topics[2] ?? "", item) && same(log.topics[3] ?? "", addressWord(payer)));
}

/** @throws {never} */
export function reviewedDeposit(way: FeeWay, events: ReadonlyArray<WalletReceipt["logs"][number]>): boolean {
  const [event] = events;
  if (events.length !== 1 || event === undefined) return false;
  try {
    const [token, amount, keptTo] = decodeAbiParameters([{ type: "address" }, { type: "uint128" }, { type: "address" }], event.data);
    return same(token, way.token) && amount === BigInt(way.amount) && same(keptTo, way.keptTo);
  } catch {
    return false;
  }
}

export interface Deposited {
  readonly hash: string;
  readonly network: string;
  readonly at: number;
}

export interface MarkerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** @throws {never} */
export function depositedOf(storage: MarkerStorage | undefined, item: string): Deposited | undefined {
  try {
    const value = recordOf(JSON.parse(storage?.getItem(depositedKey(item)) ?? "null"));
    return value !== undefined && typeof value.hash === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value.hash) && typeof value.network === "string" && typeof value.at === "number" && Number.isSafeInteger(value.at)
      ? { hash: value.hash, network: value.network, at: value.at }
      : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function keepDeposited(storage: MarkerStorage | undefined, item: string, deposited: Deposited): void {
  try {
    storage?.setItem(depositedKey(item), JSON.stringify(deposited));
  } catch {
    return;
  }
}
