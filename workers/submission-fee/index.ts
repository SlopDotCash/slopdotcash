/**
 * slop-submission-fee: a cron Worker for the refundable submission fee (PRD
 * section 6, "Submission fee deposits"). Every five minutes it reads the
 * SubmissionDeposits contract on Base and Robinhood Chain, records each
 * deposit, judges whether it pays for its pull request, marks that pull
 * request paid, and sends what Slopbot's row says is due: a refund, or a
 * kept fee. A deposit on Robinhood Chain can instead pay the SLOP deposit of
 * a private security report (PRD section 8); the Worker marks that report's
 * row paid and sends what the row says. Once an hour it reads the SLOP price
 * and keeps the SLOP rate. It has no HTTP route. Once the standing deposit
 * contract is recorded, it is read as a third ledger on Robinhood Chain whose
 * deposits pay contributors' standing rows (PRD section 5).
 *
 * `off` does nothing. `dry_run` reads and records, including the list it
 * would send, loads no key and signs nothing. `live` adds the resolver key.
 * A network whose contract is not deployed yet is skipped and reported.
 *
 * The Solana ledger (operator decision, 25 November 2026) has its own switch,
 * `SUBMISSION_FEE_SOLANA_MODE`, with the same three values and its own key.
 * It reads the `slop-submission-deposits` program's accounts instead of an
 * event log (`solana-core.ts`) and nothing at all while its mode is `off`
 * or the program id in `src/lib/submission-fee.mjs` is null. The rate job
 * is the EVM mode's.
 */

import { createEvmFeeChain, readPoolRate } from "./chain";
import type { NetworkConfig, SubmissionFeeConfig } from "./config";
import {
  chainOf,
  parseConfig,
  parseMode,
  parseSolanaConfig,
  parseSolanaMode,
  resolverKey,
  type SolanaFeeConfig,
  type SubmissionFeeEnv,
  solanaResolverSeed,
} from "./config";
import {
  type FeeChain,
  failureReason,
  labelled,
  message,
  type NetworkResult,
  runNetwork,
} from "./core";
import { type RateResult, runRate } from "./rate";
import {
  createSolanaFeeChain,
  type SolanaFeeChain,
  type SolanaLedgerConfig,
} from "./solana";
import { runSolanaLedger, type SolanaResult } from "./solana-core";
import {
  D1FeeStore,
  D1SolanaFeeStore,
  type SubmissionFeeD1Database,
} from "./store";

export interface Env extends SubmissionFeeEnv {
  SUBMISSION_FEE_DB: SubmissionFeeD1Database;
}

/** The Solana ledger's name where its own configuration could not be read. */
const SOLANA_LEDGER = "solana-mainnet";

export const DEPOSIT_CRON = "*/5 * * * *";
export const RATE_CRON = "7 * * * *";

/** Local harnesses only; the scheduled handler never passes overrides. */
export interface Overrides {
  fetch?: typeof fetch;
  /** Replaces the reviewed tables with a local deployment. */
  config?: (config: SubmissionFeeConfig) => SubmissionFeeConfig;
  chain?: (network: NetworkConfig, privateKey?: string) => FeeChain;
  /** Replaces the reviewed Solana tables with a local deployment. */
  solanaConfig?: (config: SolanaFeeConfig) => SolanaFeeConfig;
  solanaChain?: (network: SolanaLedgerConfig, seed?: string) => SolanaFeeChain;
  readPrice?: () => Promise<{ scaled: bigint; blockNumber: number }>;
  log?: (event: Record<string, unknown>) => void;
  /** Receives a network's own error, which the run result never carries. */
  onError?: (error: unknown) => void;
}

export type DepositRun =
  | { status: "off" }
  | { status: "items_table_missing"; unset: string[] }
  | {
      status: "ran";
      /** The EVM ledgers' mode. */
      mode: "off" | "dry_run" | "live";
      /** The Solana ledger's own mode; absent while it is off. */
      solanaMode?: "dry_run" | "live";
      /** Networks with no deployed contract: nothing was read there. */
      unset: string[];
      networks: (
        | NetworkResult
        | SolanaResult
        | { network: string; error: string; reason?: string }
      )[];
    };

const print = (event: Record<string, unknown>) =>
  console.log(JSON.stringify(event));

function configured(env: Env, overrides: Overrides) {
  const config = parseConfig(env);
  return overrides.config ? overrides.config(config) : config;
}

export async function runDeposits(
  env: Env,
  now: () => Date = () => new Date(),
  overrides: Overrides = {},
): Promise<DepositRun> {
  // Each family has its own switch. Off is inert even when the rest of that
  // family's configuration is incomplete.
  const evmMode = parseMode(env);
  const solanaMode = parseSolanaMode(env);
  if (evmMode === "off" && solanaMode === "off") return { status: "off" };
  const config = evmMode === "off" ? null : configured(env, overrides);
  // The Solana ledger's own configuration is read by itself: an error in it
  // (a missing endpoint or lamport limit) fails the Solana part of the run
  // only, and Base and Robinhood Chain still run.
  let solana: SolanaFeeConfig = { mode: solanaMode, ledger: null };
  let solanaFault: { error: unknown } | null = null;
  if (solanaMode !== "off")
    try {
      // Labelled, so the reported reason reads `config.solana/TypeError`.
      solana = labelled(
        {
          solana() {
            const parsed = parseSolanaConfig(env);
            return overrides.solanaConfig
              ? overrides.solanaConfig(parsed)
              : parsed;
          },
        },
        "config",
      ).solana();
    } catch (error) {
      solanaFault = { error };
    }
  if ((config === null || config.mode === "off") && solana.mode === "off")
    return { status: "off" };
  const log = overrides.log ?? print;
  const unset = [...(config?.unset ?? [])];
  // A switched-on Solana ledger with no published program reads nothing.
  if (solana.mode !== "off" && solana.ledger === null && solanaFault === null)
    unset.push(SOLANA_LEDGER);
  for (const network of unset)
    log({ event: "submission_fee_contract_unset", network });
  const store = labelled(new D1FeeStore(env.SUBMISSION_FEE_DB), "store");
  // Slopbot's table (migration 0141) names the pull requests a fee was asked
  // for. Without it no deposit can be matched, so nothing is read.
  if (!(await store.hasItems())) {
    log({ event: "submission_fee_items_table_missing" });
    return { status: "items_table_missing", unset };
  }
  const networks: (
    | NetworkResult
    | SolanaResult
    | { network: string; error: string; reason: string }
  )[] = [];
  const failed = (network: string, error: unknown) => {
    // One network's failure never stops the other; the next run retries.
    overrides.onError?.(error);
    // The reason names the step and the error classes only; see
    // `failureReason`.
    networks.push({
      network,
      error: message(error),
      reason: failureReason(error),
    });
  };
  if (config !== null && config.mode !== "off") {
    // dry_run never loads the key.
    const secret = config.mode === "live" ? resolverKey(env) : undefined;
    if (config.mode === "live" && config.networks.length > 0 && !secret)
      throw new TypeError("live mode needs SUBMISSION_FEE_RESOLVER_KEY");
    for (const network of config.networks) {
      try {
        networks.push(
          await runNetwork({
            mode: config.mode,
            network,
            terms: config.terms,
            store,
            chain: labelled(
              overrides.chain
                ? overrides.chain(network, secret)
                : createEvmFeeChain({
                    network,
                    privateKey: secret,
                    fetch: overrides.fetch,
                  }),
              "chain",
            ),
            now,
            randomId: () => crypto.randomUUID(),
            log,
            // The other ledgers on this chain share the resolver key and nonce.
            siblings: config.networks
              .filter(
                (other) =>
                  other.network !== network.network &&
                  chainOf(other) === chainOf(network),
              )
              .map((other) => other.network),
          }),
        );
      } catch (error) {
        failed(network.network, error);
      }
    }
  }
  if (solanaFault !== null) failed(SOLANA_LEDGER, solanaFault.error);
  if (solana.mode !== "off" && solana.ledger !== null) {
    const ledger = solana.ledger;
    try {
      // dry_run never loads the seed.
      const seed = solana.mode === "live" ? solanaResolverSeed(env) : undefined;
      if (solana.mode === "live" && !seed)
        throw new TypeError(
          "live mode needs SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
        );
      networks.push(
        await runSolanaLedger({
          mode: solana.mode,
          network: ledger,
          // The mainnet tables; a local rehearsal's mint and fee wallet come
          // with its ledger.
          terms: {
            ...(config?.terms ?? {}),
            tokens: {
              ...(config?.terms.tokens ?? {}),
              [ledger.network]: { usdc: ledger.mint },
            },
            keptTo: {
              ...(config?.terms.keptTo ?? {}),
              [ledger.network]: ledger.feeWallet,
            },
          },
          store: labelled(new D1SolanaFeeStore(env.SUBMISSION_FEE_DB), "store"),
          chain: labelled(
            overrides.solanaChain
              ? overrides.solanaChain(ledger, seed)
              : createSolanaFeeChain({
                  network: ledger,
                  seed,
                  fetch: overrides.fetch,
                }),
            "chain",
          ),
          now,
          randomId: () => crypto.randomUUID(),
          log,
        }),
      );
    } catch (error) {
      failed(ledger.network, error);
    }
  }
  return {
    status: "ran",
    mode: config?.mode ?? "off",
    ...(solana.mode === "off" ? {} : { solanaMode: solana.mode }),
    unset,
    networks,
  };
}

export async function runRates(
  env: Env,
  now: () => Date = () => new Date(),
  overrides: Overrides = {},
): Promise<RateResult | null> {
  if (parseMode(env) === "off") return null;
  const config = configured(env, overrides);
  if (config.mode === "off") return null;
  return runRate({
    store: new D1FeeStore(env.SUBMISSION_FEE_DB),
    price: config.price,
    readPrice:
      overrides.readPrice ??
      (() => readPoolRate({ ...config.price, fetch: overrides.fetch })),
    now,
    log: overrides.log ?? print,
  });
}

export default {
  async scheduled(
    controller: { scheduledTime: number; cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    const run =
      controller.cron === DEPOSIT_CRON
        ? runDeposits(env)
        : controller.cron === RATE_CRON
          ? runRates(env)
          : null;
    if (run === null) throw new Error("Unknown submission fee schedule");
    ctx.waitUntil(
      run
        .then((result) => {
          print({ event: "submission_fee_run", cron: controller.cron, result });
          if (
            result &&
            "networks" in result &&
            result.networks.some((network) => "error" in network)
          )
            throw new Error("submission_fee_operation_failed");
        })
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: "submission_fee_error",
              cron: controller.cron,
              error: message(error),
            }),
          );
          throw new Error(message(error));
        }),
    );
  },
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};
