/**
 * slop-submission-fee: a cron Worker for the refundable submission fee (PRD
 * section 6, "Submission fee deposits"). Every five minutes it reads the
 * SubmissionDeposits contract on Base and Robinhood Chain, records each
 * deposit, judges whether it pays for its pull request, marks that pull
 * request paid, and sends what Slopbot's row says is due: a refund, or a
 * kept fee. A deposit on Robinhood Chain can instead pay the SLOP deposit of
 * a private security report (PRD section 8); the Worker marks that report's
 * row paid and sends what the row says. Once an hour it reads the SLOP price
 * and keeps the SLOP rate. It has no HTTP route.
 *
 * `off` does nothing. `dry_run` reads and records, including the list it
 * would send, loads no key and signs nothing. `live` adds the resolver key.
 * A network whose contract is not deployed yet is skipped and reported.
 */

import { createEvmFeeChain, readPoolRate } from "./chain";
import type { NetworkConfig, SubmissionFeeConfig } from "./config";
import {
  parseConfig,
  parseMode,
  resolverKey,
  type SubmissionFeeEnv,
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
import { D1FeeStore, type SubmissionFeeD1Database } from "./store";

export interface Env extends SubmissionFeeEnv {
  SUBMISSION_FEE_DB: SubmissionFeeD1Database;
}

export const DEPOSIT_CRON = "*/5 * * * *";
export const RATE_CRON = "7 * * * *";

/** Local harnesses only; the scheduled handler never passes overrides. */
export interface Overrides {
  fetch?: typeof fetch;
  /** Replaces the reviewed tables with a local deployment. */
  config?: (config: SubmissionFeeConfig) => SubmissionFeeConfig;
  chain?: (network: NetworkConfig, privateKey?: string) => FeeChain;
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
      mode: "dry_run" | "live";
      /** Networks with no deployed contract: nothing was read there. */
      unset: string[];
      networks: (
        | NetworkResult
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
  // Off is inert even when the rest of the configuration is incomplete.
  if (parseMode(env) === "off") return { status: "off" };
  const config = configured(env, overrides);
  if (config.mode === "off") return { status: "off" };
  const log = overrides.log ?? print;
  for (const network of config.unset)
    log({ event: "submission_fee_contract_unset", network });
  const store = labelled(new D1FeeStore(env.SUBMISSION_FEE_DB), "store");
  // Slopbot's table (migration 0141) names the pull requests a fee was asked
  // for. Without it no deposit can be matched, so nothing is read.
  if (!(await store.hasItems())) {
    log({ event: "submission_fee_items_table_missing" });
    return { status: "items_table_missing", unset: config.unset };
  }
  // dry_run never loads the key.
  const secret = config.mode === "live" ? resolverKey(env) : undefined;
  if (config.mode === "live" && config.networks.length > 0 && !secret)
    throw new TypeError("live mode needs SUBMISSION_FEE_RESOLVER_KEY");
  const networks: (
    | NetworkResult
    | { network: string; error: string; reason: string }
  )[] = [];
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
        }),
      );
    } catch (error) {
      // One network's failure never stops the other; the next run retries.
      overrides.onError?.(error);
      // The reason names the step and the error classes only; see
      // `failureReason`.
      networks.push({
        network: network.network,
        error: message(error),
        reason: failureReason(error),
      });
    }
  }
  return { status: "ran", mode: config.mode, unset: config.unset, networks };
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
