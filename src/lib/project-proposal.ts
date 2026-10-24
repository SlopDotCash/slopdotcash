import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import { isEscrowChain } from "./escrow-policy.mjs";
import {
  type OwnedRepository,
  type RepositoryLookup,
  validRepositoryPath,
} from "./project-contracts";
import {
  formatAssetAmount,
  formatMonthlyCapDisplay,
  MAX_MONTHLY_CAP_MINOR,
  MAX_PROJECT_ID_LENGTH,
  projectFeeBasisPoints,
  VAULT_FUNDING_DISCLOSURE,
} from "./project-schema.mjs";
import { REWARD_ASSET_NETWORKS } from "./reward-asset.mjs";

export function safeProposalHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > 500) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

export function immutableProposalTermsUrl(
  value: string,
  repository: string,
  commit: string,
): boolean {
  if (!safeProposalHttpsUrl(value)) return false;
  const parsed = new URL(value);
  const prefix = `/${repository}/blob/${commit}/`;
  return (
    parsed.origin === "https://github.com" &&
    !parsed.search &&
    parsed.pathname.startsWith(prefix) &&
    parsed.pathname.length > prefix.length
  );
}

const GITHUB_REPOSITORY_LINK =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?(?:\/[^\s]*)?(?:[?#][^\s]*)?$/iu;
const GITHUB_REPOSITORY_SSH =
  /^(?:ssh:\/\/)?git@github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/iu;

/**
 * Turns a pasted github.com link (https, bare host, ssh, with .git, a
 * trailing slash, a deeper path, a query or a hash) into the owner/name form
 * the project manifest requires. Anything that is not a github.com link is
 * only trimmed, so a wrong value stays visible instead of being guessed.
 */
export function normalizeRepositoryInput(value: string): string {
  const trimmed = value.trim();
  const match =
    GITHUB_REPOSITORY_LINK.exec(trimmed) ?? GITHUB_REPOSITORY_SSH.exec(trimmed);
  return match ? `${match[1]}/${match[2]}` : trimmed;
}

export function boundedText(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  const length = value.trim().length;
  return length >= minimum && length <= maximum;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, MAX_PROJECT_ID_LENGTH)
    .replace(/-$/u, "");
}

export function monthlyPoolValue(value: string): {
  display: string;
  minor: string;
  valid: boolean;
} {
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/u.test(value)) {
    return { display: "$0", minor: "0", valid: false };
  }
  const [whole, fraction = ""] = value.split(".");
  const minor = (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(2, "0")) * 10_000n
  ).toString();
  if (BigInt(minor) > MAX_MONTHLY_CAP_MINOR) {
    return { display: "$0", minor: "0", valid: false };
  }
  return {
    display: formatMonthlyCapDisplay(minor),
    minor,
    valid: true,
  };
}

/**
 * A monthly amount in the reward asset, from its integer base units, without
 * floating point and without a dollar sign: the asset is the unit (PRD
 * section 6, "never present tokens as dollars").
 */
export function formatMonthlyAmount(
  minor: string,
  decimals: number,
  symbol: string,
): string {
  return `${formatAssetAmount(minor, decimals)} ${symbol}`;
}

/** The one optional funding choice of project setup. */
export type FundingChoice = {
  mode: "none" | "monthly";
  network: string;
  assetKind: "stablecoin" | "token";
  tokenAddress: string;
  tokenSymbol: string;
  monthlyAmount: string;
};

/**
 * The funding terms every new project records: project-vault custody with the
 * ordinary 2% fee, whether or not it has a vault yet (PRD section 11, owner
 * decision of 24 October 2026, D3). Owner revisions never change them.
 */
export function newProjectFunding(slug: string): Record<string, unknown> {
  return {
    mode: "direct-noncustodial",
    disclosure: VAULT_FUNDING_DISCLOSURE,
    recordsPath: `funding/${slug}`,
    addresses: [],
  };
}

/**
 * The reward, asset and vault fields of a manifest for a funding choice. No
 * monthly funding keeps the unfunded pool with no reward asset and no vault,
 * so the network and asset are chosen only when the owner adds funding; a
 * vault's network cannot change once set. A monthly amount names one network
 * and one asset, with the vault policy of that network when it has one. The
 * server verifies the asset, reads its decimals and stores the amount, sent
 * separately as `monthlyAmount`, in the asset's base units. The fee follows
 * the project's recorded funding disclosure: a new draft passes
 * `VAULT_FUNDING_DISCLOSURE`, and a revision passes the disclosure its
 * project was created with, so historical projects keep their terms.
 */
export function rewardFields(
  choice: FundingChoice,
  now: Date,
  disclosure: string,
): Record<string, unknown> {
  if (choice.mode === "none")
    return {
      reward: {
        kind: "monthly-pool",
        currency: "USDC",
        chain: "base",
        rewardStartAt: now.toISOString(),
        cycle: "calendar-month-utc",
        monthlyCapMinor: "0",
        monthlyCapDisplay: formatMonthlyCapDisplay("0"),
        committedMinor: "0",
        paymentMode: "disabled",
        feeBasisPoints: projectFeeBasisPoints({
          kind: "monthly-pool",
          escrow: undefined,
          disclosure,
        }),
        unusedFunds: "rollover-without-cap-increase",
        fundingState: "pledged",
      },
    };
  const network =
    REWARD_ASSET_NETWORKS[choice.network as keyof typeof REWARD_ASSET_NETWORKS];
  const asset =
    choice.assetKind === "token"
      ? {
          network: choice.network,
          kind: "token",
          address: choice.tokenAddress.trim(),
          symbol: choice.tokenSymbol.trim(),
        }
      : {
          network: choice.network,
          kind: "stablecoin",
          address: network.stablecoin.address,
          symbol: network.stablecoin.symbol,
        };
  const escrow = isEscrowChain(choice.network);
  // A stablecoin has 6 decimals, so its base units are known here. A token's
  // decimals are read from chain on save; until then its amount is zero.
  const amount =
    choice.assetKind === "token"
      ? { minor: "0", display: `0 ${asset.symbol}` }
      : monthlyPoolValue(choice.monthlyAmount);
  return {
    ...(escrow
      ? {
          escrow: {
            schemaVersion: "1",
            effectiveCycle: now.toISOString().slice(0, 7),
            chain: choice.network,
            feeBasisPoints: 200,
            withdrawalFeeBasisPoints: 200,
            feeMode: "deduct-from-gross",
            deployments: [],
          },
        }
      : {}),
    rewardAsset: asset,
    reward: {
      kind: "monthly-pool",
      currency: asset.symbol,
      chain: choice.network,
      rewardStartAt: now.toISOString(),
      cycle: "calendar-month-utc",
      monthlyCapMinor: amount.minor,
      monthlyCapDisplay: amount.display,
      committedMinor: "0",
      paymentMode: "disabled",
      feeBasisPoints: projectFeeBasisPoints({
        kind: "monthly-pool",
        escrow: escrow ? choice.network : undefined,
        disclosure,
      }),
      unusedFunds: "rollover-without-cap-increase",
      fundingState: "pledged",
    },
  };
}

async function projectGithubRequest<T>(
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetchWithDeadline(`/api/v1/project-github/${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  let value: unknown;
  try {
    value = await readBoundedJson(response, 2 * 1024 * 1024, "GitHub lookup");
  } catch {
    throw new Error(`The GitHub lookup returned HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const message = (value as { message?: unknown } | null)?.message;
    throw new Error(
      response.status === 401
        ? "Sign in with GitHub to look up repositories."
        : typeof message === "string"
          ? message
          : `The GitHub lookup returned HTTP ${response.status}.`,
    );
  }
  return value as T;
}

/**
 * Lists the signed-in maintainer's public, non-fork, non-archived
 * repositories. The site server reads GitHub with the site session; the
 * browser never calls api.github.com.
 */
export async function listOwnedRepositories(
  signal: AbortSignal,
): Promise<OwnedRepository[]> {
  const body = await projectGithubRequest<{ repositories?: unknown }>(
    "owned-repositories",
    signal,
  );
  if (!Array.isArray(body.repositories))
    throw new Error("The GitHub lookup returned an unexpected response.");
  return body.repositories as OwnedRepository[];
}

/** Reads public repository facts through the site server. */
export async function lookupGitHubRepository(
  repository: string,
  signal: AbortSignal,
): Promise<RepositoryLookup> {
  if (!validRepositoryPath(repository))
    throw new Error("Enter the repository as owner/name first.");
  const [owner, name] = repository.split("/");
  const body = await projectGithubRequest<{ repository?: unknown }>(
    `repositories/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
    signal,
  );
  if (!body.repository || typeof body.repository !== "object")
    throw new Error("The GitHub lookup returned an unexpected response.");
  return body.repository as RepositoryLookup;
}
