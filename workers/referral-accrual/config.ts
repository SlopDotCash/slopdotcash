/**
 * Referral-accrual configuration. Every value comes from Worker vars or
 * secrets; a missing or malformed value refuses the run instead of guessing.
 * `off` and `dry_run` never load a key. `live` adds the poster, and is
 * refused unless the program flag, the distributor address, the token
 * address and the network are all set.
 */

import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";

export type Mode = "off" | "dry_run" | "live";

export const RULE_VERSION = "referral-accrual-v1";

/** The settlement chain whose registered wallet becomes the claim address. */
export const CLAIM_CHAIN = "robinhood";

export type PostNetwork = "robinhood-testnet" | "robinhood-mainnet";

export const POST_NETWORKS: readonly PostNetwork[] = [
  "robinhood-testnet",
  "robinhood-mainnet",
];

const DEFAULT_RPC: Readonly<Record<PostNetwork, string>> = Object.freeze({
  "robinhood-testnet": "https://rpc.testnet.chain.robinhood.com",
  "robinhood-mainnet": "https://rpc.mainnet.chain.robinhood.com",
});

export interface ReferralAccrualEnv {
  REFERRAL_ACCRUAL_MODE?: string;
  /** Program token base units per one asset micro-unit (one millionth of a stablecoin). */
  REFERRAL_RATE_BASE_PER_MICRO?: string;
  /** Program token decimals, recorded in the file for readers; the rate already includes them. */
  REFERRAL_TOKEN_DECIMALS?: string;
  /** Lifetime program pool in token base units. */
  REFERRAL_POOL_BASE?: string;
  /** Lifetime cap per referred project in token base units. */
  REFERRAL_PROJECT_CAP_BASE?: string;
  /** Months after a project's first paid obligation during which its payouts accrue. */
  REFERRAL_WINDOW_MONTHS?: string;
  /** Comma-separated GitHub numeric ids that can never accrue as referrers. */
  REFERRAL_EXCLUDED_GITHUB_IDS?: string;
  /** Comma-separated GitHub numeric ids of Slop team accounts (also excluded). */
  ADMIN_GITHUB_IDS?: string;
  PROJECT_MODERATOR_GITHUB_IDS?: string;
  /** First period the job may file, YYYY-MM. Earlier paid events are never accrued. */
  REFERRAL_FIRST_PERIOD?: string;
  /** "true" once the owner activates the program; anything else keeps live mode refused. */
  REFERRAL_PROGRAM_ENABLED?: string;
  /** Deployed ReferralDistributor, lowercase 0x address. */
  REFERRAL_DISTRIBUTOR_ADDRESS?: string;
  /** The program token the distributor must hold, lowercase 0x address. */
  REFERRAL_TOKEN_ADDRESS?: string;
  /** robinhood-testnet or robinhood-mainnet. */
  REFERRAL_POST_NETWORK?: string;
  RPC_URL_REFERRAL?: string;
  /** Secret. Never logged, never stored in D1, never set in CI. */
  REFERRAL_POSTER_KEY?: string;
}

export interface PosterConfig {
  network: PostNetwork;
  chainId: number;
  distributor: string;
  token: string;
  rpcUrl: string;
}

export interface ReferralAccrualConfig {
  mode: Mode;
  rateBasePerMicro: bigint;
  tokenDecimals: number;
  poolBase: bigint;
  projectCapBase: bigint;
  windowMonths: number;
  excludedGithubIds: ReadonlySet<string>;
  firstPeriod: string;
  /** Present only in live mode. */
  poster: PosterConfig | null;
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/u;

function integer(value: string | undefined, name: string): bigint {
  if (value === undefined || value.trim() === "")
    throw new TypeError(`${name} is required`);
  if (!/^(0|[1-9][0-9]{0,77})$/u.test(value.trim()))
    throw new TypeError(`${name} must be a non-negative integer`);
  return BigInt(value.trim());
}

function ids(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (!/^[1-9][0-9]{0,19}$/u.test(entry))
        throw new TypeError(`Excluded GitHub id is malformed: ${entry}`);
      return entry;
    });
}

export function isPeriod(value: unknown): value is string {
  return typeof value === "string" && PERIOD.test(value);
}

function address(value: string | undefined, name: string): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!EVM_ADDRESS.test(text))
    throw new TypeError(`${name} must be set to an EVM address in live mode`);
  return text;
}

/**
 * Live mode needs every one of the program flag, the distributor, the token
 * and the network. The flag is the owner's activation; nothing in the code
 * sets it.
 */
function parsePoster(env: ReferralAccrualEnv): PosterConfig {
  if ((env.REFERRAL_PROGRAM_ENABLED ?? "").trim() !== "true")
    throw new TypeError(
      'live mode is refused until REFERRAL_PROGRAM_ENABLED is "true" (owner activation)',
    );
  const network = (env.REFERRAL_POST_NETWORK ?? "").trim();
  if (!POST_NETWORKS.includes(network as PostNetwork))
    throw new TypeError(
      "REFERRAL_POST_NETWORK must be robinhood-testnet or robinhood-mainnet in live mode",
    );
  const definition = (
    ESCROW_NETWORKS as Record<string, { chainId?: string; chain: string }>
  )[network];
  if (!definition?.chainId || definition.chain !== CLAIM_CHAIN)
    throw new TypeError(
      `${network} is not a registered ${CLAIM_CHAIN} network`,
    );
  const rpcUrl =
    env.RPC_URL_REFERRAL?.trim() || DEFAULT_RPC[network as PostNetwork];
  if (!/^https?:\/\//u.test(rpcUrl))
    throw new TypeError("RPC_URL_REFERRAL must be an http(s) URL");
  const distributor = address(
    env.REFERRAL_DISTRIBUTOR_ADDRESS,
    "REFERRAL_DISTRIBUTOR_ADDRESS",
  );
  const token = address(env.REFERRAL_TOKEN_ADDRESS, "REFERRAL_TOKEN_ADDRESS");
  if (distributor === token)
    throw new TypeError(
      "REFERRAL_DISTRIBUTOR_ADDRESS and REFERRAL_TOKEN_ADDRESS must differ",
    );
  return {
    network: network as PostNetwork,
    chainId: Number(definition.chainId),
    distributor,
    token,
    rpcUrl,
  };
}

export function parseConfig(env: ReferralAccrualEnv): ReferralAccrualConfig {
  const mode = (env.REFERRAL_ACCRUAL_MODE ?? "off").trim();
  if (mode !== "off" && mode !== "dry_run" && mode !== "live")
    throw new TypeError("REFERRAL_ACCRUAL_MODE must be off, dry_run or live");
  const firstPeriod = (env.REFERRAL_FIRST_PERIOD ?? "").trim();
  if (!isPeriod(firstPeriod))
    throw new TypeError("REFERRAL_FIRST_PERIOD must be YYYY-MM");
  const decimals = integer(
    env.REFERRAL_TOKEN_DECIMALS,
    "REFERRAL_TOKEN_DECIMALS",
  );
  if (decimals > 36n)
    throw new TypeError("REFERRAL_TOKEN_DECIMALS must be at most 36");
  const windowMonths = integer(
    env.REFERRAL_WINDOW_MONTHS,
    "REFERRAL_WINDOW_MONTHS",
  );
  if (windowMonths < 1n || windowMonths > 120n)
    throw new TypeError("REFERRAL_WINDOW_MONTHS must be between 1 and 120");
  const rate = integer(
    env.REFERRAL_RATE_BASE_PER_MICRO,
    "REFERRAL_RATE_BASE_PER_MICRO",
  );
  const poolBase = integer(env.REFERRAL_POOL_BASE, "REFERRAL_POOL_BASE");
  const projectCapBase = integer(
    env.REFERRAL_PROJECT_CAP_BASE,
    "REFERRAL_PROJECT_CAP_BASE",
  );
  if (projectCapBase > poolBase)
    throw new TypeError(
      "REFERRAL_PROJECT_CAP_BASE must not exceed REFERRAL_POOL_BASE",
    );
  return {
    mode,
    rateBasePerMicro: rate,
    tokenDecimals: Number(decimals),
    poolBase,
    projectCapBase,
    windowMonths: Number(windowMonths),
    excludedGithubIds: new Set([
      ...ids(env.REFERRAL_EXCLUDED_GITHUB_IDS),
      ...ids(env.ADMIN_GITHUB_IDS),
      ...ids(env.PROJECT_MODERATOR_GITHUB_IDS),
    ]),
    firstPeriod,
    poster: mode === "live" ? parsePoster(env) : null,
  };
}

/** Returns the poster signing secret; undefined when not configured. */
export function posterKey(env: ReferralAccrualEnv): string | undefined {
  const value = env.REFERRAL_POSTER_KEY;
  return value?.trim() ? value.trim() : undefined;
}
