/**
 * One accrual run: for each closed epoch not yet filed, judge every finalized
 * payout on a referred project, append the accrual rows, and publish the
 * epoch's accrual file. The arithmetic is integer base units throughout. The
 * store is the only side effect, so the same inputs always give the same file.
 *
 * This module never signs, posts or pays. The `live` poster is a separate,
 * later change; here the file carries the root a poster would use and nothing
 * reads it.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  CLAIM_CHAIN,
  type ReferralAccrualConfig,
  RULE_VERSION,
} from "./config";
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
  period: string;
  epoch: number;
  runId: string;
  mode: "dry_run";
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
  insertAccruals(rows: AccrualRow[]): Promise<void>;
  insertFile(file: AccrualFile): Promise<void>;
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
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/giu, "<url>")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 400) || "unknown error"
  );
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
  const walletOwner = new Map<string, string>();
  for (const [githubId, entry] of [...totals.perReferrer.entries()].sort(
    ([a], [b]) => (BigInt(a) < BigInt(b) ? -1 : 1),
  )) {
    const wallet =
      entry.total > 0n ? await deps.store.claimWallet(githubId) : null;
    const referrer: FileReferrer = {
      githubId,
      githubLogin: entry.login,
      cumulativeBase: entry.total.toString(),
      wallet,
    };
    if (wallet !== null) {
      // Two accounts cannot share one claim address: the leaf would merge
      // their totals and the first claimant would take both. Keep the earlier
      // account's leaf and leave the later one out of this epoch's tree.
      const owner = walletOwner.get(wallet);
      if (owner === undefined) {
        walletOwner.set(wallet, githubId);
        leaves.push({ address: wallet, cumulativeBase: entry.total });
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
      mode: "dry_run",
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
    period,
    epoch,
    runId,
    mode: "dry_run",
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
      await store.insertAccruals(rows);
      const file = await buildFile(period, epoch, runId, rows, totals, deps);
      await store.insertFile(file);
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
