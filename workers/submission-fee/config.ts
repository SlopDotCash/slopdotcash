/**
 * Submission-fee Worker configuration (PRD section 6, "Submission fee
 * deposits"). The contracts, tokens and kept-fee destinations come from the
 * reviewed tables in `src/lib/submission-fee.mjs`; the mode, RPC endpoints and
 * gas ceilings come from Worker vars. A missing or malformed value refuses the
 * run instead of guessing. `off` and `dry_run` never load a key.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  STANDING_DEPOSIT_CONTRACT,
  STANDING_DEPOSIT_LEDGER,
  STANDING_DEPOSIT_NETWORK,
  STANDING_DEPOSIT_START_BLOCK,
  standingDepositDeployed,
} from "../../src/lib/standing-deposit.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CHAIN_IDS,
  SUBMISSION_FEE_CONFIRMATIONS,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_START_BLOCKS,
  SUBMISSION_FEE_TOKENS,
  type SubmissionFeeTerms,
} from "../../src/lib/submission-fee.mjs";

export type Mode = "off" | "dry_run" | "live";

export interface SubmissionFeeEnv {
  SUBMISSION_FEE_MODE?: string;
  /** Optional private RPC endpoints; the public ones are the default. */
  RPC_URL_SUBMISSION_FEE_BASE?: string;
  RPC_URL_SUBMISSION_FEE_ROBINHOOD?: string;
  /** The most one resolve transaction may spend, and one UTC day's total. */
  SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI?: string;
  SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI?: string;
  /** Secret. Never logged, never stored in D1, never set in CI. */
  SUBMISSION_FEE_RESOLVER_KEY?: string;
}

export interface GasLimits {
  perTransactionWei: string;
  perDayWei: string;
}

export interface NetworkConfig {
  /** The ledger key: deposit, cursor, send and parked rows are keyed by it. */
  network: string;
  /**
   * The chain whose token, kept-to, chain id, confirmation and RPC tables
   * apply. It equals `network` for the per pull request contracts on Base
   * and Robinhood Chain; the standing deposit contract (operator decision,
   * 23 November 2026) is its own ledger on the Robinhood Chain tables.
   * Absent means `network`.
   */
  chain?: string;
  chainId: number;
  /** Lowercase address of the SubmissionDeposits contract. */
  contract: string;
  startBlock: number;
  rpcUrl: string;
  confirmations: number;
  scanPageBlocks: number;
  gas: GasLimits;
}

/** The official SLOP / USDG pool the rate is read from. */
export interface PriceSource {
  rpcUrl: string;
  chainId: number;
  /** Uniswap v4 StateView on Robinhood Chain. */
  stateView: string;
  poolId: string;
  label: string;
}

export interface SubmissionFeeConfig {
  mode: Mode;
  networks: NetworkConfig[];
  /** Networks whose contract is not deployed yet; nothing is read there. */
  unset: string[];
  terms: SubmissionFeeTerms;
  price: PriceSource;
}

// mainnet.base.org refuses eth_getLogs ("request limit reached", read from two
// networks on 19 November 2026), so the default Base endpoint is one that
// answers the 2,000-block page. A keyed endpoint in the optional secret
// RPC_URL_SUBMISSION_FEE_BASE replaces it.
const DEFAULT_RPC: Readonly<Record<string, string>> = Object.freeze({
  "base-mainnet": "https://base-rpc.publicnode.com",
  "robinhood-mainnet": "https://rpc.mainnet.chain.robinhood.com",
});
const RPC_VAR: Readonly<Record<string, keyof SubmissionFeeEnv>> = Object.freeze(
  {
    "base-mainnet": "RPC_URL_SUBMISSION_FEE_BASE",
    "robinhood-mainnet": "RPC_URL_SUBMISSION_FEE_ROBINHOOD",
  },
);

/**
 * The official pool (Uniswap v4, pool id below, USDG as currency0 and SLOP as
 * currency1) read through Uniswap's StateView on Robinhood Chain. README.md
 * records how both values were checked on chain.
 */
export const OFFICIAL_POOL = Object.freeze({
  chainId: 4663,
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  poolId: "0x18f3778f93a34c08d41a03e6b3a466a37ec0fd1b019e43f622927ba0c339838b",
  label: "uniswap-v4-stateview:robinhood-mainnet:slop-usdg",
});

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

/** The chain whose tables apply to a ledger. */
export function chainOf(network: Pick<NetworkConfig, "network" | "chain">) {
  return network.chain ?? network.network;
}

/** A deployed contract that is not in the reviewed fee tables. */
export interface StandingDeployment {
  contract: string | null;
  startBlock: number | null;
}

function wei(value: string | undefined, name: string): string {
  const text = (value ?? "").trim();
  if (
    !/^[1-9][0-9]{0,18}$/u.test(text) ||
    BigInt(text) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new TypeError(`${name} must be a positive whole number of wei`);
  return text;
}

function rpc(value: string | undefined, fallback: string, name: string) {
  const url = value?.trim() || fallback;
  if (!/^https?:\/\//u.test(url))
    throw new TypeError(`${name} must be an http(s) URL`);
  return url;
}

/** The reviewed chain id, confirmations and log page of a fee chain. */
function chainFacts(network: string) {
  const definition = (
    ESCROW_NETWORKS as Record<
      string,
      { chainId?: string; scanPageBlocks?: string } | undefined
    >
  )[network];
  const chainId = (SUBMISSION_FEE_CHAIN_IDS as Record<string, number>)[network];
  const confirmations = (
    SUBMISSION_FEE_CONFIRMATIONS as Record<string, number>
  )[network];
  const page = Number(definition?.scanPageBlocks);
  if (
    !definition ||
    Number(definition.chainId) !== chainId ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(confirmations) ||
    confirmations < 1 ||
    !SUBMISSION_FEE_KEPT_TO[network] ||
    !SUBMISSION_FEE_TOKENS[network]
  )
    throw new TypeError(`${network} is not a registered fee network`);
  return { chainId, confirmations, page };
}

export function parseMode(env: SubmissionFeeEnv): Mode {
  const mode = (env.SUBMISSION_FEE_MODE ?? "off").trim();
  if (mode !== "off" && mode !== "dry_run" && mode !== "live")
    throw new TypeError("SUBMISSION_FEE_MODE must be off, dry_run or live");
  return mode;
}

/**
 * Builds the run configuration. A network is served only when both its
 * contract address and its start block are set in the reviewed tables; one
 * without the other is refused. The gas ceilings are required in every mode
 * but `off`, so a `dry_run` proves the configuration `live` will use.
 *
 * `standing` is the standing deposit contract; it defaults to the reviewed
 * constants and only tests pass another.
 */
export function parseConfig(
  env: SubmissionFeeEnv,
  standing: StandingDeployment = {
    contract: STANDING_DEPOSIT_CONTRACT,
    startBlock: STANDING_DEPOSIT_START_BLOCK,
  },
): SubmissionFeeConfig {
  const mode = parseMode(env);
  const gas: GasLimits = {
    perTransactionWei: wei(
      env.SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI,
      "SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI",
    ),
    perDayWei: wei(
      env.SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI,
      "SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI",
    ),
  };
  if (BigInt(gas.perDayWei) < BigInt(gas.perTransactionWei))
    throw new TypeError(
      "The daily native limit must cover one transaction limit",
    );
  const networks: NetworkConfig[] = [];
  const unset: string[] = [];
  const contracts = SUBMISSION_FEE_CONTRACTS as Record<string, string | null>;
  const starts = SUBMISSION_FEE_START_BLOCKS as Record<string, number | null>;
  for (const network of Object.keys(contracts).sort()) {
    const contract = contracts[network];
    const startBlock = starts[network] ?? null;
    if (contract === null && startBlock === null) {
      unset.push(network);
      continue;
    }
    if (
      contract === null ||
      !ADDRESS.test(contract) ||
      !Number.isSafeInteger(startBlock) ||
      (startBlock as number) < 0
    )
      throw new TypeError(
        `${network} needs both a contract address and a start block`,
      );
    const facts = chainFacts(network);
    networks.push({
      network,
      chain: network,
      chainId: facts.chainId,
      contract: contract.toLowerCase(),
      startBlock: startBlock as number,
      rpcUrl: rpc(
        env[RPC_VAR[network]],
        DEFAULT_RPC[network],
        RPC_VAR[network],
      ),
      confirmations: facts.confirmations,
      scanPageBlocks: facts.page,
      gas,
    });
  }
  // The standing deposit contract: a ledger of its own on the Robinhood Chain
  // tables, read only once its address and start block are recorded. While
  // they are null the ledger does not exist and nothing is reported for it.
  if (standingDepositDeployed(standing.contract, standing.startBlock)) {
    const chain = STANDING_DEPOSIT_NETWORK;
    const facts = chainFacts(chain);
    const contract = (standing.contract as string).toLowerCase();
    // Two ledgers reading one contract would judge each deposit twice.
    if (networks.some((network) => network.contract === contract))
      throw new TypeError(
        "The standing deposit contract must differ from the fee contracts",
      );
    networks.push({
      network: STANDING_DEPOSIT_LEDGER,
      chain,
      chainId: facts.chainId,
      contract,
      startBlock: standing.startBlock as number,
      rpcUrl: rpc(env[RPC_VAR[chain]], DEFAULT_RPC[chain], RPC_VAR[chain]),
      confirmations: facts.confirmations,
      scanPageBlocks: facts.page,
      gas,
    });
  }
  return {
    mode,
    networks,
    unset,
    terms: {
      tokens: SUBMISSION_FEE_TOKENS,
      keptTo: SUBMISSION_FEE_KEPT_TO,
      burn: SUBMISSION_FEE_BURN,
    },
    price: {
      ...OFFICIAL_POOL,
      rpcUrl: rpc(
        env.RPC_URL_SUBMISSION_FEE_ROBINHOOD,
        DEFAULT_RPC["robinhood-mainnet"],
        "RPC_URL_SUBMISSION_FEE_ROBINHOOD",
      ),
    },
  };
}

/** The resolver signing secret; undefined when it is not configured. */
export function resolverKey(env: SubmissionFeeEnv): string | undefined {
  const value = env.SUBMISSION_FEE_RESOLVER_KEY;
  return value?.trim() ? value.trim() : undefined;
}
