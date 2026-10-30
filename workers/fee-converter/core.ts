/**
 * One conversion run: reconcile unresolved sends, then quote, check and (in
 * live mode) sign one swap per candidate token into the network's USDC. The
 * chain and aggregator details live behind ChainClient so the policy here is
 * chain-neutral.
 *
 * A `receipts` run converts only tokens whose fee-wallet balance changed since
 * the token's last record, so fees convert soon after they arrive (PRD
 * section 6). A `recovery` run re-evaluates every candidate and retries what
 * a failed quote, route or price left behind.
 */

import { FeeCapTooLowError } from "viem";
import { isNativeAssetAddress } from "../../src/lib/escrow-policy.mjs";
import type { Limits, Mode, Network, NetworkConfig } from "./config";
import { LOCK_MS } from "./store";

export type ConversionState =
  | "quoted"
  /** Below the dust threshold: the fee stays in the wallet until it grows. */
  | "pending"
  | "skipped"
  | "no_route"
  | "submitted"
  | "finalized"
  | "failed"
  | "unknown";

export interface ConversionRow {
  id: string;
  /** Existing rows are conversions. All send kinds share the pending-token guard. */
  kind?: "conversion" | "claim" | "approval";
  runId: string;
  network: Network;
  mode: "dry_run" | "live";
  feeWallet: string;
  token: string;
  targetToken: string;
  amountIn: string;
  route: "kyberswap" | "jupiter" | null;
  quoteAmountOut: string | null;
  minAmountOut: string | null;
  quoteValueMicro: number | null;
  priceImpactBps: number | null;
  quote: string | null;
  approvalTxId: string | null;
  txId: string | null;
  rawTx: string | null;
  evmNonce: number | null;
  expiresAt: number | null;
  amountOut: string | null;
  tokenBalanceBefore: string | null;
  targetBalanceBefore: string | null;
  targetBalanceAfter: string | null;
  state: ConversionState;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  finalizedAt: string | null;
  /**
   * The transaction the final outcome comes from: the original send or one
   * of its same-nonce replacements (migration 0087).
   */
  landedTxId?: string | null;
  nativeGasId?: string | null;
}

/**
 * One same-nonce EVM fee replacement of a journaled send (migration 0087).
 * It is stored before it is broadcast and never changes.
 */
export interface SendReplacement {
  nativeGasId?: string | null;
  id: string;
  conversionId: string;
  network: Network;
  /** 1 is the first replacement; the original send is attempt 0. */
  attempt: number;
  evmNonce: number;
  txId: string;
  rawTx: string;
  /** Wei, as decimal strings. */
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  createdAt: string;
}

/** A signed replacement that is not yet journaled or broadcast. */
export type ReplacementResult =
  | {
      txId: string;
      rawTx: string;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
      nativeGasId?: string;
    }
  /** No replacement is signed now. The send waits; `wait` says why. */
  | { wait: string };

export interface Quote {
  route: "kyberswap" | "jupiter";
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
  /** Null when the aggregator cannot price the input; the run fails closed. */
  priceImpactBps: number | null;
  /** Estimated network fee in USDC micro-units. */
  gasCostMicro: bigint;
  /** Bounded, public quote facts for the record. */
  summary: Record<string, unknown>;
}

export type QuoteResult = Quote | { noRoute: string };

/** A signed send, recorded before it is broadcast. */
export interface PreparedSend {
  nativeGasId?: string;
  /** EVM approvals are separate immutable sends before a later swap. */
  kind?: "conversion" | "approval";
  txId: string;
  rawTx: string;
  evmNonce: number | null;
  expiresAt: number | null;
  approvalTxId: string | null;
  /** The minimum output the signed transaction enforces. */
  minAmountOut: bigint;
}

export type SendStatus =
  /**
   * `mined`: the nonce is used on chain (included but not finalized, or
   * consumed while the claim receipt is unavailable). Never replaced.
   */
  | { kind: "pending"; mined?: boolean }
  /** `txId`: the attempt (original or replacement) that landed. */
  | { kind: "finalized"; amountOut: bigint; txId?: string }
  | { kind: "failed"; reason: string; txId?: string }
  /**
   * Not seen on chain and still valid: send the same bytes again. `rawTx` is
   * the latest journaled replacement, when one exists.
   */
  | { kind: "rebroadcast"; rawTx?: string };

export interface ChainClient {
  /** Reconcile native liabilities, including business-terminal sends, before signing. */
  reconcileNativeGas?(): Promise<void>;
  balance(token: string): Promise<bigint>;
  quote(token: string, amount: bigint): Promise<QuoteResult>;
  /** Prepare one approval or swap; the caller journals it before broadcast. */
  prepare(
    token: string,
    quote: Quote,
    /** EVM: the lowest nonce the send may use (see nonceFloor). */
    nonceFloor?: number,
    assertLease?: () => Promise<void>,
  ): Promise<PreparedSend>;
  broadcast(rawTx: string): Promise<void>;
  /** `replacements`: the journaled same-nonce replacements of the row. */
  status(
    row: ConversionRow,
    replacements?: readonly SendReplacement[],
  ): Promise<SendStatus>;
  /**
   * EVM only. Signs one same-nonce replacement of an unmined send with a
   * bounded higher fee, or says why the send must wait. It never broadcasts.
   */
  replace?(
    row: ConversionRow,
    replacements: readonly SendReplacement[],
    /** Recheck ownership immediately before creating signed bytes. */
    assertLease: () => Promise<void>,
  ): Promise<ReplacementResult>;
  /**
   * Issue #905: a vault keeps its 2% fees until someone calls the
   * permissionless claim (EVM `claimFees()`, Solana `claim_fees`). Its
   * methods let a recovery run claim them for this fee wallet before it reads
   * the wallet's balances.
   */
  vaultFees?: VaultFeeClient;
}

/**
 * One ordinary or private bounty vault named by a reviewed D1 project
 * manifest. `deployment` is that manifest's deployment record, exactly as
 * reviewed; Solana verifies the program, project and fee recipient against it
 * before a claim.
 */
export interface FeeVault {
  vault: string;
  projectId: string;
  payoutPolicy: "ordinary" | "security-bounty";
  deployment: Readonly<Record<string, unknown>>;
}

/** Fees accrued in one vault whose fee recipient is this fee wallet. */
export interface AccruedFees {
  asset: string;
  amount: bigint;
}

export interface VaultFeeClient {
  /** Null when nothing accrued or the vault pays another fee recipient. */
  accrued(vault: FeeVault): Promise<AccruedFees | null>;
  /** Estimated network fee of the claim in USDC micro-units; null if unpriced. */
  claimCostMicro(vault: FeeVault): Promise<bigint | null>;
  /**
   * Signs and sends the claim, waits until it is included successfully and
   * verifies that the fee wallet received the fee.
   */
  claim(
    vault: FeeVault,
    recordClaim?: (claim: {
      txId: string;
      rawTx: string;
      evmNonce: number | null;
      expiresAt: number | null;
      amount: bigint;
      nativeGasId?: string;
    }) => Promise<void>,
    /** EVM: the lowest nonce the claim may use (see nonceFloor). */
    nonceFloor?: number,
    /** Recheck the existing network lease before signing and broadcast. */
    assertLease?: () => Promise<void>,
    /** Recheck the final prepared claim fee against this verified USDC value. */
    valueMicro?: bigint,
  ): Promise<{ txId: string }>;
}

export interface ConversionStore {
  acquireLock(network: Network, runId: string, now: Date): Promise<boolean>;
  /**
   * Drops the lock only while this run still owns an unexpired lease; a run
   * that lost its lease never deletes the successor's lock.
   */
  releaseLock(network: Network, runId: string, now: Date): Promise<void>;
  /**
   * Extends this run's own lease. False when the lease lapsed or was taken
   * over: another run may own the network, so this one stops signing.
   */
  renewLock(network: Network, runId: string, now: Date): Promise<boolean>;
  /** Live rows still waiting on chain: submitted, unknown and abandoned quotes. */
  openRows(network: Network): Promise<ConversionRow[]>;
  insert(
    row: ConversionRow,
    lease?: { runId: string; now: Date },
  ): Promise<void>;
  update(
    id: string,
    fields: Partial<Omit<ConversionRow, "id" | "createdAt">>,
  ): Promise<void>;
  /** Quoted value of live sends created since `since`, in micro-units. */
  liveValueSince(network: Network, since: string): Promise<bigint>;
  latest(network: Network, token: string): Promise<ConversionRow | null>;
  /** Only finalized native fee receipts, less committed spending and gas. */
  nativeFeeBalance?(
    network: Network,
    token: string,
    feeWallet: string,
  ): Promise<bigint>;
  /** Journaled same-nonce replacements of one row, in attempt order. */
  replacements(conversionId: string): Promise<SendReplacement[]>;
  insertReplacement(
    replacement: SendReplacement,
    runId: string,
    now: Date,
  ): Promise<boolean>;
}

export type RunTrigger = "receipts" | "recovery";

export interface RunDependencies {
  mode: Exclude<Mode, "off">;
  /** Defaults to `recovery`: every candidate is evaluated. */
  trigger?: RunTrigger;
  limits: Limits;
  store: ConversionStore;
  now: () => Date;
  randomId: () => string;
  /** Candidate tokens named by D1 project manifests for this network. */
  projectTokens: (config: NetworkConfig) => Promise<string[]>;
  /** Escrow vaults named by D1 project manifests for this network. */
  projectVaults?: (config: NetworkConfig) => Promise<FeeVault[]>;
  client: (config: NetworkConfig, runId: string) => ChainClient;
  log: (event: Record<string, unknown>) => void;
}

export interface NetworkRunResult {
  network: Network;
  /**
   * `not_converted`: the network retains received assets, so nothing is
   * quoted or signed and received fees stay in the fee wallet.
   */
  status: "ran" | "locked" | "not_converted";
  reconciled: number;
  records: Record<ConversionState, number>;
  /** Vaults whose accrued fees this run moved into the fee wallet. */
  claimed: number;
}

const QUOTE_ABANDON_MS = 60 * 60 * 1000;
/**
 * How long the latest attempt of an EVM send must stay unmined before a
 * same-nonce fee replacement may be signed (owner decision of 25 October
 * 2026). A claim already waits about one minute for its receipt.
 */
export const REPLACEMENT_WAIT_MS = 3 * 60 * 1000;
const RESCALE_ATTEMPTS = 3;
/**
 * How long a run may go without renewing its lease. A run renews at a chunk
 * boundary once this much time has passed, so a chunk that starts always has
 * more than LOCK_MS - RUN_BUDGET_MS of lease left; that margin must cover one
 * send (two receipt waits plus quote, build and RPC). Half the lease leaves
 * seven minutes for a send that takes about two.
 */
export const RUN_BUDGET_MS = LOCK_MS / 2;

/**
 * Bounded, single-line error text for D1 and logs. RPC URLs can carry a
 * provider API key, so URLs and echoed request bodies are removed.
 */
export function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text
      .split(/Request body:/u)[0]
      .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/giu, "<url>")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 400) || "unknown error"
  );
}

export function impactWithin(quote: Quote, limits: Limits): boolean {
  return (
    quote.priceImpactBps !== null &&
    quote.priceImpactBps <= limits.maxPriceImpactBps
  );
}

/** The aggregator minimum must stay within the configured slippage of its quote. */
export function slippageWithin(quote: Quote, limits: Limits): boolean {
  const floor =
    (quote.amountOut * BigInt(10_000 - limits.maxSlippageBps)) / 10_000n;
  return (
    quote.amountOut > 0n &&
    quote.minAmountOut >= floor &&
    quote.minAmountOut <= quote.amountOut
  );
}

async function reconcile(
  row: ConversionRow,
  client: ChainClient,
  deps: RunDependencies,
  runId: string,
  assertLease: () => Promise<void>,
): Promise<boolean> {
  const now = deps.now();
  if (row.approvalTxId !== null && row.rawTx === null && row.txId === null) {
    // Older versions kept only the approval hash and could mark a timeout
    // failed. Never invent its bytes or use a higher nonce to bypass it.
    const status = await client.status({
      ...row,
      kind: "approval",
      txId: row.approvalTxId,
      expiresAt: null,
    });
    return status.kind === "finalized" || status.kind === "failed";
  }
  if (row.state === "quoted") {
    // A live quote that never reached a signed send is safe to close: no
    // transaction bytes exist for it.
    if (now.getTime() - Date.parse(row.createdAt) > QUOTE_ABANDON_MS) {
      await deps.store.update(row.id, {
        state: "failed",
        reason: "run ended before signing",
        updatedAt: now.toISOString(),
      });
      return true;
    }
    return false;
  }
  const replacements = client.replace
    ? await deps.store.replacements(row.id)
    : [];
  const status = await client.status(row, replacements);
  const at = deps.now().toISOString();
  switch (status.kind) {
    case "pending":
      if (!status.mined)
        await replaceSend(row, replacements, client, deps, runId, assertLease);
      return false;
    case "finalized": {
      // The verified receipt is the credit; this balance is extra evidence.
      const after = await client
        .balance(row.targetToken)
        .then((value) => value.toString())
        .catch((error: unknown) => {
          deps.log({
            event: "fee_balance_unavailable",
            network: row.network,
            token: row.targetToken,
            error: message(error),
          });
          return null;
        });
      const below =
        row.minAmountOut !== null &&
        status.amountOut < BigInt(row.minAmountOut);
      await deps.store.update(row.id, {
        state: "finalized",
        amountOut: status.amountOut.toString(),
        targetBalanceAfter: after,
        finalizedAt: at,
        updatedAt: at,
        reason: below ? "finalized below the signed minimum" : null,
        landedTxId: status.txId ?? row.txId,
      });
      deps.log({
        event:
          row.kind === "claim"
            ? "fee_claim_finalized"
            : row.kind === "approval"
              ? "fee_approval_finalized"
              : "fee_conversion_finalized",
        network: row.network,
        token: row.token,
        txId: status.txId ?? row.txId,
        amountOut: status.amountOut.toString(),
      });
      return true;
    }
    case "failed":
      await deps.store.update(row.id, {
        state: "failed",
        reason: status.reason,
        updatedAt: at,
        // A reverted attempt landed; other failures have no landed send.
        ...(status.txId ? { landedTxId: status.txId } : {}),
      });
      return true;
    case "rebroadcast":
      // A restart first delivers the exact journaled attempt, even after the
      // replacement wait elapsed. An unknown response never proves refusal.
      await assertLease();
      try {
        await client.broadcast(status.rawTx ?? (row.rawTx as string));
        await deps.store.update(row.id, {
          state: "submitted",
          reason: null,
          updatedAt: at,
        });
      } catch (error) {
        await deps.store.update(row.id, {
          state: "unknown",
          reason: `rebroadcast: ${message(error)}`,
          updatedAt: at,
        });
        // A definite node fee-cap refusal permits the next bounded step.
        // Transport failure or any other uncertain result keeps these bytes.
        if (error instanceof FeeCapTooLowError)
          await replaceSend(
            row,
            replacements,
            client,
            deps,
            runId,
            assertLease,
          );
      }
      return false;
  }
}

/**
 * Same-nonce fee replacement (owner decision of 25 October 2026). Live mode
 * only. When the latest attempt stayed unmined for REPLACEMENT_WAIT_MS, the
 * chain client may sign one replacement with the same nonce, recipient,
 * calldata and value and a bounded higher fee. The replacement is journaled
 * before it is broadcast, so a restart rebroadcasts it instead of signing
 * another. Returns true when a replacement was journaled.
 */
async function replaceSend(
  row: ConversionRow,
  replacements: readonly SendReplacement[],
  client: ChainClient,
  deps: RunDependencies,
  runId: string,
  assertLease: () => Promise<void>,
): Promise<boolean> {
  if (
    deps.mode !== "live" ||
    !client.replace ||
    row.mode !== "live" ||
    row.evmNonce === null ||
    row.rawTx === null
  )
    return false;
  const last = replacements.at(-1)?.createdAt ?? row.submittedAt;
  if (
    last === null ||
    deps.now().getTime() - Date.parse(last) < REPLACEMENT_WAIT_MS
  )
    return false;
  await assertLease();
  const result = await client.replace(row, replacements, assertLease);
  if ("wait" in result) {
    deps.log({
      event: "fee_send_waiting",
      network: row.network,
      kind: row.kind ?? "conversion",
      token: row.token,
      txId: row.txId,
      attempts: replacements.length,
      reason: result.wait,
    });
    return false;
  }
  await assertLease();
  const at = deps.now().toISOString();
  const replacement: SendReplacement = {
    id: deps.randomId(),
    conversionId: row.id,
    network: row.network,
    attempt: replacements.length + 1,
    evmNonce: row.evmNonce,
    txId: result.txId,
    rawTx: result.rawTx,
    maxFeePerGas: result.maxFeePerGas.toString(),
    maxPriorityFeePerGas: result.maxPriorityFeePerGas.toString(),
    nativeGasId: result.nativeGasId,
    createdAt: at,
  };
  // Journal before broadcast: after a restart the next run finds this
  // attempt and rebroadcasts its bytes instead of signing another one.
  if (!(await deps.store.insertReplacement(replacement, runId, deps.now())))
    throw new Error("Replacement lost its lease or pending attempt");
  await assertLease();
  try {
    await client.broadcast(result.rawTx);
    await deps.store.update(row.id, {
      state: "submitted",
      reason: null,
      updatedAt: at,
    });
  } catch (error) {
    await deps.store.update(row.id, {
      state: "unknown",
      reason: `replacement broadcast: ${message(error)}`,
      updatedAt: at,
    });
  }
  deps.log({
    event: "fee_send_replaced",
    network: row.network,
    kind: row.kind ?? "conversion",
    token: row.token,
    txId: row.txId,
    replacementTxId: result.txId,
    attempt: replacement.attempt,
    maxFeePerGas: replacement.maxFeePerGas,
    maxPriorityFeePerGas: replacement.maxPriorityFeePerGas,
  });
  return true;
}

/**
 * The lowest EVM nonce a new send may use: one above every open journaled
 * send (`submitted` or `unknown`), including legacy approval hashes. A node that dropped a stuck send reports
 * its nonce as free; a new send must not take it, or the two would outbid
 * each other through their fee replacements.
 */
async function nonceFloor(
  network: Network,
  store: ConversionStore,
): Promise<number> {
  let floor = 0;
  for (const row of await store.openRows(network))
    if (
      (row.state === "submitted" ||
        row.state === "unknown" ||
        (row.approvalTxId !== null &&
          row.rawTx === null &&
          row.txId === null)) &&
      row.evmNonce !== null &&
      row.evmNonce >= floor
    )
      floor = row.evmNonce + 1;
  return floor;
}

function emptyRecords(): Record<ConversionState, number> {
  return {
    quoted: 0,
    pending: 0,
    skipped: 0,
    no_route: 0,
    submitted: 0,
    finalized: 0,
    failed: 0,
    unknown: 0,
  };
}

export async function runNetwork(
  config: NetworkConfig,
  deps: RunDependencies,
): Promise<NetworkRunResult> {
  const runId = deps.randomId();
  const result: NetworkRunResult = {
    network: config.network,
    status: "ran",
    reconciled: 0,
    records: emptyRecords(),
    claimed: 0,
  };
  const acquiredAt = deps.now();
  let renewedAt = acquiredAt.getTime();
  // Replaced with false when the lease lapses or another run takes it over.
  let ownsLock = true;
  if (!(await deps.store.acquireLock(config.network, runId, acquiredAt))) {
    return { ...result, status: "locked" };
  }
  try {
    // The lease must cover every send this run starts. Renew before a chunk
    // once the interval has passed; a renewal that fails means the lease
    // lapsed or another run took it over, so no send may be signed here.
    const leased = async (force = false) => {
      const at = deps.now();
      if (ownsLock && (force || at.getTime() - renewedAt >= RUN_BUDGET_MS)) {
        ownsLock = await deps.store.renewLock(config.network, runId, at);
        if (!ownsLock)
          deps.log({
            event: "fee_conversion_lock_lost",
            network: config.network,
          });
        else renewedAt = at.getTime();
      }
      return ownsLock;
    };

    const assertLease = async () => {
      if (!(await leased(true))) throw new Error("Fee conversion lock lost");
    };
    const client = deps.client(config, runId);
    await client.reconcileNativeGas?.();
    const blocked = new Set<string>();
    // Reconciliation may rebroadcast exact bytes in dry_run. New replacement
    // signatures require live mode and a freshly checked network lease.
    for (const row of await deps.store.openRows(config.network)) {
      try {
        if (await reconcile(row, client, deps, runId, assertLease))
          result.reconciled += 1;
        else blocked.add(row.token);
      } catch (error) {
        blocked.add(row.token);
        deps.log({
          event: "fee_conversion_reconcile_error",
          network: config.network,
          token: row.token,
          error: message(error),
        });
      }
    }

    const usdc = config.definition.usdc;
    if (usdc === null) {
      // No conversion target is configured: retain each received asset unchanged.
      deps.log({
        event: "fee_conversion_not_converted",
        network: config.network,
        reason: "received assets retained without conversion",
      });
      result.status = "not_converted";
      return result;
    }
    const candidates = [
      ...new Set([...(await deps.projectTokens(config)), ...config.allowlist]),
    ].filter((token) => token !== usdc);

    // A recovery scan first moves fees accrued in the network's vaults into
    // the fee wallet, so the balance reads below see them as a receipt.
    if (client.vaultFees && deps.projectVaults && deps.trigger !== "receipts")
      result.claimed = await claimVaultFees(
        await deps.projectVaults(config),
        usdc,
        config,
        client,
        client.vaultFees,
        deps,
        leased,
        blocked,
        runId,
        assertLease,
      );

    const since = new Date(
      deps.now().getTime() - 24 * 60 * 60 * 1000,
    ).toISOString();
    let dayValue = await deps.store.liveValueSince(config.network, since);
    let runValue = 0n;

    for (const token of candidates) {
      if (blocked.has(token)) continue;
      if (!(await leased())) break;
      try {
        let balance = await client.balance(token);
        if (isNativeAssetAddress(config.network, token)) {
          if (!deps.store.nativeFeeBalance)
            throw new Error("Native fees need finalized receipt accounting");
          const received = await deps.store.nativeFeeBalance(
            config.network,
            token,
            config.feeWallet,
          );
          // Pay the next send's worst-case cost from earned fees as well;
          // a wallet gas top-up never increases the amount sold.
          const reserve = BigInt(config.nativeBudget?.perTransaction ?? "0");
          const available = received > reserve ? received - reserve : 0n;
          if (available < balance) balance = available;
        }
        if (balance === 0n) continue;
        if (deps.trigger === "receipts") {
          const latest = await deps.store.latest(config.network, token);
          // A finalized swap spent the earlier balance. An equal balance can
          // therefore be a new receipt, and must be evaluated again.
          if (
            latest?.state !== "finalized" &&
            latest?.tokenBalanceBefore === balance.toString()
          )
            continue;
        }
        const outcome = await convert(
          token,
          balance,
          usdc,
          config,
          client,
          deps,
          {
            runId,
            runValue,
            dayValue,
          },
          assertLease,
        );
        result.records[outcome.state] += 1;
        if (outcome.committedMicro > 0n) {
          runValue += outcome.committedMicro;
          dayValue += outcome.committedMicro;
        }
      } catch (error) {
        deps.log({
          event: "fee_conversion_error",
          network: config.network,
          token,
          error: message(error),
        });
      }
    }
  } finally {
    await deps.store.releaseLock(config.network, runId, deps.now());
  }
  return result;
}

/**
 * Claims each vault's accrued fees when the claim is worth its gas: the fee
 * value, quoted in USDC like a conversion, must reach the minimum conversion
 * value and the gas-cost multiple of the claim's own network fee. A smaller
 * amount stays in the vault and accrues until it does. Dry run only reports.
 * A claim moves fees only to the vault's immutable fee recipient, so it never
 * counts against the conversion caps. Returns the number of vaults claimed.
 */
async function claimVaultFees(
  vaults: readonly FeeVault[],
  usdc: string,
  config: NetworkConfig,
  client: ChainClient,
  fees: VaultFeeClient,
  deps: RunDependencies,
  leased: () => Promise<boolean>,
  blocked: Set<string>,
  runId: string,
  assertLease: () => Promise<void>,
): Promise<number> {
  const { limits } = deps;
  let claimed = 0;
  for (const vault of vaults) {
    if (!(await leased())) break;
    const report = (event: string, fields: Record<string, unknown>) =>
      deps.log({
        event,
        network: config.network,
        vault: vault.vault,
        ...fields,
      });
    let claimId: string | null = null;
    try {
      const accrued = await fees.accrued(vault);
      if (!accrued) continue;
      if (blocked.has(accrued.asset)) continue;
      const amount = accrued.amount.toString();
      let value = accrued.amount;
      if (accrued.asset !== usdc) {
        const quote = await client.quote(accrued.asset, accrued.amount);
        if ("noRoute" in quote) {
          report("fee_claim_skipped", { amount, reason: quote.noRoute });
          continue;
        }
        value = quote.amountOut;
      }
      const cost = await fees.claimCostMicro(vault);
      const reason =
        cost === null
          ? "claim network fee could not be priced"
          : value < limits.minValueMicro
            ? "below the minimum conversion value"
            : value < cost * limits.gasMultiple
              ? "below the gas-cost multiple"
              : null;
      if (reason) {
        report("fee_claim_skipped", { amount, reason });
        continue;
      }
      if (deps.mode === "dry_run") {
        report("fee_claim_quoted", { amount, valueMicro: value.toString() });
        continue;
      }
      const floor = await nonceFloor(config.network, deps.store);
      const recordClaim: Parameters<VaultFeeClient["claim"]>[1] = async (
        send,
      ) => {
        const at = deps.now().toISOString();
        const claimRow: ConversionRow = {
          id: deps.randomId(),
          kind: "claim",
          runId,
          network: config.network,
          mode: "live",
          feeWallet: config.feeWallet,
          token: accrued.asset,
          targetToken: accrued.asset,
          amountIn: send.amount.toString(),
          route: null,
          quoteAmountOut: null,
          minAmountOut: null,
          // The claimed fee's USDC value bounds any later fee replacement.
          quoteValueMicro: Number(value),
          quote: JSON.stringify(vault),
          priceImpactBps: null,
          approvalTxId: null,
          txId: send.txId,
          nativeGasId: send.nativeGasId,
          rawTx: send.rawTx,
          evmNonce: send.evmNonce,
          expiresAt: send.expiresAt,
          amountOut: null,
          tokenBalanceBefore: null,
          targetBalanceBefore: null,
          targetBalanceAfter: null,
          state: "submitted",
          reason: null,
          createdAt: at,
          updatedAt: at,
          submittedAt: at,
          finalizedAt: null,
        };
        await assertLease();
        await deps.store.insert(claimRow, { runId, now: deps.now() });
        claimId = claimRow.id;
        blocked.add(accrued.asset);
      };
      await assertLease();
      const { txId } = await fees.claim(
        vault,
        recordClaim,
        floor,
        assertLease,
        value,
      );
      claimed += 1;
      report("fee_claim_included", { amount, txId });
    } catch (error) {
      if (claimId)
        await deps.store.update(claimId, {
          state: "unknown",
          reason: `claim: ${message(error)}`,
          updatedAt: deps.now().toISOString(),
        });
      report("fee_claim_error", { error: message(error) });
    }
  }
  return claimed;
}

interface Budget {
  runId: string;
  runValue: bigint;
  dayValue: bigint;
}

async function convert(
  token: string,
  balance: bigint,
  usdc: string,
  config: NetworkConfig,
  client: ChainClient,
  deps: RunDependencies,
  budget: Budget,
  assertLease: () => Promise<void>,
): Promise<{ state: ConversionState; committedMicro: bigint }> {
  const { limits } = deps;
  const at = () => deps.now().toISOString();
  const unbalanced = (): ConversionRow => ({
    id: deps.randomId(),
    runId: budget.runId,
    network: config.network,
    mode: deps.mode,
    feeWallet: config.feeWallet,
    token,
    targetToken: usdc,
    amountIn: balance.toString(),
    route: null,
    quoteAmountOut: null,
    minAmountOut: null,
    quoteValueMicro: null,
    priceImpactBps: null,
    quote: null,
    approvalTxId: null,
    txId: null,
    rawTx: null,
    evmNonce: null,
    expiresAt: null,
    amountOut: null,
    tokenBalanceBefore: balance.toString(),
    targetBalanceBefore: null,
    targetBalanceAfter: null,
    state: "quoted",
    reason: null,
    createdAt: at(),
    updatedAt: at(),
    submittedAt: null,
    finalizedAt: null,
  });

  const record = async (
    row: ConversionRow,
  ): Promise<{ state: ConversionState; committedMicro: bigint }> => {
    // A token stuck below the minimum would otherwise add the same row every
    // run; repeat only when the amount or the reason changes.
    if (
      row.state === "pending" ||
      row.state === "skipped" ||
      row.state === "no_route"
    ) {
      const last = await deps.store.latest(config.network, token);
      if (
        last &&
        last.state === row.state &&
        last.reason === row.reason &&
        last.amountIn === row.amountIn &&
        last.mode === row.mode
      )
        return { state: row.state, committedMicro: 0n };
    }
    await deps.store.insert(row);
    return { state: row.state, committedMicro: 0n };
  };

  const targetBefore = (await client.balance(usdc)).toString();
  const base = (): ConversionRow => ({
    ...unbalanced(),
    targetBalanceBefore: targetBefore,
  });
  let quoted = await client.quote(token, balance);
  if ("noRoute" in quoted)
    return record({ ...base(), state: "no_route", reason: quoted.noRoute });

  // Fit the order inside the remaining run and day caps by scaling the input
  // once and quoting again; never exceed either cap.
  const remaining = (() => {
    const run = limits.runCapMicro - budget.runValue;
    const day = limits.dailyCapMicro - budget.dayValue;
    return run < day ? run : day;
  })();
  let amount = balance;
  // Output is not linear in input for a large order, so rescale toward 98%
  // of the remaining cap a bounded number of times.
  for (
    let attempt = 0;
    attempt < RESCALE_ATTEMPTS &&
    quoted.amountOut > remaining &&
    remaining > 0n;
    attempt++
  ) {
    amount = (amount * remaining * 98n) / (quoted.amountOut * 100n);
    if (amount > 0n) {
      const requoted = await client.quote(token, amount);
      if ("noRoute" in requoted)
        return record({
          ...base(),
          amountIn: amount.toString(),
          state: "no_route",
          reason: requoted.noRoute,
        });
      quoted = requoted;
    } else break;
  }
  const quote = quoted;
  const row: ConversionRow = {
    ...base(),
    amountIn: amount.toString(),
    route: quote.route,
    quoteAmountOut: quote.amountOut.toString(),
    minAmountOut: quote.minAmountOut.toString(),
    quoteValueMicro: Number(quote.amountOut),
    priceImpactBps: quote.priceImpactBps,
    quote: JSON.stringify(quote.summary).slice(0, 8192),
  };
  const skip = (reason: string) => record({ ...row, state: "skipped", reason });
  // The dust threshold (PRD section 11): the fee is not yet worth converting,
  // so it waits in the wallet and shows as pending until a later receipt
  // lifts it over.
  const pending = (reason: string) =>
    record({ ...row, state: "pending", reason });

  if (remaining <= 0n || amount === 0n)
    return skip(
      limits.runCapMicro - budget.runValue <= 0n
        ? "per-run value cap reached"
        : "daily value cap reached",
    );
  if (quote.amountOut > remaining)
    return skip("quote exceeds the remaining value cap");
  if (quote.amountOut < limits.minValueMicro)
    return pending("below the minimum conversion value");
  if (quote.amountOut < quote.gasCostMicro * limits.gasMultiple)
    return pending("below the gas-cost multiple");
  if (!impactWithin(quote, limits))
    return skip(
      quote.priceImpactBps === null
        ? "price impact unknown"
        : "price impact above the cap",
    );
  if (!slippageWithin(quote, limits))
    return skip("minimum output outside the slippage limit");

  if (deps.mode === "dry_run") {
    // Count dry-run quotes against the run cap so the record shows what a
    // live run would have sent.
    await record(row);
    return { state: "quoted", committedMicro: quote.amountOut };
  }

  let prepared: PreparedSend;
  try {
    const floor = await nonceFloor(config.network, deps.store);
    await assertLease();
    prepared = await client.prepare(token, quote, floor, assertLease);
    // Match migration 0078: at most 128 KiB encoded as hex plus its prefix.
    if (prepared.rawTx.length > 262146)
      throw new Error("signed transaction exceeds the storage limit");
    await assertLease();
  } catch (error) {
    await record({
      ...row,
      state: "failed",
      reason: `prepare: ${message(error)}`,
      updatedAt: at(),
    });
    return { state: "failed", committedMicro: 0n };
  }
  const approval = prepared.kind === "approval";
  // One row per signed intent; approval bytes are never overwritten by a swap.
  // The pending-token index prevents a second intent until this one resolves.
  await deps.store.insert(
    {
      ...row,
      kind: approval ? "approval" : "conversion",
      state: "submitted",
      txId: prepared.txId,
      nativeGasId: prepared.nativeGasId,
      rawTx: prepared.rawTx,
      evmNonce: prepared.evmNonce,
      expiresAt: prepared.expiresAt,
      approvalTxId: prepared.approvalTxId,
      minAmountOut: approval ? null : prepared.minAmountOut.toString(),
      submittedAt: at(),
      updatedAt: at(),
    },
    { runId: budget.runId, now: deps.now() },
  );
  await assertLease();
  const committedMicro = approval ? 0n : quote.amountOut;
  try {
    await client.broadcast(prepared.rawTx);
  } catch (error) {
    await deps.store.update(row.id, {
      state: "unknown",
      reason: `broadcast: ${message(error)}`,
      updatedAt: at(),
    });
    return { state: "unknown", committedMicro };
  }
  deps.log({
    event: approval ? "fee_approval_submitted" : "fee_conversion_submitted",
    network: config.network,
    token,
    txId: prepared.txId,
    amountIn: amount.toString(),
    minAmountOut: prepared.minAmountOut.toString(),
  });
  return { state: "submitted", committedMicro };
}
