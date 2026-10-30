/**
 * slop-fee-converter: a cron Worker that converts project-token fees received
 * in each network fee wallet to that network's Circle USDC, inside the same
 * wallet (PRD section 6, TOK-07, MVP-07c). It has no HTTP route. On a vault
 * it calls only the permissionless fee claim of reviewed vaults (EVM
 * claimFees(), Solana claim_fees), which moves accrued fees to their fee
 * recipient (issue #905; owner decision of 24 October 2026). It never touches
 * obligations or payments, and no payout waits on it.
 *
 * The cron fires every minute. Most runs are `receipts` runs that convert
 * only tokens whose fee-wallet balance changed; every RECOVERY_SCAN_MINUTES
 * the run is a full `recovery` scan.
 */

import {
  type FeeConverterConfig,
  type FeeConverterEnv,
  isTokenAddress,
  type Network,
  type NetworkConfig,
  networkKey,
  parseConfig,
} from "./config";
import {
  type ChainClient,
  message,
  type NetworkRunResult,
  type RunTrigger,
  runNetwork,
} from "./core";
import { createEvmClient } from "./evm";
import { NativeGasJournal } from "./native-gas";
import { createSolanaClient } from "./solana";
import {
  D1ConversionStore,
  type FeeD1Database,
  projectRewardTokens,
  projectVaults,
} from "./store";

export interface Env extends FeeConverterEnv {
  FEE_DB: FeeD1Database;
}

/** Minutes between full recovery scans; the other cron minutes check receipts. */
export const RECOVERY_SCAN_MINUTES = 15;

/** The run kind for a cron tick: a full scan on each recovery minute. */
export function triggerAt(scheduledTime: number): RunTrigger {
  return new Date(scheduledTime).getUTCMinutes() % RECOVERY_SCAN_MINUTES === 0
    ? "recovery"
    : "receipts";
}

export function chainClient(
  env: FeeConverterEnv,
  config: FeeConverterConfig,
  network: NetworkConfig,
  overrides: {
    fetch?: typeof fetch;
    localBlockhash?: boolean;
    localGenesisHash?: string;
    nativeGas?: NativeGasJournal;
    now?: () => Date;
  } = {},
): ChainClient {
  // dry_run never loads a key, so it cannot sign even when one is present.
  // A network without a verified USDC target never signs either: it only
  // reconciles recorded sends, which needs no key.
  const signs = config.mode === "live" && network.definition.usdc !== null;
  if (signs && (!network.nativeBudget || !overrides.nativeGas))
    throw new Error(
      "Live fee signing needs native limits and the durable budget journal",
    );
  const secret = signs ? networkKey(env, network.network) : undefined;
  if (signs && secret === undefined)
    throw new Error(
      `live mode needs FEE_WALLET_KEY_${network.network.toUpperCase()}`,
    );
  return network.definition.family === "evm"
    ? createEvmClient({
        config: network,
        limits: config.limits,
        kyberClientId: config.kyberClientId,
        privateKey: secret,
        fetch: overrides.fetch,
        nativeGas: overrides.nativeGas,
        now: overrides.now,
      })
    : createSolanaClient({
        config: network,
        limits: config.limits,
        jupiterApiUrl: config.jupiterApiUrl,
        jupiterApiKey: config.jupiterApiKey,
        keypair: secret,
        fetch: overrides.fetch,
        localBlockhash: overrides.localBlockhash,
        localGenesisHash: overrides.localGenesisHash,
        recoveryRpcUrl: env.SOLANA_RECOVERY_RPC_URL,
        nativeGas: overrides.nativeGas,
      });
}

/** Project manifests store validated addresses; anything else is corrupt
 * registry data that must stop the run, not disappear from it. */
function storedAddress(network: Network, value: string): string {
  if (!isTokenAddress(network, value))
    throw new Error(`A stored ${network} project address is malformed`);
  return value;
}

export async function runOnce(
  env: Env,
  now: () => Date = () => new Date(),
  /** Local harnesses only; the scheduled handler never passes overrides. */
  overrides: Parameters<typeof chainClient>[3] = {},
  trigger: RunTrigger = "recovery",
): Promise<NetworkRunResult[]> {
  // Off is inert even when the rest of the configuration is incomplete.
  if ((env.FEE_CONVERTER_MODE ?? "off").trim() === "off") return [];
  const config = parseConfig(env);
  if (config.mode === "off") return [];
  const store = new D1ConversionStore(env.FEE_DB);
  const results: NetworkRunResult[] = [];
  const failures: Error[] = [];
  for (const network of config.networks) {
    try {
      results.push(
        await runNetwork(network, {
          mode: config.mode,
          trigger,
          limits: config.limits,
          store,
          now,
          randomId: () => crypto.randomUUID(),
          projectTokens: async (n) =>
            (
              await projectRewardTokens(
                env.FEE_DB,
                n.network,
                n.definition.escrowNetworks,
              )
            ).map((token) => storedAddress(n.network, token)),
          projectVaults: async (n) =>
            (await projectVaults(env.FEE_DB, n.definition.escrowNetworks)).map(
              (entry) => ({
                ...entry,
                vault: storedAddress(n.network, entry.vault),
              }),
            ),
          client: (n, runId) =>
            chainClient(env, config, n, {
              ...overrides,
              now,
              nativeGas: n.nativeBudget
                ? new NativeGasJournal(
                    env.FEE_DB,
                    n.network,
                    n.feeWallet,
                    runId,
                    n.nativeBudget,
                    now,
                  )
                : undefined,
            }),
          log: (event) => console.log(JSON.stringify(event)),
        }),
      );
    } catch (error) {
      // Attempt the other networks, but do not report this run as successful.
      const reason = message(error);
      failures.push(new Error(`${network.network}: ${reason}`));
      console.error(
        JSON.stringify({
          event: "fee_converter_network_error",
          network: network.network,
          error: reason,
        }),
      );
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `fee conversion failed on ${failures.length} networks`,
    );
  return results;
}

export default {
  async scheduled(
    controller: { scheduledTime: number } | undefined,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    const trigger = triggerAt(controller?.scheduledTime ?? Date.now());
    ctx.waitUntil(
      runOnce(env, undefined, undefined, trigger).then((results) =>
        console.log(
          JSON.stringify({ event: "fee_converter_run", trigger, results }),
        ),
      ),
    );
  },
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};
