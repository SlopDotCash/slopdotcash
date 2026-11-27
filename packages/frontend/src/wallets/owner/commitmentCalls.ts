// spec/settlement/ownerTransactions.md, "A request is reviewed against current authority and becomes a fixed plan"; spec/settlement/monthlySettings.md, "The default starts on, and each change appends the next sequence"
import { awardCall, awardId, type Bytes32, bytes32, decodeAward, decodeUint, decodeBool, escrowGetter, evmAddress, U128_MAX } from "@repo/settlement/chain/evm/abi";
import { commitAwardCalldata, setMonthlyCommitmentCalldata } from "@repo/settlement/chain/evm/actions";
import { NETWORKS, defaultAsset, isNetworkKey } from "@repo/settlement/kernels/networks";
import type { MonthlySetting } from "./ownerDecisions.ts";

export type { MonthlySetting };

export interface DeploymentUpgrade {
  readonly vaultImplementation: string;
  readonly vaultImplementationCodeSha256: string;
}

export interface Deployment {
  readonly network: string;
  readonly vault: string;
  readonly owner: string;
  readonly asset: string;
  readonly codeSha256?: string | undefined;
  readonly factory?: string | undefined;
  readonly feeRecipient?: string | undefined;
  readonly bindingDelaySeconds?: string | undefined;
  readonly evmUpgrade?: DeploymentUpgrade | undefined;
}

export interface CommitmentCall {
  readonly id: Bytes32;
  readonly data: string;
  readonly awardRead: string;
}

export interface ProjectReward {
  readonly kind: string;
  readonly chain: string;
  readonly monthlyCapMinor: string;
  readonly cycleCaps?: ReadonlyArray<{ readonly cycleId: string; readonly monthlyCapMinor: string }>;
  readonly asset: { readonly network: string; readonly address: string; readonly decimals: number } | null;
}

export type MonthlyCap = { readonly kind: "cap"; readonly cap: bigint } | { readonly kind: "refused"; readonly message: string };

export const monthlyCapMessages = {
  noAmount: "This project has no monthly amount.",
  asset: "Vault token mismatch. Update the reward asset.",
  decimals: "Token decimals mismatch. Update the reward asset.",
  invalid: "The project's monthly amount is invalid.",
} as const;

export const MONTHLY_CAP_CALL = escrowGetter("monthlyCap");
export const MONTHLY_ENABLED_CALL = escrowGetter("monthlyEnabled");

/** @throws {never} */
export function deploymentOf(value: unknown): Deployment | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { network, vault, owner, asset } = value as Record<string, unknown>;
  return typeof network === "string" && typeof vault === "string" && typeof owner === "string" && typeof asset === "string" ? { network, vault, owner, asset } : undefined;
}

/** @throws {RangeError} */
export function commitmentCall(chainId: bigint, vault: string, sourceDigest: string, githubUserId: string, gross: bigint): CommitmentCall {
  const source = bytes32(`0x${sourceDigest}`);
  const target = evmAddress(vault);
  if (source === undefined || target === undefined || !/^[1-9][0-9]{0,19}$/u.test(githubUserId)) throw new RangeError("Invalid award input");
  const id = awardId(chainId, target, source);
  return { id, data: commitAwardCalldata({ purpose: "OrdinaryPurpose", id, actor: BigInt(githubUserId), gross, sourceDigest: source }), awardRead: awardCall(id) };
}

/** @throws {never} */
export function awardCommitted(answer: string): boolean | undefined {
  const award = decodeAward(answer);
  return award === undefined ? undefined : award.actor !== 0n;
}

/** @throws {never} */
export function settingOf(cap: string, enabled: string): MonthlySetting | undefined {
  const value = decodeUint(cap, U128_MAX);
  const on = decodeBool(enabled);
  return value === undefined || on === undefined ? undefined : { cap: value, enabled: on };
}

/** @throws {RangeError} */
export function settingCall(target: MonthlySetting): string {
  return setMonthlyCommitmentCalldata(target.cap, target.enabled);
}

const MONTHLY_CUTOFF_DELAY_MS = 72 * 60 * 60 * 1000;
const cycleIdPattern = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const canonicalUintPattern = /^(0|[1-9][0-9]*)$/u;

function pinWindowClosesAt(cycleId: string): number | undefined {
  const match = cycleIdPattern.exec(cycleId);
  if (match === null) return undefined;
  return Date.UTC(Number(match[1]), Number(match[2]), 1) + MONTHLY_CUTOFF_DELAY_MS;
}

/** @throws {never} */
export function vaultMonthlyCap(
  reward: ProjectReward,
  deployment: { readonly network: string; readonly asset: string },
  vaultDecimals: number,
  nowMs: number = Date.now(),
): MonthlyCap {
  if (reward.kind !== "monthly-pool") return { kind: "refused", message: monthlyCapMessages.noAmount };
  const network = isNetworkKey(deployment.network) ? NETWORKS[deployment.network] : undefined;
  if (network === undefined) return { kind: "refused", message: monthlyCapMessages.asset };
  const reference = defaultAsset(network);
  const expected = reward.asset?.address ?? reference?.address;
  const canonical = (text: string) => (network.family === "evm" ? text.toLowerCase() : text);
  if (network.chain !== reward.chain || (reward.asset !== null && reward.asset.network !== network.chain) || expected === undefined || canonical(deployment.asset) !== canonical(expected))
    return { kind: "refused", message: monthlyCapMessages.asset };
  if (vaultDecimals !== (reward.asset?.decimals ?? reference?.decimals)) return { kind: "refused", message: monthlyCapMessages.decimals };
  if (!canonicalUintPattern.test(reward.monthlyCapMinor)) return { kind: "refused", message: monthlyCapMessages.invalid };
  let cap = BigInt(reward.monthlyCapMinor);
  for (const entry of reward.cycleCaps ?? []) {
    const closesAt = pinWindowClosesAt(entry.cycleId);
    if (closesAt === undefined) return { kind: "refused", message: monthlyCapMessages.invalid };
    if (nowMs >= closesAt) continue;
    if (!canonicalUintPattern.test(entry.monthlyCapMinor)) return { kind: "refused", message: monthlyCapMessages.invalid };
    const pinned = BigInt(entry.monthlyCapMinor);
    if (pinned > cap) cap = pinned;
  }
  return { kind: "cap", cap };
}

/** @throws {never} */
export function baseUnits(text: string, positive: boolean): bigint | undefined {
  return (positive ? /^[1-9][0-9]{0,77}$/u : /^(0|[1-9][0-9]{0,77})$/u).test(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function evmChainIdOf(chainId: number): bigint {
  return BigInt(chainId);
}
