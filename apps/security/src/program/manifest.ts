// spec/security/program.md, "A program revision needs current owner authority and exact split rules"; spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/program.md, "Receipt terms come only from the open published revision"; spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"
import type { Network } from "@repo/ports/backend";
import type { Offer, ProgramStatus } from "../../gen/security__program.ts";
import type { AwardSplit, Eligibility, FundingPolicy } from "../../gen/security__terms.ts";
import { limbsOf } from "../terms/asset.ts";
import { type ExclusionScope, SECURITY_EXCLUSION_LIMITS, exclusionLengths } from "./exclusions.ts";
import type { OwnerChange } from "./kernel.ts";

export type Json = string | number | boolean | null | ReadonlyArray<Json> | { readonly [key: string]: Json };
type Fields = Readonly<Record<string, unknown>>;

export const SECURITY_SPLIT = Object.freeze({ researcherBasisPoints: 7500, slopBasisPoints: 2500 });
export const SECURITY_FULL_AWARD_SPLIT = Object.freeze({ researcherBasisPoints: 10000, slopBasisPoints: 0 });
export const platformProject = "slopdotcash";

export type Chain = "base" | "ethereum" | "robinhood" | "solana";

interface ChainAssets {
  readonly family: "evm" | "solana";
  readonly chainId: string | null;
  readonly cluster: string | null;
  readonly native: AssetIdentity;
  readonly stablecoin: AssetIdentity;
  readonly maxBaseUnits: bigint;
  readonly network: Network;
}

export interface AssetIdentity {
  readonly chain: Chain;
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}

const maxEvmBaseUnits = (1n << 128n) - 1n;
const maxSolanaBaseUnits = (1n << 64n) - 1n;
const evmNative = "0x0000000000000000000000000000000000000000";
const solanaNative = "11111111111111111111111111111111";

const chains: Readonly<Record<Chain, ChainAssets>> = {
  base: { family: "evm", chainId: "8453", cluster: null, network: "Base", maxBaseUnits: maxEvmBaseUnits, native: { chain: "base", address: evmNative, symbol: "ETH", decimals: 18 }, stablecoin: { chain: "base", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6 } },
  ethereum: { family: "evm", chainId: "1", cluster: null, network: "Ethereum", maxBaseUnits: maxEvmBaseUnits, native: { chain: "ethereum", address: evmNative, symbol: "ETH", decimals: 18 }, stablecoin: { chain: "ethereum", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6 } },
  robinhood: { family: "evm", chainId: "4663", cluster: null, network: "Robinhood", maxBaseUnits: maxEvmBaseUnits, native: { chain: "robinhood", address: evmNative, symbol: "ETH", decimals: 18 }, stablecoin: { chain: "robinhood", address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6 } },
  solana: { family: "solana", chainId: null, cluster: "mainnet-beta", network: "Solana", maxBaseUnits: maxSolanaBaseUnits, native: { chain: "solana", address: solanaNative, symbol: "SOL", decimals: 9 }, stablecoin: { chain: "solana", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", decimals: 6 } },
};

const escrowNetworks: Readonly<Record<string, { readonly chain: Chain; readonly usdc: string | null }>> = {
  "base-sepolia": { chain: "base", usdc: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  "base-mainnet": { chain: "base", usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
  "solana-devnet": { chain: "solana", usdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  "solana-testnet": { chain: "solana", usdc: null },
  "solana-mainnet": { chain: "solana", usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  "robinhood-testnet": { chain: "robinhood", usdc: null },
  "robinhood-mainnet": { chain: "robinhood", usdc: null },
  "ethereum-sepolia": { chain: "ethereum", usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238" },
  ethereum: { chain: "ethereum", usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
};

const statuses: Readonly<Record<string, ProgramStatus>> = { draft: "Unpublished", "pending-approval": "PendingApproval", open: "Open", paused: "Paused", closed: "Closed" };
const rewardModes = ["bounty-only", "separate"];
const eligibilities = ["critical-loss-of-funds", "in-scope-security"];
const keys = ["amount", "approvers", "capacity", "disclosure", "dispute", "eligibility", "funding", "intake", "responseTargets", "rewardMode", "safeHarbor", "scope", "split", "sponsor", "status", "version"];
const legacyCurrencies: Readonly<Record<string, { readonly decimals: number; readonly networks: ReadonlyArray<string | null> }>> = {
  USD: { decimals: 2, networks: [null] },
  USDC: { decimals: 6, networks: ["base", "solana", "robinhood", "ethereum"] },
};
const maxLegacyGrossMinor = 1_000_000_000_000_000n;
const githubIdPattern = /^[1-9]\d{0,19}$/u;
const githubLoginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const symbolPattern = /^[A-Za-z0-9$._-]{1,16}$/u;
const exactUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const baseUnits = /^(?:0|[1-9][0-9]*)$/u;
const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

class ManifestProblem extends Error {}

/** @throws {ManifestProblem} */
function fail(field: string, problem = "is invalid"): never {
  throw new ManifestProblem(`project.securityBounty${field === "" ? "" : `.${field}`} ${problem}`);
}

/** @throws {never} */
function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @throws {never} */
function member(value: unknown, key: string): unknown {
  return isRecord(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

/** @throws {ManifestProblem} */
function record(value: unknown, field: string): Fields {
  if (!isRecord(value)) throw new ManifestProblem(`project.securityBounty${field === "" ? "" : `.${field}`} must be an object`);
  return value;
}

/** @throws {ManifestProblem} */
function exactKeys(value: Fields, expected: ReadonlyArray<string>, field: string): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) throw new ManifestProblem(`project.securityBounty${field === "" ? "" : `.${field}`} has unexpected or missing fields`);
}

/** @throws {ManifestProblem} */
function text(value: unknown, field: string, max = 2000, min = 1, pattern?: RegExp): string {
  if (typeof value !== "string" || value.length < min || value.length > max || value.trim() !== value || (pattern !== undefined && !pattern.test(value))) fail(field);
  return value;
}

/** @throws {ManifestProblem} */
function integer(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(field);
  return value;
}

/** @throws {never} */
function isExactUtc(value: unknown): boolean {
  return typeof value === "string" && exactUtc.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** @throws {ManifestProblem} */
function timestamp(value: unknown, field: string): void {
  if (!isExactUtc(value)) fail(field);
}

/** @throws {ManifestProblem} */
function list(value: unknown, field: string, min: number, max: number, each: (entry: unknown, at: string) => void): ReadonlyArray<unknown> {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(field, `must list ${min} to ${max} entries`);
  value.forEach((entry, index) => each(entry, `${field}[${index}]`));
  return value;
}

/** @throws {never} */
export function canonical(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** @throws {never} */
export function isFullAwardSplit(split: unknown): boolean {
  return member(split, "researcherBasisPoints") === SECURITY_FULL_AWARD_SPLIT.researcherBasisPoints && member(split, "slopBasisPoints") === SECURITY_FULL_AWARD_SPLIT.slopBasisPoints;
}

/** @throws {never} */
function isChain(value: unknown): value is Chain {
  return value === "base" || value === "ethereum" || value === "robinhood" || value === "solana";
}

/** @throws {never} */
function base58Bytes(value: string): number | undefined {
  if (value.length < 32 || value.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/u.test(value)) return undefined;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(base58Alphabet.indexOf(character));
  let bytes = 0;
  for (; number > 0n; number >>= 8n) bytes += 1;
  let zeros = 0;
  while (value[zeros] === "1") zeros += 1;
  return zeros + bytes;
}

/** @throws {never} */
function canonicalAddress(chain: Chain, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (chains[chain].family === "solana") return base58Bytes(value) === 32 ? value : undefined;
  const lower = value.toLowerCase();
  return /^0x[0-9a-f]{40}$/u.test(lower) ? lower : undefined;
}

/** @throws {never} */
export function sameAddress(chain: Chain, left: string, right: string): boolean {
  return chains[chain].family === "solana" ? left === right : left.toLowerCase() === right.toLowerCase();
}

/** @throws {never} */
export function networkOf(chain: Chain): Network {
  return chains[chain].network;
}

/** @throws {ManifestProblem} */
function assertRewardAsset(value: unknown, field: string): Fields {
  const asset = record(value, field);
  exactKeys(asset, ["address", "chainId", "cluster", "decimals", "kind", "network", "symbol", "verifiedAt"], field);
  if (!isChain(asset.network)) fail(`${field}.network`, "is unsupported");
  const definition = chains[asset.network];
  if (asset.chainId !== definition.chainId || asset.cluster !== definition.cluster) fail(field, "chain identity does not match its network");
  const native = asset.address === definition.native.address;
  if (asset.kind === "native" ? !native : canonicalAddress(asset.network, asset.address) !== asset.address || native) fail(`${field}.address`, "is not a canonical address");
  integer(asset.decimals, `${field}.decimals`, 0, 36);
  if (typeof asset.symbol !== "string" || !symbolPattern.test(asset.symbol)) fail(`${field}.symbol`);
  timestamp(asset.verifiedAt, `${field}.verifiedAt`);
  const reference = asset.kind === "native" ? definition.native : asset.kind === "stablecoin" ? definition.stablecoin : undefined;
  if (asset.kind === "token") {
    if (asset.address === definition.stablecoin.address) fail(field, "names the network stablecoin as a token");
  } else if (reference === undefined) {
    fail(`${field}.kind`);
  } else if (asset.address !== reference.address || asset.symbol !== reference.symbol || asset.decimals !== reference.decimals) {
    fail(field, asset.kind === "native" ? "is not the network native coin" : "is not the network stablecoin");
  }
  return asset;
}

/** @throws {ManifestProblem} */
function validateApprovers(value: unknown): void {
  const approvers = record(value, "approvers");
  exactKeys(approvers, ["dispute", "financial", "technical"], "approvers");
  for (const role of ["technical", "financial", "dispute"]) {
    const ids = list(approvers[role], `approvers.${role}`, 1, 10, (entry, field) => {
      const person = record(entry, field);
      exactKeys(person, ["githubId", "githubLogin"], field);
      text(person.githubId, `${field}.githubId`, 20, 1, githubIdPattern);
      text(person.githubLogin, `${field}.githubLogin`, 39, 1, githubLoginPattern);
    }).map((entry) => member(entry, "githubId"));
    if (new Set(ids).size !== ids.length) fail(`approvers.${role}`, "contains duplicates");
  }
}

/** @throws {ManifestProblem} */
function validateAmount(terms: Fields, fullAward: boolean): void {
  const amount = record(terms.amount, "amount");
  exactKeys(amount, ["currency", "decimals", "grossMinor", "network", ...(amount.asset === undefined ? [] : ["asset"])], "amount");
  if (amount.asset !== undefined) {
    const asset = assertRewardAsset(amount.asset, "amount.asset");
    if (amount.currency !== asset.symbol) fail("amount.currency");
    if (amount.decimals !== asset.decimals) fail("amount.decimals");
    if (amount.network !== asset.network) fail("amount.network");
  } else {
    const currency = typeof amount.currency === "string" && Object.hasOwn(legacyCurrencies, amount.currency) ? legacyCurrencies[amount.currency] : undefined;
    if (currency === undefined) fail("amount.currency");
    if (amount.decimals !== currency.decimals) fail("amount.decimals");
    if (!currency.networks.includes(amount.network as string | null)) fail("amount.network");
  }
  const gross = amount.grossMinor;
  if (typeof gross !== "string" || !baseUnits.test(gross) || gross === "0") fail("amount.grossMinor", "is invalid: gross amount must be positive integer minor units");
  if (!fullAward && BigInt(gross) % 4n !== 0n) fail("amount.grossMinor", "is invalid: gross amount must be divisible by four minor units so the 75/25 split is exact");
  const network = member(amount.asset, "network");
  if (amount.asset === undefined && BigInt(gross) > maxLegacyGrossMinor) fail("amount.grossMinor", "is invalid: gross amount exceeds the legacy maximum");
  if (isChain(network) && BigInt(gross) > chains[network].maxBaseUnits) fail("amount.grossMinor", "is invalid: gross amount exceeds the network asset limit");
}

/** @throws {ManifestProblem} */
function validateScope(terms: Fields, repositoryIds: ReadonlyArray<string>): void {
  const scope = record(terms.scope, "scope");
  exactKeys(scope, ["deployments", "excludedDependencies", ...(scope.excludedFindings === undefined ? [] : ["excludedFindings"]), "includedAssets", "lossDefinition", "severityRubric", "sourceRevisions", "testingPermission"], "scope");
  list(scope.sourceRevisions, "scope.sourceRevisions", 1, 20, (entry, field) => {
    const source = record(entry, field);
    exactKeys(source, ["commit", "repository"], field);
    if (!repositoryIds.includes(String(source.repository).toLowerCase())) fail(`${field}.repository`, "must be one of the project repositories");
    text(source.commit, `${field}.commit`, 40, 40, /^[0-9a-f]{40}$/u);
  });
  list(scope.deployments, "scope.deployments", 0, 50, (entry, field) => {
    const deployment = record(entry, field);
    exactKeys(deployment, ["address", "codeIdentity", "network"], field);
    text(deployment.network, `${field}.network`, 40, 2, /^[a-z0-9-]+$/u);
    text(deployment.address, `${field}.address`, 128, 8, /^[A-Za-z0-9]+$/u);
    if (deployment.codeIdentity !== null) text(deployment.codeIdentity, `${field}.codeIdentity`, 200, 8);
  });
  list(scope.includedAssets, "scope.includedAssets", 1, 50, (entry, field) => text(entry, field, 200, 2));
  list(scope.excludedDependencies, "scope.excludedDependencies", 0, 50, (entry, field) => text(entry, field, 200, 2));
  if (scope.excludedFindings !== undefined) {
    const { maxLines, maxLength, minLength } = SECURITY_EXCLUSION_LIMITS;
    const keys = list(scope.excludedFindings, "scope.excludedFindings", 0, maxLines, (entry, field) => text(entry, field, maxLength, minLength, /^[^\r\n]+$/u)).map((entry) => String(entry).toLowerCase());
    if (new Set(keys).size !== keys.length) fail("scope.excludedFindings", "contains duplicates");
  }
  text(scope.testingPermission, "scope.testingPermission", 2000, 12);
  text(scope.severityRubric, "scope.severityRubric", 2000, 12);
  text(scope.lossDefinition, "scope.lossDefinition", 2000, 12);
}

/** @throws {ManifestProblem} */
function validateFundingAndCapacity(terms: Fields): Fields {
  const funding = record(terms.funding, "funding");
  if (funding.state === "pledged") {
    exactKeys(funding, ["state"], "funding");
  } else if (funding.state === "verified-available") {
    exactKeys(funding, ["evidence", "state", "verifiedAt"], "funding");
    text(funding.evidence, "funding.evidence", 500, 8);
    timestamp(funding.verifiedAt, "funding.verifiedAt");
  } else {
    fail("funding.state");
  }
  const capacity = record(terms.capacity, "capacity");
  exactKeys(capacity, ["awards", "closesAt", "exhaustionRule"], "capacity");
  if (!(terms.fundingPolicy === "after-approval" && capacity.awards === null)) integer(capacity.awards, "capacity.awards", 1, 1000);
  if (capacity.closesAt !== null) timestamp(capacity.closesAt, "capacity.closesAt");
  text(capacity.exhaustionRule, "capacity.exhaustionRule", 1000, 12);
  return funding;
}

/** @throws {ManifestProblem} */
function validateSettlement(terms: Fields): void {
  if (terms.settlement === undefined) return;
  const amount = record(terms.amount, "amount");
  if (amount.currency !== "USDC" || member(terms.settlement, "chain") !== amount.network) fail("settlement", "requires matching USDC program terms");
  const deployments = member(terms.settlement, "deployments");
  for (const deployment of Array.isArray(deployments) ? deployments : []) {
    const network = member(deployment, "network");
    const reviewed = typeof network === "string" && Object.hasOwn(escrowNetworks, network) ? escrowNetworks[network] : undefined;
    const asset = member(deployment, "asset");
    if (reviewed === undefined || reviewed.usdc === null || amount.decimals !== 6 || typeof asset !== "string" || !sameAddress(reviewed.chain, reviewed.usdc, asset)) fail("settlement", "requires the reviewed USDC asset on this network");
  }
}

/** @throws {ManifestProblem} */
function validateContacts(terms: Fields, repositoryIds: ReadonlyArray<string>): void {
  const sponsor = record(terms.sponsor, "sponsor");
  exactKeys(sponsor, ["githubId", "name"], "sponsor");
  text(sponsor.name, "sponsor.name", 120, 2);
  if (sponsor.githubId !== null) text(sponsor.githubId, "sponsor.githubId", 20, 1, githubIdPattern);
  const intake = record(terms.intake, "intake");
  exactKeys(intake, ["kind", "repository"], "intake");
  if (intake.kind !== "github-private-vulnerability-reporting") fail("intake.kind", "must be GitHub private vulnerability reporting");
  if (!repositoryIds.includes(String(intake.repository).toLowerCase())) fail("intake.repository", "must be one of the project repositories");
  const targets = record(terms.responseTargets, "responseTargets");
  exactKeys(targets, ["acknowledgeHours", "triageBusinessDays", "updateIntervalDays"], "responseTargets");
  integer(targets.acknowledgeHours, "responseTargets.acknowledgeHours", 1, 336);
  integer(targets.triageBusinessDays, "responseTargets.triageBusinessDays", 1, 60);
  integer(targets.updateIntervalDays, "responseTargets.updateIntervalDays", 1, 60);
  validateSettlement(terms);
  validateApprovers(terms.approvers);
  const dispute = record(terms.dispute, "dispute");
  exactKeys(dispute, ["authority", "process"], "dispute");
  if (dispute.authority !== "advisory" && dispute.authority !== "binding") fail("dispute.authority");
  text(dispute.process, "dispute.process", 2000, 12);
  text(terms.disclosure, "disclosure", 2000, 12);
  text(terms.safeHarbor, "safeHarbor", 4000, 12);
}

export interface ManifestContext {
  readonly repositories: ReadonlyArray<{ readonly id: string }>;
  readonly reward: unknown;
  readonly trustedSettlement: unknown;
}

/** @throws {ManifestProblem} */
function assertSecurityBountyTerms(value: unknown, context: ManifestContext): Fields {
  const terms = record(value, "");
  exactKeys(terms, [...keys, ...(terms.settlement === undefined ? [] : ["settlement"]), ...(terms.fundingPolicy === undefined ? [] : ["fundingPolicy"])], "");
  if (terms.version !== "1") fail("version");
  if (typeof terms.status !== "string" || !Object.hasOwn(statuses, terms.status)) fail("status");
  if (!rewardModes.includes(String(terms.rewardMode))) fail("rewardMode");
  if (!eligibilities.includes(String(terms.eligibility))) fail("eligibility");
  if (terms.fundingPolicy !== undefined && terms.fundingPolicy !== "after-approval") fail("fundingPolicy");
  const split = record(terms.split, "split");
  exactKeys(split, ["researcherBasisPoints", "slopBasisPoints"], "split");
  const fullAward = isFullAwardSplit(split);
  if (!fullAward && (split.researcherBasisPoints !== SECURITY_SPLIT.researcherBasisPoints || split.slopBasisPoints !== SECURITY_SPLIT.slopBasisPoints)) fail("split", "must be an approved 75/25 or 100/0 researcher/Slop split");
  if (fullAward && terms.fundingPolicy !== "after-approval") fail("fundingPolicy", "must be after-approval for a full-award program");
  if (fullAward && terms.settlement !== undefined) fail("settlement", "cannot bind the 25% bounty vault to a full-award program");
  if (terms.settlement !== undefined && canonical(terms.settlement) !== canonical(context.trustedSettlement)) fail("settlement", "changes only through vault setup, which records verified deployments");
  validateAmount(terms, fullAward);
  const funding = validateFundingAndCapacity(terms);
  const repositoryIds = context.repositories.map((entry) => entry.id.toLowerCase());
  validateScope(terms, repositoryIds);
  validateContacts(terms, repositoryIds);
  const reward = context.reward;
  if (terms.rewardMode === "bounty-only" && (member(reward, "kind") !== "monthly-pool" || member(reward, "monthlyCapMinor") !== "0" || member(reward, "committedMinor") !== "0" || member(reward, "paymentMode") !== "disabled" || (isRecord(reward) && (Object.hasOwn(reward, "reviewBudget") || Object.hasOwn(reward, "cycleCaps"))))) {
    fail("rewardMode", "bounty-only requires a $0 monthly pool with payments disabled");
  }
  if (terms.status === "open" && terms.fundingPolicy !== "after-approval" && funding.state !== "verified-available") fail("status", "open requires verified available funding");
  return terms;
}

/** @throws {never} */
export function securityBountyProblem(value: unknown, context: ManifestContext): string | undefined {
  try {
    assertSecurityBountyTerms(value, context);
    return undefined;
  } catch (error) {
    if (error instanceof ManifestProblem) return error.message;
    return "project.securityBounty is invalid";
  }
}

export interface OwnerInput {
  readonly previous: unknown;
  readonly next: unknown;
  readonly effectiveStatus: unknown;
  readonly actorGithubId: string;
  readonly canManageContacts: boolean;
  readonly splitApprover: boolean;
  readonly fundsAvailable: boolean;
}

/** @throws {never} */
function people(terms: unknown): ReadonlyArray<unknown> {
  const approvers = member(terms, "approvers");
  return ["technical", "financial", "dispute"].flatMap((role) => {
    const entries = member(approvers, role);
    return Array.isArray(entries) ? entries : [];
  });
}

/** @throws {never} */
function assetTerms(terms: unknown) {
  const amount = member(terms, "amount");
  return { currency: member(amount, "currency"), decimals: member(amount, "decimals"), network: member(amount, "network"), asset: member(amount, "asset") };
}

/** @throws {never} */
export function ownerChangeOf(input: OwnerInput): OwnerChange {
  const { previous, next } = input;
  const deployments = member(member(previous, "settlement"), "deployments");
  const sponsor = member(member(next, "sponsor"), "githubId");
  return {
    hadProgram: previous !== undefined,
    hasProgram: next !== undefined,
    splitChanged: isFullAwardSplit(member(next, "split")) !== isFullAwardSplit(member(previous, "split")),
    splitApprover: input.splitApprover,
    canManageContacts: input.canManageContacts,
    contactsChanged: canonical(member(previous, "approvers")) !== canonical(member(next, "approvers")) || canonical(member(previous, "sponsor")) !== canonical(member(next, "sponsor")),
    namesOthers: people(next).some((person) => member(person, "githubId") !== input.actorGithubId) || (sponsor !== null && sponsor !== input.actorGithubId),
    settlementChanged: canonical(member(previous, "settlement")) !== canonical(member(next, "settlement")),
    boundVault: Array.isArray(deployments) && deployments.length > 0,
    namesSettlement: member(next, "settlement") !== undefined,
    assetChanged: canonical(assetTerms(previous)) !== canonical(assetTerms(next)),
    opening: input.effectiveStatus === "open",
    afterApproval: member(next, "fundingPolicy") === "after-approval",
    fundsAvailable: input.fundsAvailable,
  };
}

/** @throws {never} */
export function frozenAsset(terms: unknown): AssetIdentity | undefined {
  const asset = member(terms, "asset");
  const network = member(asset, "network");
  if (isChain(network)) {
    const address = member(asset, "address");
    const decimals = member(asset, "decimals");
    const symbol = member(asset, "symbol");
    if (typeof address !== "string" || typeof decimals !== "number" || typeof symbol !== "string") return undefined;
    return member(terms, "currency") === symbol && member(terms, "decimals") === decimals ? { chain: network, address, symbol, decimals } : undefined;
  }
  const chain = member(terms, "network");
  if (!isChain(chain)) return undefined;
  const stablecoin = chains[chain].stablecoin;
  return member(terms, "currency") === stablecoin.symbol && member(terms, "decimals") === stablecoin.decimals ? stablecoin : undefined;
}

/** @throws {never} */
export function modelAsset(terms: unknown): string {
  const asset = member(terms, "asset");
  if (asset !== undefined && asset !== null) return JSON.stringify(asset);
  const currency = member(terms, "currency");
  return typeof currency === "string" ? currency : "";
}

/** @throws {never} */
export function programStatus(terms: unknown): ProgramStatus {
  const status = member(terms, "status");
  return typeof status === "string" && Object.hasOwn(statuses, status) ? statuses[status] : "Unpublished";
}

/** @throws {never} */
export function scopeExclusions(terms: unknown): ExclusionScope {
  const lines = member(member(terms, "scope"), "excludedFindings");
  return Array.isArray(lines) && lines.every((line) => typeof line === "string") ? { excludedFindings: lines } : {};
}

/** @throws {never} */
export function offerOf(terms: unknown): Offer {
  const amount = member(terms, "amount");
  const gross = member(amount, "grossMinor");
  const policy: FundingPolicy = member(terms, "fundingPolicy") === "after-approval" ? "AfterApproval" : "Prefunded";
  const eligibility: Eligibility = member(terms, "eligibility") === "in-scope-security" ? "InScopeSecurity" : "CriticalLossOfFunds";
  const split: AwardSplit = isFullAwardSplit(member(terms, "split")) ? "FullAward" : "StandardSplit";
  return { status: programStatus(terms), policy, eligibility, gross: limbsOf(typeof gross === "string" ? gross : ""), split, asset: modelAsset(amount), excludedFindings: exclusionLengths(scopeExclusions(terms)) };
}

/** @throws {never} */
export function fundingEvidence(projectId: string, snapshotAt: string): Json {
  return { state: "verified-available", evidence: `Finalized bounty vault balance for ${projectId} at ${snapshotAt}`, verifiedAt: snapshotAt };
}

export interface ProgramAsset {
  readonly network: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly address: string;
}

export interface AwardAssetTerms {
  readonly currency: string;
  readonly decimals: number;
  readonly network: string | null;
  readonly asset?: ProgramAsset;
}

export interface ProgramDeployment {
  readonly network: string;
  readonly vault: string;
  readonly asset: string;
}

export interface ProgramTerms {
  readonly amount: AwardAssetTerms;
  readonly deployments: ReadonlyArray<ProgramDeployment>;
}

export interface ProgramFundsView {
  readonly currency: string;
  readonly decimals: number;
  readonly network: string | null;
  readonly freeMinor: string;
  readonly snapshotAt: string;
  readonly availableMinor: string;
  readonly assetAddress: string;
  readonly deploymentNetwork: string;
}

/** @throws {never} */
function awardAssetTerms(value: unknown): AwardAssetTerms | undefined {
  const currency = member(value, "currency");
  const decimals = member(value, "decimals");
  const network = member(value, "network");
  const asset = member(value, "asset");
  if (typeof currency !== "string" || typeof decimals !== "number" || (typeof network !== "string" && network !== null)) return undefined;
  if (asset === undefined || asset === null) return { currency, decimals, network };
  const assetNetwork = member(asset, "network");
  const symbol = member(asset, "symbol");
  const assetDecimals = member(asset, "decimals");
  const address = member(asset, "address");
  if (typeof assetNetwork !== "string" || typeof symbol !== "string" || typeof assetDecimals !== "number" || typeof address !== "string") return undefined;
  return { currency, decimals, network, asset: { network: assetNetwork, symbol, decimals: assetDecimals, address } };
}

/** @throws {never} */
export function programTermsOf(terms: unknown): ProgramTerms | undefined {
  const amount = awardAssetTerms(member(terms, "amount"));
  if (amount === undefined) return undefined;
  const listed = member(member(terms, "settlement"), "deployments");
  const deployments = (Array.isArray(listed) ? listed : []).flatMap((deployment: unknown) => {
    const network = member(deployment, "network");
    const vault = member(deployment, "vault");
    const asset = member(deployment, "asset");
    return typeof network === "string" && typeof vault === "string" && typeof asset === "string" ? [{ network, vault, asset }] : [];
  });
  return { amount, deployments };
}

/** @throws {never} */
export function fundsCompatible(award: unknown, funds: ProgramFundsView): boolean {
  const terms = awardAssetTerms(award);
  const deployment = Object.hasOwn(escrowNetworks, funds.deploymentNetwork) ? escrowNetworks[funds.deploymentNetwork] : undefined;
  if (terms === undefined || deployment === undefined || deployment.chain !== terms.network) return false;
  if (terms.currency !== funds.currency || terms.decimals !== funds.decimals || terms.network !== funds.network) return false;
  if (terms.asset === undefined) return terms.currency === "USDC" && terms.decimals === 6 && deployment.usdc !== null && sameAddress(deployment.chain, deployment.usdc, funds.assetAddress);
  return terms.asset.network === deployment.chain && terms.asset.symbol === terms.currency && terms.asset.decimals === terms.decimals && sameAddress(deployment.chain, terms.asset.address, funds.assetAddress);
}

/** @throws {never} */
export function reservedMinor(funds: ProgramFundsView): string {
  if (!baseUnits.test(funds.freeMinor) || !baseUnits.test(funds.availableMinor)) return funds.freeMinor;
  const free = BigInt(funds.freeMinor);
  const available = BigInt(funds.availableMinor);
  return (free > available ? free - available : 0n).toString();
}
