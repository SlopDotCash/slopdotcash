/**
 * One accrual run: for each closed epoch not yet filed, judge every finalized
 * payout on a referred project, append the accrual rows, and publish the
 * epoch's accrual file. The arithmetic is integer base units throughout. The
 * store is the only side effect, so the same inputs always give the same file.
 *
 * The accrual half never signs, posts or pays. The poster half at the end of
 * this file (`postNextRoot`) runs only in live mode, after filing, and signs
 * at most one postRoot per run through a PosterClient the chain file provides.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  CLAIM_CHAIN,
  type PosterConfig,
  type ReferralAccrualConfig,
  RULE_VERSION,
} from "./config";
import {
  ReferralGasBudgetError,
  type ReferralGasCost,
  type ReferralGasLimits,
} from "./gas";
import { buildTree, type Leaf } from "./merkle";

export type Outcome =
  | "accrued"
  | "project_cap"
  | "pool_cap"
  | "window_closed"
  | "held"
  | "referrer_excluded"
  | "asset_not_eligible";

/** A finalized payout on a referred project that no earlier run has judged. */
export interface Candidate {
  obligationId: string;
  projectId: string;
  network: string;
  assetAddress: string;
  assetDecimals: number;
  grossBase: string;
  paidTransaction: string;
  paidObservedAt: string;
  referrerGithubId: string;
  referrerGithubLogin: string;
}

export interface AccrualRow {
  obligationId: string;
  period: string;
  runId: string;
  projectId: string;
  referrerGithubId: string;
  referrerGithubLogin: string;
  network: string;
  paidTransaction: string;
  paidObservedAt: string;
  grossBase: string;
  assetAddress: string;
  assetSymbol: string;
  rateBasePerMicro: string;
  computedBase: string;
  accruedBase: string;
  outcome: Outcome;
  reason: string | null;
  ruleVersion: typeof RULE_VERSION;
  createdAt: string;
}

/** A prior accrual, as much of it as totals and the file need. */
export interface PriorAccrual {
  projectId: string;
  referrerGithubId: string;
  referrerGithubLogin: string;
  accruedBase: string;
}

export interface Hold {
  id: string;
  projectId: string;
  reason: string;
  createdAt: string;
}

export interface AccrualFile {
  /** Referrers entering a tree for the first time in this file, to pin. */
  pins: { githubId: string; wallet: string }[];
  period: string;
  epoch: number;
  runId: string;
  mode: "dry_run" | "live";
  body: string;
  bodySha256: string;
  merkleRoot: `0x${string}` | null;
  treeTotalBase: string;
  leafCount: number;
  createdAt: string;
}

export interface AccrualStore {
  acquireLock(runId: string, now: Date): Promise<boolean>;
  releaseLock(runId: string, now: Date): Promise<void>;
  /** Filed epochs in order. */
  filedPeriods(): Promise<{ period: string; epoch: number }[]>;
  candidates(period: string): Promise<Candidate[]>;
  /** Every accrual filed so far that counts toward a total, in filing order. */
  priorAccruals(): Promise<PriorAccrual[]>;
  /** Earliest finalized paid event on the project, over every obligation. */
  firstPaidAt(projectId: string): Promise<string | null>;
  activeHold(projectId: string): Promise<Hold | null>;
  hasParticipationBan(githubId: string): Promise<boolean>;
  /** Current authorized claim-chain wallet, lowercase, or null. */
  claimWallet(githubId: string): Promise<string | null>;
  /** Wallets pinned by earlier files: referrer id to wallet. */
  pinnedWallets(): Promise<Map<string, string>>;
  /** Atomically files the rows, exact file and first-use wallet pins under this run's lease. */
  filePeriod(rows: AccrualRow[], file: AccrualFile, now: Date): Promise<void>;
}

export interface RunDependencies {
  config: ReferralAccrualConfig;
  store: AccrualStore;
  now: () => Date;
  randomId: () => string;
  sha256: (text: string) => Promise<string>;
  log: (event: Record<string, unknown>) => void;
}

export interface RunResult {
  status: "ran" | "locked";
  filed: { period: string; epoch: number; rows: number; leafCount: number }[];
}

/** Lease length; one run files at most a handful of epochs. */
export const LOCK_MS = 10 * 60 * 1000;

/** Bounded, single-line error text for logs. */
export function message(error: unknown): string {
  // Provider errors can embed signed transaction bytes in message/details/cause.
  // Do not copy that text to logs or public-facing diagnostic fields.
  return error instanceof TypeError
    ? "referral_invalid_input"
    : "referral_operation_failed";
}

export function periodBounds(period: string): { start: string; end: string } {
  const [year, month] = period.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The periods that have ended at `now` and are not filed, oldest first. */
export function pendingPeriods(
  filed: { period: string }[],
  firstPeriod: string,
  now: Date,
): string[] {
  const last = filed.length > 0 ? filed[filed.length - 1].period : null;
  let period = last === null ? firstPeriod : nextPeriod(last);
  const pending: string[] = [];
  while (Date.parse(periodBounds(period).end) <= now.getTime()) {
    pending.push(period);
    period = nextPeriod(period);
  }
  return pending;
}

/** The window closes `months` calendar months after the first paid event. */
export function windowEnd(firstPaidAt: string, months: number): string {
  const first = new Date(firstPaidAt);
  const end = new Date(first.getTime());
  end.setUTCMonth(end.getUTCMonth() + months);
  return end.toISOString();
}

/**
 * The payout asset must be one of the network's reference stablecoins, so a
 * gross amount is a dollar amount. A project-token payout has no fixed dollar
 * value without an oracle and accrues nothing.
 */
export function eligibleAsset(
  network: string,
  assetAddress: string,
  assetDecimals: number,
): { symbol: string } | null {
  const definition = (
    ESCROW_NETWORKS as Record<
      string,
      | {
          family: string;
          assets: readonly {
            address: string;
            symbol: string;
            decimals: number;
          }[];
        }
      | undefined
    >
  )[network];
  if (!definition) return null;
  const wanted =
    definition.family === "evm" ? assetAddress.toLowerCase() : assetAddress;
  const asset = definition.assets.find(
    (entry) =>
      (definition.family === "evm"
        ? entry.address.toLowerCase()
        : entry.address) === wanted,
  );
  if (asset?.decimals !== 6 || assetDecimals !== 6) return null;
  return { symbol: asset.symbol };
}

function min(...values: bigint[]): bigint {
  return values.reduce((a, b) => (a < b ? a : b));
}

interface Totals {
  pool: bigint;
  perProject: Map<string, bigint>;
  perReferrer: Map<string, { login: string; total: bigint }>;
}

function totalsOf(rows: PriorAccrual[]): Totals {
  const totals: Totals = {
    pool: 0n,
    perProject: new Map(),
    perReferrer: new Map(),
  };
  for (const row of rows) add(totals, row);
  return totals;
}

function add(totals: Totals, row: PriorAccrual) {
  const amount = BigInt(row.accruedBase);
  totals.pool += amount;
  totals.perProject.set(
    row.projectId,
    (totals.perProject.get(row.projectId) ?? 0n) + amount,
  );
  const referrer = totals.perReferrer.get(row.referrerGithubId) ?? {
    login: row.referrerGithubLogin,
    total: 0n,
  };
  referrer.total += amount;
  referrer.login = row.referrerGithubLogin;
  totals.perReferrer.set(row.referrerGithubId, referrer);
}

/** Judges one epoch's candidates in order against the running totals. */
export async function judge(
  period: string,
  runId: string,
  candidates: Candidate[],
  totals: Totals,
  deps: RunDependencies,
): Promise<AccrualRow[]> {
  const { config, store } = deps;
  const rows: AccrualRow[] = [];
  const firstPaid = new Map<string, string | null>();
  const holds = new Map<string, Hold | null>();
  const banned = new Map<string, boolean>();
  for (const candidate of candidates) {
    const createdAt = deps.now().toISOString();
    const base = {
      obligationId: candidate.obligationId,
      period,
      runId,
      projectId: candidate.projectId,
      referrerGithubId: candidate.referrerGithubId,
      referrerGithubLogin: candidate.referrerGithubLogin,
      network: candidate.network,
      paidTransaction: candidate.paidTransaction,
      paidObservedAt: candidate.paidObservedAt,
      grossBase: candidate.grossBase,
      assetAddress: candidate.assetAddress,
      rateBasePerMicro: config.rateBasePerMicro.toString(),
      ruleVersion: RULE_VERSION,
      createdAt,
    } as const;
    const zero = (
      outcome: Exclude<Outcome, "accrued" | "project_cap" | "pool_cap">,
      reason: string,
      assetSymbol: string,
    ): AccrualRow => ({
      ...base,
      assetSymbol,
      computedBase: "0",
      accruedBase: "0",
      outcome,
      reason,
    });
    const asset = eligibleAsset(
      candidate.network,
      candidate.assetAddress,
      candidate.assetDecimals,
    );
    if (asset === null) {
      rows.push(
        zero(
          "asset_not_eligible",
          "payout asset is not a reference stablecoin of its network",
          "unknown",
        ),
      );
      continue;
    }
    if (config.excludedGithubIds.has(candidate.referrerGithubId)) {
      rows.push(zero("referrer_excluded", "team account", asset.symbol));
      continue;
    }
    if (!banned.has(candidate.referrerGithubId))
      banned.set(
        candidate.referrerGithubId,
        await store.hasParticipationBan(candidate.referrerGithubId),
      );
    if (banned.get(candidate.referrerGithubId)) {
      rows.push(zero("referrer_excluded", "participation ban", asset.symbol));
      continue;
    }
    if (!holds.has(candidate.projectId))
      holds.set(
        candidate.projectId,
        await store.activeHold(candidate.projectId),
      );
    const hold = holds.get(candidate.projectId);
    if (hold) {
      rows.push(
        zero("held", `${hold.id}: ${hold.reason}`.slice(0, 500), asset.symbol),
      );
      continue;
    }
    if (!firstPaid.has(candidate.projectId))
      firstPaid.set(
        candidate.projectId,
        await store.firstPaidAt(candidate.projectId),
      );
    const first =
      firstPaid.get(candidate.projectId) ?? candidate.paidObservedAt;
    const end = windowEnd(
      first < candidate.paidObservedAt ? first : candidate.paidObservedAt,
      config.windowMonths,
    );
    if (candidate.paidObservedAt >= end) {
      rows.push(
        zero(
          "window_closed",
          `referral window ended ${end} (first payout ${first})`,
          asset.symbol,
        ),
      );
      continue;
    }
    const computed = BigInt(candidate.grossBase) * config.rateBasePerMicro;
    const projectRemaining =
      config.projectCapBase -
      (totals.perProject.get(candidate.projectId) ?? 0n);
    const poolRemaining = config.poolBase - totals.pool;
    const accrued = min(
      computed,
      projectRemaining > 0n ? projectRemaining : 0n,
      poolRemaining > 0n ? poolRemaining : 0n,
    );
    const outcome: Outcome =
      accrued === computed
        ? "accrued"
        : accrued === (projectRemaining > 0n ? projectRemaining : 0n)
          ? "project_cap"
          : "pool_cap";
    const row: AccrualRow = {
      ...base,
      assetSymbol: asset.symbol,
      computedBase: computed.toString(),
      accruedBase: accrued.toString(),
      outcome,
      reason:
        outcome === "accrued"
          ? null
          : outcome === "project_cap"
            ? "project lifetime cap reached"
            : "program pool exhausted",
    };
    rows.push(row);
    add(totals, row);
  }
  return rows;
}

export interface FileReferrer {
  githubId: string;
  githubLogin: string;
  cumulativeBase: string;
  /**
   * The leaf address. Once a referrer enters a tree its wallet is pinned for
   * every later file, whatever the registry says afterwards, because the
   * distributor tracks claims per address: moving a leaf would pay a
   * cumulative twice and dropping one would strand it.
   */
  wallet: string | null;
  /** Present only for referrers in the tree. */
  leaf?: { hash: string; proof: string[] };
}

export async function buildFile(
  period: string,
  epoch: number,
  runId: string,
  rows: AccrualRow[],
  totals: Totals,
  deps: RunDependencies,
): Promise<AccrualFile> {
  const referrers: FileReferrer[] = [];
  const leaves: Leaf[] = [];
  const pinned = await deps.store.pinnedWallets();
  const pins: { githubId: string; wallet: string }[] = [];
  const walletOwner = new Map<string, string>();
  for (const [githubId, wallet] of pinned) walletOwner.set(wallet, githubId);
  for (const [githubId, entry] of [...totals.perReferrer.entries()].sort(
    ([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1),
  )) {
    const pin = pinned.get(githubId) ?? null;
    const wallet =
      pin ?? (entry.total > 0n ? await deps.store.claimWallet(githubId) : null);
    const referrer: FileReferrer = {
      githubId,
      githubLogin: entry.login,
      cumulativeBase: entry.total.toString(),
      wallet,
    };
    if (wallet !== null) {
      // Two accounts cannot share one claim address: the leaf would merge
      // their totals and the first claimant would take both. A pinned wallet
      // belongs to its referrer; otherwise keep the earlier account's leaf
      // and leave the later one out of this epoch's tree.
      const owner = walletOwner.get(wallet);
      if (owner === undefined || owner === githubId) {
        walletOwner.set(wallet, githubId);
        leaves.push({ address: wallet, cumulativeBase: entry.total });
        if (pin === null) pins.push({ githubId, wallet });
      } else {
        referrer.wallet = null;
        deps.log({
          event: "referral_wallet_shared",
          period,
          wallet,
          keptGithubId: owner,
          droppedGithubId: githubId,
        });
      }
    }
    referrers.push(referrer);
  }
  const tree = buildTree(leaves);
  if (tree)
    for (const leaf of tree.leaves) {
      const referrer = referrers.find((entry) => entry.wallet === leaf.address);
      if (referrer) referrer.leaf = { hash: leaf.hash, proof: leaf.proof };
    }
  const treeTotal = leaves.reduce((sum, leaf) => sum + leaf.cumulativeBase, 0n);
  const createdAt = deps.now().toISOString();
  const body = JSON.stringify(
    {
      schema: "slop-referral-accrual-file-v1",
      ruleVersion: RULE_VERSION,
      period,
      epoch,
      mode: deps.config.mode === "live" ? "live" : "dry_run",
      generatedAt: createdAt,
      runId,
      parameters: {
        rateBasePerMicro: deps.config.rateBasePerMicro.toString(),
        tokenDecimals: deps.config.tokenDecimals,
        poolBase: deps.config.poolBase.toString(),
        projectCapBase: deps.config.projectCapBase.toString(),
        windowMonths: deps.config.windowMonths,
        claimChain: CLAIM_CHAIN,
      },
      accruals: rows.map((row) => ({
        obligationId: row.obligationId,
        projectId: row.projectId,
        referrerGithubId: row.referrerGithubId,
        referrerGithubLogin: row.referrerGithubLogin,
        network: row.network,
        paidTransaction: row.paidTransaction,
        paidObservedAt: row.paidObservedAt,
        grossBase: row.grossBase,
        assetAddress: row.assetAddress,
        assetSymbol: row.assetSymbol,
        computedBase: row.computedBase,
        accruedBase: row.accruedBase,
        outcome: row.outcome,
        reason: row.reason,
      })),
      totals: {
        poolAccruedBase: totals.pool.toString(),
        treeTotalBase: treeTotal.toString(),
      },
      referrers,
      merkle: tree
        ? {
            leaf: "keccak256(bytes.concat(keccak256(abi.encode(address,uint256 cumulativeBase))))",
            pairs: "sorted",
            root: tree.root,
            leafCount: tree.leaves.length,
          }
        : null,
    },
    null,
    2,
  );
  return {
    pins,
    period,
    epoch,
    runId,
    mode: deps.config.mode === "live" ? "live" : "dry_run",
    body,
    bodySha256: await deps.sha256(body),
    merkleRoot: tree ? tree.root : null,
    treeTotalBase: treeTotal.toString(),
    leafCount: tree ? tree.leaves.length : 0,
    createdAt,
  };
}

export async function runAccrual(deps: RunDependencies): Promise<RunResult> {
  const { store, config } = deps;
  const runId = `rrun_${deps.randomId()}`;
  const now = deps.now();
  if (!(await store.acquireLock(runId, now)))
    return { status: "locked", filed: [] };
  try {
    const filed = await store.filedPeriods();
    const totals = totalsOf(await store.priorAccruals());
    const result: RunResult = { status: "ran", filed: [] };
    let epoch = filed.length;
    for (const period of pendingPeriods(filed, config.firstPeriod, now)) {
      const candidates = await store.candidates(period);
      const rows = await judge(period, runId, candidates, totals, deps);
      const file = await buildFile(period, epoch, runId, rows, totals, deps);
      await store.filePeriod(rows, file, deps.now());
      deps.log({
        event: "referral_accrual_filed",
        period,
        epoch,
        mode: config.mode,
        rows: rows.length,
        accrued: rows.filter((row) => BigInt(row.accruedBase) > 0n).length,
        leafCount: file.leafCount,
        merkleRoot: file.merkleRoot,
        bodySha256: file.bodySha256,
      });
      result.filed.push({
        period,
        epoch,
        rows: rows.length,
        leafCount: file.leafCount,
      });
      epoch += 1;
    }
    return result;
  } finally {
    await store.releaseLock(runId, deps.now());
  }
}

/** One recorded postRoot send, as much of it as reconciliation needs. */
export interface PostRow {
  id: string;
  runId: string;
  period: string;
  epoch: number;
  network: string;
  distributor: string;
  token: string;
  poster: string;
  merkleRoot: string;
  totalBase: string;
  txId: string;
  rawTx: string;
  evmNonce: number;
  state: "submitted" | "unknown" | "finalized" | "failed" | "voided";
  reason: string | null;
  blockNumber: string | null;
  voidAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  finalizedAt: string | null;
}

export interface ChainState {
  chainId: number;
  token: string;
  owner: string;
  poster: string;
  paused: boolean;
  epochCap: bigint;
  activeTotal: bigint;
  totalClaimed: bigint;
  balance: bigint;
  nextEpoch: number;
  hasPendingRoot: boolean;
  latest: {
    index: number;
    root: string;
    total: bigint;
    postedAt: number;
    voided: boolean;
  } | null;
}

export interface PreparedPost {
  txId: string;
  rawTx: string;
  evmNonce: number;
  maximumNativeWei: string;
}

export type PostStatus =
  | { kind: "pending" }
  | { kind: "finalized"; blockNumber: string; voided: boolean }
  | { kind: "failed"; reason: string }
  /** Not seen on chain and the nonce still free: send the same bytes again. */
  | { kind: "rebroadcast" };

export interface PosterClient {
  /** The signer, lowercase, or null when no key is loaded. */
  address(): string | null;
  state(): Promise<ChainState>;
  epochAt(index: number): Promise<{
    root: string;
    total: bigint;
    postedAt: number;
    voided: boolean;
  }>;
  /** Simulates the post at the latest block, then signs it. */
  prepare(
    epoch: number,
    root: string,
    total: bigint,
    authorize?: (maximumWei: string) => Promise<void>,
  ): Promise<PreparedPost>;
  /** Signed gas limit and exact canonical receipt fee; pending costs stay unknown. */
  nativeCost(row: PostRow): Promise<ReferralGasCost>;
  broadcast(rawTx: string): Promise<void>;
  status(row: PostRow): Promise<PostStatus>;
}

export interface PostStore {
  openPosts(network: string): Promise<PostRow[]>;
  /** Every post that occupies a contract epoch (not failed), by epoch. */
  acceptedPosts(network: string): Promise<PostRow[]>;
  /** Filed files with a root, in epoch order: period, root and tree total. */
  postableFiles(): Promise<
    { period: string; merkleRoot: string; treeTotalBase: string }[]
  >;
  unsettledGasPosts(network: string): Promise<PostRow[]>;
  recordGas(row: PostRow, cost: ReferralGasCost): Promise<void>;
  assertGasBudget(
    network: string,
    maximumWei: string,
    limits: ReferralGasLimits,
    now: Date,
  ): Promise<void>;
  insertPost(
    row: PostRow,
    maximumWei: string,
    limits: ReferralGasLimits,
  ): Promise<void>;
  updatePost(
    id: string,
    fields: Partial<
      Pick<
        PostRow,
        "state" | "reason" | "blockNumber" | "updatedAt" | "finalizedAt"
      >
    >,
  ): Promise<void>;
}

export interface PostDependencies {
  config: PosterConfig;
  store: PostStore;
  client: PosterClient;
  now: () => Date;
  randomId: () => string;
  log: (event: Record<string, unknown>) => void;
}

export interface PostResult {
  status:
    | "posted"
    | "nothing_to_post"
    | "in_flight"
    | "halted_after_void"
    | "chain_mismatch"
    | "paused"
    | "pending_root"
    | "gas_budget"
    | "precheck_failed";
  reconciled: number;
  reason?: string;
}

async function reconcilePosts(
  deps: PostDependencies,
): Promise<{ reconciled: number; pending: boolean }> {
  const { store, client } = deps;
  let reconciled = 0;
  let pending = false;
  for (const row of await store.openPosts(deps.config.network)) {
    const status = await client.status(row);
    const at = deps.now().toISOString();
    switch (status.kind) {
      case "pending":
        break;
      case "finalized":
        await store.updatePost(row.id, {
          state: status.voided ? "voided" : "finalized",
          blockNumber: status.blockNumber,
          finalizedAt: at,
          updatedAt: at,
          reason: null,
        });
        deps.log({
          event: status.voided
            ? "referral_post_voided"
            : "referral_post_finalized",
          period: row.period,
          epoch: row.epoch,
          txId: row.txId,
          blockNumber: status.blockNumber,
        });
        reconciled += 1;
        break;
      case "failed":
        await store.updatePost(row.id, {
          state: "failed",
          reason: status.reason,
          updatedAt: at,
        });
        deps.log({
          event: "referral_post_failed",
          period: row.period,
          epoch: row.epoch,
          txId: row.txId,
          reason: status.reason,
        });
        reconciled += 1;
        break;
      case "rebroadcast":
        if (
          BigInt((await client.nativeCost(row)).maximumWei) >
          BigInt(deps.config.gas.perTransactionWei)
        )
          throw new ReferralGasBudgetError(
            "The pending referral transaction exceeds the native fee limit",
          );
        // Its existing reservation is already included; identical retries add no liability.
        await store.assertGasBudget(
          row.network,
          "0",
          deps.config.gas,
          deps.now(),
        );
        try {
          await client.broadcast(row.rawTx);
          await store.updatePost(row.id, {
            state: "submitted",
            reason: null,
            updatedAt: at,
          });
        } catch (error) {
          await store.updatePost(row.id, {
            state: "unknown",
            reason: message(error),
            updatedAt: at,
          });
        }
        break;
    }
  }
  // Recheck finalized posts through the same canonical receipt/event boundary.
  for (const row of await store.acceptedPosts(deps.config.network)) {
    if (row.state !== "finalized") continue;
    const status = await client.status(row);
    if (status.kind !== "finalized") {
      pending = true;
      continue;
    }
    if (!status.voided) continue;
    const at = deps.now().toISOString();
    await store.updatePost(row.id, { state: "voided", updatedAt: at });
    deps.log({
      event: "referral_post_voided",
      period: row.period,
      epoch: row.epoch,
      txId: row.txId,
    });
    reconciled += 1;
  }
  return { reconciled, pending };
}

/**
 * Posts the next filed root the chain does not carry yet. Order of checks:
 * reconcile every recorded send; refuse while one is in flight; refuse
 * after an owner void until the operator acknowledges it; refuse when the
 * chain's token, poster or epoch count disagree with the configuration and
 * the journal; refuse while the contract is paused or a root is pending;
 * then simulate, record and broadcast one post.
 */
export async function postNextRoot(
  deps: PostDependencies,
): Promise<PostResult> {
  try {
    return await postWithinGasBudget(deps);
  } catch (error) {
    if (!(error instanceof ReferralGasBudgetError)) throw error;
    deps.log({ event: "referral_post_gas_budget", reason: error.message });
    return { status: "gas_budget", reconciled: 0, reason: error.message };
  }
}
async function postWithinGasBudget(
  deps: PostDependencies,
): Promise<PostResult> {
  const { store, client, config } = deps;
  // An existing journal must never be sent or reconciled against replacement configuration.
  const recorded = await store.acceptedPosts(config.network);
  if (
    recorded.some(
      (row) =>
        row.distributor !== config.distributor || row.token !== config.token,
    )
  )
    return {
      status: "chain_mismatch",
      reconciled: 0,
      reason: "journal deployment differs",
    };
  // Reconstruct legacy reserves from signed bytes. Never treat missing evidence as zero.
  for (const row of await store.unsettledGasPosts(config.network))
    await store.recordGas(row, await client.nativeCost(row));
  const { reconciled, pending } = await reconcilePosts(deps);
  if (pending) return { status: "in_flight", reconciled };
  const open = await store.openPosts(config.network);
  if (open.length > 0) return { status: "in_flight", reconciled };
  const accepted = await store.acceptedPosts(config.network);
  const unacknowledged = accepted.find(
    (row) => row.state === "voided" && row.voidAcknowledgedAt === null,
  );
  if (unacknowledged) {
    deps.log({
      event: "referral_post_halted_after_void",
      period: unacknowledged.period,
      epoch: unacknowledged.epoch,
    });
    return {
      status: "halted_after_void",
      reconciled,
      reason: `epoch ${unacknowledged.epoch} (${unacknowledged.period}) was voided and is not acknowledged`,
    };
  }
  const state = await client.state();
  const signer = client.address();
  const mismatch =
    state.chainId !== config.chainId
      ? `chain id ${state.chainId} is not ${config.chainId}`
      : state.token !== config.token
        ? `distributor token ${state.token} is not ${config.token}`
        : signer === null
          ? "no poster key"
          : state.poster !== signer
            ? `distributor poster ${state.poster} is not this key`
            : state.nextEpoch !== accepted.length
              ? `chain has ${state.nextEpoch} epochs, journal has ${accepted.length}`
              : null;
  if (mismatch) {
    deps.log({ event: "referral_post_chain_mismatch", reason: mismatch });
    return { status: "chain_mismatch", reconciled, reason: mismatch };
  }
  if (state.paused) return { status: "paused", reconciled };
  if (state.hasPendingRoot) return { status: "pending_root", reconciled };
  const posted = new Set(accepted.map((row) => row.period));
  const lastPeriod = accepted.reduce(
    (last, row) => (row.period > last ? row.period : last),
    "",
  );
  const candidate = (await store.postableFiles()).find(
    (file) => !posted.has(file.period) && file.period > lastPeriod,
  );
  if (!candidate) return { status: "nothing_to_post", reconciled };
  const total = BigInt(candidate.treeTotalBase);
  // The contract repeats these checks; failing them here records the reason
  // instead of spending gas on a revert.
  const previous = accepted
    .filter((row) => row.state === "finalized")
    .reduce(
      (max, row) => (BigInt(row.totalBase) > max ? BigInt(row.totalBase) : max),
      0n,
    );
  const precheck =
    total < previous
      ? `file total ${total} is below the last finalized total ${previous}`
      : total - previous > state.epochCap
        ? `file total grows by ${total - previous}, over the epoch cap ${state.epochCap}`
        : state.balance + state.totalClaimed < total
          ? `balance ${state.balance} plus claimed ${state.totalClaimed} does not cover ${total}`
          : null;
  if (precheck) {
    deps.log({
      event: "referral_post_precheck_failed",
      period: candidate.period,
      reason: precheck,
    });
    return { status: "precheck_failed", reconciled, reason: precheck };
  }
  const epoch = state.nextEpoch;
  const prepared = await client.prepare(
    epoch,
    candidate.merkleRoot,
    total,
    (maximumWei) =>
      store.assertGasBudget(config.network, maximumWei, config.gas, deps.now()),
  );
  const at = deps.now().toISOString();
  const row: PostRow = {
    id: `rpost_${deps.randomId()}`,
    runId: `rrun_${deps.randomId()}`,
    period: candidate.period,
    epoch,
    network: config.network,
    distributor: config.distributor,
    token: config.token,
    poster: signer as string,
    merkleRoot: candidate.merkleRoot,
    totalBase: total.toString(),
    txId: prepared.txId,
    rawTx: prepared.rawTx,
    evmNonce: prepared.evmNonce,
    state: "submitted",
    reason: null,
    blockNumber: null,
    voidAcknowledgedAt: null,
    createdAt: at,
    updatedAt: at,
    submittedAt: at,
    finalizedAt: null,
  };
  // Durable before broadcast: an unknown send is resent unchanged, never re-signed.
  // The conditional D1 batch repeats the budget check and commits raw bytes and
  // reservation together. A losing concurrent signer can never broadcast its bytes.
  await store.insertPost(row, prepared.maximumNativeWei, config.gas);
  try {
    await client.broadcast(prepared.rawTx);
  } catch (error) {
    await store.updatePost(row.id, {
      state: "unknown",
      reason: message(error),
      updatedAt: deps.now().toISOString(),
    });
  }
  deps.log({
    event: "referral_post_submitted",
    period: candidate.period,
    epoch,
    merkleRoot: candidate.merkleRoot,
    totalBase: total.toString(),
    txId: prepared.txId,
  });
  return { status: "posted", reconciled };
}
