/**
 * Referral-accrual configuration. Every value comes from Worker vars or
 * secrets; a missing or malformed value refuses the run instead of guessing.
 * The only modes are `off` and `dry_run`: nothing here signs or posts.
 */

export type Mode = "off" | "dry_run";

export const RULE_VERSION = "referral-accrual-v1";

/** The settlement chain whose registered wallet becomes the claim address. */
export const CLAIM_CHAIN = "robinhood";

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
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/u;

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

export function parseConfig(env: ReferralAccrualEnv): ReferralAccrualConfig {
  const mode = (env.REFERRAL_ACCRUAL_MODE ?? "off").trim();
  if (mode !== "off" && mode !== "dry_run")
    throw new TypeError("REFERRAL_ACCRUAL_MODE must be off or dry_run");
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
  };
}
