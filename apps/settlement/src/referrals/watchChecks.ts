// spec/settlement/referralWatch.md, "Each public file's bytes, digest, identity, amounts, arithmetic, caps, excluded amounts and wallet pins recompute exactly from its own records"; spec/settlement/referralWatch.md, "Each posted root equals its file's tree, every void is covered and every finalized distributor event is canonical and covered once"
import { type Address, type Hex, decodeEventLog, parseAbi, toEventSelector } from "viem";
import type { Amount } from "../../gen/settlement__money.ts";
import { type WatchFailure, type WatchedAccrual, type WatchedFile, type WatchedReferrer, noFile } from "../../gen/settlement__referralWatch.ts";
import { toAmount } from "../kernels/amounts.ts";
import { formatPeriod, parsePeriod, periodEndSeconds } from "../kernels/calendar.ts";
import { CLAIM_CHAIN, FILE_SCHEMA, RULE_VERSION } from "./fileBytes.ts";
import { type Leaf, buildTree } from "./merkle.ts";
import { ordinalOf, periodOf } from "./periods.ts";

const INDEX_SCHEMA = "slop-referral-accrual-index-v1";
export const WATCH_SCOPE = "public_files_and_canonical_roots";

const UNITS = /^(0|[1-9][0-9]{0,77})$/u;
const ACCOUNT = /^[1-9][0-9]{0,19}$/u;
const WALLET = /^0x[0-9a-f]{40}$/u;
const DIGEST = /^0x[0-9a-f]{64}$/u;
const COUNTED = new Set(["accrued", "project_cap", "pool_cap"]);
const MODES = new Set(["dry_run", "live"]);
const MALFORMED_WALLET = " ";
const ZERO: Amount = [0];

const failureCodes = {
  AccrualArithmeticMismatch: "referral_accrual_arithmetic_mismatch",
  AccrualCapMismatch: "referral_accrual_cap_mismatch",
  CumulativeAccountMismatch: "referral_cumulative_account_mismatch",
  CumulativeTotalMismatch: "referral_cumulative_total_mismatch",
  DeploymentCodeMismatch: "referral_deployment_code_mismatch",
  DeploymentEvidenceMissing: "referral_deployment_evidence_missing",
  DeploymentNotFinalized: "referral_deployment_not_finalized",
  DeploymentTokenMismatch: "referral_deployment_token_mismatch",
  EpochStateMismatch: "referral_epoch_state_mismatch",
  EventCoverageMismatch: "referral_event_coverage_mismatch",
  EventNotCanonical: "referral_event_not_canonical",
  ExcludedAmountMismatch: "referral_excluded_amount_mismatch",
  FileAccountInvalid: "referral_file_account_invalid",
  FileAmountInvalid: "referral_file_amount_invalid",
  FileDigestMismatch: "referral_file_digest_mismatch",
  FileIdentityMismatch: "referral_file_identity_mismatch",
  FilesStale: "referral_files_stale",
  FinalityChanged: "referral_finality_changed",
  IndexInvalid: "referral_index_invalid",
  ObligationRepeated: "referral_obligation_repeated",
  ObservationChanged: "referral_observation_changed",
  PeriodCoverageInvalid: "referral_period_coverage_invalid",
  PostWithoutFile: "referral_post_without_file",
  PostedRootMismatch: "referral_posted_root_mismatch",
  ProofMismatch: "referral_proof_mismatch",
  PublicDataOversized: "referral_public_data_oversized",
  PublicDataUnavailable: "referral_public_data_unavailable",
  TreeMismatch: "referral_tree_mismatch",
  VoidCoverageMismatch: "referral_void_coverage_mismatch",
  VoidRootMismatch: "referral_void_root_mismatch",
  WalletInvalid: "referral_wallet_invalid",
  WalletPinMismatch: "referral_wallet_pin_mismatch",
  WalletlessLeaf: "referral_walletless_leaf",
  WatchUnavailable: "referral_watch_unavailable",
  WrongChain: "referral_wrong_chain",
} as const satisfies Record<Exclude<WatchFailure, "NoFailure">, `referral_${string}`>;

type FailureCode = (typeof failureCodes)[keyof typeof failureCodes];

/** @throws {never} */
export function failureCode(failure: WatchFailure): FailureCode {
  return failure === "NoFailure" ? failureCodes.WatchUnavailable : failureCodes[failure];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const list = (value: unknown): ReadonlyArray<unknown> | undefined => (Array.isArray(value) ? value : undefined);

/** @throws {never} */
function units(value: unknown): bigint | undefined {
  return typeof value === "string" && UNITS.test(value) ? BigInt(value) : undefined;
}

/** @throws {never} */
function limbs(value: bigint | undefined): Amount {
  return value === undefined || value < 0n ? ZERO : toAmount(value);
}

/** @throws {never} */
function account(value: unknown): number | undefined {
  if (typeof value !== "string" || !ACCOUNT.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** @throws {never} */
export function ordinalPeriodOf(text: unknown): number {
  const period = typeof text === "string" ? parsePeriod(text) : undefined;
  return period === undefined ? -1 : ordinalOf(period);
}

/** @throws {never} */
export function periodTextOf(ordinal: number): string {
  const period = periodOf(ordinal);
  return period === undefined ? "" : formatPeriod(period);
}

interface IndexRow {
  readonly epoch: number;
  readonly period: number;
  readonly periodText: string;
  readonly urlMatches: boolean;
  readonly bodySha256: unknown;
  readonly mode: unknown;
  readonly createdAt: unknown;
  readonly merkleRoot: unknown;
  readonly treeTotalBase: unknown;
  readonly leafCount: unknown;
}

/** @throws {never} */
export function indexRows(index: unknown, path: string): ReadonlyArray<IndexRow> | undefined {
  const files = list(field(index, "files"));
  if (field(index, "schema") !== INDEX_SCHEMA || files === undefined) return undefined;
  return files.map((row) => {
    const epoch = field(row, "epoch");
    const periodText = field(row, "period");
    return {
      epoch: typeof epoch === "number" && Number.isSafeInteger(epoch) ? epoch : -1,
      period: ordinalPeriodOf(periodText),
      periodText: typeof periodText === "string" ? periodText : "",
      urlMatches: typeof periodText === "string" && field(row, "url") === `${path}/${periodText}`,
      bodySha256: field(row, "bodySha256"),
      mode: field(row, "mode"),
      createdAt: field(row, "createdAt"),
      merkleRoot: field(row, "merkleRoot"),
      treeTotalBase: field(row, "treeTotalBase"),
      leafCount: field(row, "leafCount"),
    };
  });
}

/** @throws {never} */
export function coverageProbe(row: IndexRow): WatchedFile {
  return { ...noFile, epoch: row.epoch, period: row.period, urlMatches: row.urlMatches };
}

interface FileEvidence {
  readonly row: IndexRow;
  readonly bodyDigest: string;
  readonly headerDigest: string | undefined;
  readonly body: unknown;
  readonly nowMillis: number;
  readonly eligible: (network: string, assetAddress: string) => string | undefined;
  readonly projectKey: (projectId: string) => number;
}

/** @throws {never} */
function instant(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/** @throws {never} */
function identityMatches(evidence: FileEvidence, accruals: ReadonlyArray<unknown> | undefined, referrers: ReadonlyArray<unknown> | undefined): boolean {
  const { row, body, nowMillis } = evidence;
  const period = parsePeriod(row.periodText);
  const generatedAt = instant(field(body, "generatedAt"));
  const mode = field(body, "mode");
  return (
    period !== undefined &&
    field(body, "schema") === FILE_SCHEMA &&
    field(body, "ruleVersion") === RULE_VERSION &&
    field(body, "epoch") === row.epoch &&
    field(body, "period") === row.periodText &&
    mode === row.mode &&
    typeof mode === "string" &&
    MODES.has(mode) &&
    field(body, "generatedAt") === row.createdAt &&
    generatedAt >= periodEndSeconds(period) * 1000 &&
    generatedAt <= nowMillis &&
    field(field(body, "parameters"), "claimChain") === CLAIM_CHAIN &&
    accruals !== undefined &&
    referrers !== undefined
  );
}

/** @throws {never} */
function accrualOf(entry: unknown, evidence: FileEvidence): WatchedAccrual {
  const obligation = field(entry, "obligationId");
  const outcome = field(entry, "outcome");
  const counted = typeof outcome === "string" && COUNTED.has(outcome);
  const network = field(entry, "network");
  const asset = field(entry, "assetAddress");
  const symbol = typeof network === "string" && typeof asset === "string" ? evidence.eligible(network, asset) : undefined;
  return {
    obligation: typeof obligation === "string" ? obligation : "",
    project: evidence.projectKey(String(field(entry, "projectId"))),
    referrer: account(field(entry, "referrerGithubId")) ?? 0,
    counted,
    assetEligible: symbol !== undefined && symbol === field(entry, "assetSymbol"),
    gross: limbs(units(field(entry, "grossBase"))),
    computed: limbs(units(field(entry, "computedBase"))),
    accrued: limbs(units(field(entry, "accruedBase"))),
  };
}

/** @throws {never} */
function walletOf(value: unknown): string {
  if (value === null) return "";
  return typeof value === "string" && value !== "" ? value : MALFORMED_WALLET;
}

/** @throws {never} */
function referrerOf(entry: unknown): WatchedReferrer {
  const wallet = walletOf(field(entry, "wallet"));
  return {
    actor: account(field(entry, "githubId")) ?? 0,
    cumulative: limbs(units(field(entry, "cumulativeBase"))),
    wallet,
    walletWellFormed: WALLET.test(wallet),
    hasLeaf: field(entry, "leaf") !== undefined,
  };
}

/** @throws {never} */
function amountsWellFormed(evidence: FileEvidence, accruals: ReadonlyArray<unknown>, referrers: ReadonlyArray<unknown>): boolean {
  const { body, row } = evidence;
  const parameters = field(body, "parameters");
  const totals = field(body, "totals");
  const fixed = [field(parameters, "rateBasePerMicro"), field(parameters, "projectCapBase"), field(parameters, "poolBase"), field(totals, "poolAccruedBase"), field(totals, "treeTotalBase"), row.treeTotalBase];
  const perAccrual = accruals.flatMap((entry) => {
    const outcome = field(entry, "outcome");
    const amounts = [field(entry, "accruedBase"), field(entry, "computedBase")];
    return typeof outcome === "string" && COUNTED.has(outcome) ? [...amounts, field(entry, "grossBase")] : amounts;
  });
  const perReferrer = referrers.map((entry) => field(entry, "cumulativeBase"));
  return [...fixed, ...perAccrual, ...perReferrer].every((value) => units(value) !== undefined);
}

/** @throws {never} */
function accountsWellFormed(accruals: ReadonlyArray<unknown>, referrers: ReadonlyArray<unknown>): boolean {
  return accruals.every((entry) => account(field(entry, "referrerGithubId")) !== undefined) && referrers.every((entry) => account(field(entry, "githubId")) !== undefined);
}

/** @throws {never} */
function publishedLeaves(referrers: ReadonlyArray<unknown>): ReadonlyArray<Leaf> {
  return referrers.flatMap((entry) => {
    const wallet = field(entry, "wallet");
    const cumulative = units(field(entry, "cumulativeBase"));
    return wallet === null ? [] : [{ address: typeof wallet === "string" ? wallet : "", cumulativeBase: cumulative ?? -1n }];
  });
}

interface TreeEvidence {
  readonly treeMatches: boolean;
  readonly proofsMatch: boolean;
}

/** @throws {never} */
function treeEvidence(evidence: FileEvidence, referrers: ReadonlyArray<unknown>): TreeEvidence {
  const { body, row } = evidence;
  const leaves = publishedLeaves(referrers);
  try {
    const tree = buildTree(leaves);
    const treeTotal = leaves.reduce((sum, leaf) => sum + leaf.cumulativeBase, 0n);
    const merkle = field(body, "merkle");
    const treeMatches =
      row.merkleRoot === (tree?.root ?? null) &&
      row.leafCount === leaves.length &&
      units(row.treeTotalBase) === treeTotal &&
      units(field(field(body, "totals"), "treeTotalBase")) === treeTotal &&
      (tree === null ? merkle === null : field(merkle, "root") === tree.root && field(merkle, "leafCount") === leaves.length);
    const proofsMatch = (tree?.leaves ?? []).every((leaf) => {
      const published = field(referrers.find((entry) => field(entry, "wallet") === leaf.address), "leaf");
      return field(published, "hash") === leaf.hash && JSON.stringify(field(published, "proof")) === JSON.stringify(leaf.proof);
    });
    return { treeMatches, proofsMatch };
  } catch {
    return { treeMatches: false, proofsMatch: false };
  }
}

/** @throws {never} */
export function watchedFile(evidence: FileEvidence): WatchedFile {
  const { body, row } = evidence;
  const accruals = list(field(body, "accruals"));
  const referrers = list(field(body, "referrers"));
  const parameters = field(body, "parameters");
  const rows = { accruals: accruals ?? [], referrers: referrers ?? [] };
  const tree = treeEvidence(evidence, rows.referrers);
  const merkleRoot = row.merkleRoot;
  return {
    ...coverageProbe(row),
    digestMatches: evidence.bodyDigest === row.bodySha256 && evidence.headerDigest === row.bodySha256,
    identityMatches: identityMatches(evidence, accruals, referrers),
    accountsWellFormed: accountsWellFormed(rows.accruals, rows.referrers),
    amountsWellFormed: amountsWellFormed(evidence, rows.accruals, rows.referrers),
    rate: limbs(units(field(parameters, "rateBasePerMicro"))),
    projectCap: limbs(units(field(parameters, "projectCapBase"))),
    poolCap: limbs(units(field(parameters, "poolBase"))),
    accruals: rows.accruals.map((entry) => accrualOf(entry, evidence)),
    referrers: rows.referrers.map(referrerOf),
    poolAccrued: limbs(units(field(field(body, "totals"), "poolAccruedBase"))),
    merkleRoot: typeof merkleRoot === "string" ? merkleRoot : "",
    treeTotal: limbs(units(row.treeTotalBase)),
    treeMatches: tree.treeMatches,
    proofsMatch: tree.proofsMatch,
  };
}

/** @throws {never} */
export function projectKeys(): (projectId: string) => number {
  const keys = new Map<string, number>();
  return (projectId) => {
    const known = keys.get(projectId);
    if (known !== undefined) return known;
    const next = keys.size + 1;
    keys.set(projectId, next);
    return next;
  };
}

export const distributorAbi = parseAbi([
  "function token() view returns (address)",
  "function nextEpoch() view returns (uint256)",
  "function epochAt(uint256) view returns ((bytes32 root,uint256 total,uint64 postedAt,bool voided))",
]);

const eventAbi = parseAbi([
  "event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt)",
  "event RootVoided(uint256 indexed epoch, bytes32 root)",
]);

export const postedTopic: Hex = toEventSelector("RootPosted(uint256,bytes32,uint256,uint64)");
export const voidedTopic: Hex = toEventSelector("RootVoided(uint256,bytes32)");

export interface ChainLog {
  readonly address: string;
  readonly topics: ReadonlyArray<Hex>;
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly transactionHash: Hex;
  readonly transactionIndex: number;
  readonly logIndex: number;
  readonly removed: boolean;
}

interface ChainReceipt {
  readonly transactionHash: Hex;
  readonly blockHash: Hex;
  readonly blockNumber: bigint;
  readonly transactionIndex: number;
  readonly status: "success" | "reverted";
  readonly to: string | undefined;
  readonly logs: ReadonlyArray<ChainLog>;
}

interface ChainBlock {
  readonly number: bigint;
  readonly hash: Hex;
  readonly transactions: ReadonlyArray<Hex>;
}

interface RootEvent {
  readonly epoch: bigint;
  readonly root: string;
  readonly total: bigint;
}

/** @throws {never} */
function decoded(log: ChainLog, eventName: "RootPosted" | "RootVoided"): Readonly<Record<string, unknown>> | undefined {
  const [topic, ...rest] = log.topics;
  if (topic === undefined) return undefined;
  try {
    const event = decodeEventLog({ abi: eventAbi, topics: [topic, ...rest], data: log.data, strict: true });
    return event.eventName === eventName && isRecord(event.args) ? event.args : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function rootEventOf(log: ChainLog, eventName: "RootPosted" | "RootVoided"): RootEvent | undefined {
  const args = decoded(log, eventName);
  const epoch = args?.epoch;
  const root = args?.root;
  const total = eventName === "RootPosted" ? args?.total : 0n;
  return typeof epoch === "bigint" && typeof root === "string" && typeof total === "bigint" ? { epoch, root: root.toLowerCase(), total } : undefined;
}

/** @throws {never} */
export function smallEpoch(epoch: bigint): number {
  return epoch <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(epoch) : -1;
}

/** @throws {never} */
export function canonicalEvent(log: ChainLog, receipt: ChainReceipt | undefined, block: ChainBlock | undefined, distributor: string): boolean {
  if (receipt === undefined || block === undefined || log.removed) return false;
  const sameTopics = (entry: ChainLog) => JSON.stringify(entry.topics) === JSON.stringify(log.topics);
  return (
    receipt.transactionHash === log.transactionHash &&
    receipt.blockNumber >= 0n &&
    block.hash === receipt.blockHash &&
    block.number === receipt.blockNumber &&
    Number.isSafeInteger(receipt.transactionIndex) &&
    receipt.transactionIndex >= 0 &&
    block.transactions[receipt.transactionIndex] === log.transactionHash &&
    receipt.status === "success" &&
    receipt.to?.toLowerCase() === distributor &&
    log.blockHash === receipt.blockHash &&
    log.blockNumber === receipt.blockNumber &&
    log.transactionIndex === receipt.transactionIndex &&
    receipt.logs.some(
      (entry) =>
        !entry.removed &&
        entry.logIndex === log.logIndex &&
        entry.transactionHash === log.transactionHash &&
        entry.blockHash === receipt.blockHash &&
        entry.blockNumber === receipt.blockNumber &&
        entry.transactionIndex === receipt.transactionIndex &&
        entry.address.toLowerCase() === distributor &&
        entry.data === log.data &&
        sameTopics(entry),
    )
  );
}

/** @throws {never} */
export function addressResult(value: unknown): string | undefined {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value) ? value.toLowerCase() : undefined;
}

/** @throws {never} */
export function countResult(value: unknown): bigint | undefined {
  return typeof value === "bigint" && value >= 0n ? value : undefined;
}

interface StoredEpoch {
  readonly root: string;
  readonly total: bigint;
  readonly voided: boolean;
}

/** @throws {never} */
export function epochResult(value: unknown): StoredEpoch | undefined {
  const root = field(value, "root");
  const total = field(value, "total");
  const voided = field(value, "voided");
  return typeof root === "string" && typeof total === "bigint" && typeof voided === "boolean" ? { root: root.toLowerCase(), total, voided } : undefined;
}

/** @throws {never} */
export function bigOf(value: number): bigint {
  return Number.isSafeInteger(value) ? BigInt(value) : -1n;
}

/** @throws {never} */
export function amountOf(value: bigint): Amount {
  return limbs(value);
}

/** @throws {never} */
export function evmAddressOf(text: string | undefined): Address | undefined {
  const value = (text ?? "").trim().toLowerCase();
  return WALLET.test(value) ? (value as Address) : undefined;
}

/** @throws {never} */
export function codeHashOf(text: string | undefined): Hex | undefined {
  const value = (text ?? "").trim();
  return DIGEST.test(value) ? (value as Hex) : undefined;
}

/** @throws {never} */
export function blockOf(text: string | undefined): bigint | undefined {
  return units((text ?? "").trim());
}
