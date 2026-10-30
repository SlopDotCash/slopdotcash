import { formatBaseUnits } from "./base-units.mjs";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import {
  ESCROW_PAYOUT_FEE_BASIS_POINTS,
  ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
  isEscrowChain,
} from "./escrow-policy.mjs";
import {
  type OwnedRepository,
  type RepositoryLookup,
  validRepositoryPath,
} from "./project-contracts";
import {
  expectedRewardFeeBasisPoints,
  formatMonthlyCapDisplay,
  MAX_PROJECT_ID_LENGTH,
  monthlyAmountDisplay,
  parseAssetAmount,
} from "./project-schema.mjs";
import { REWARD_ASSET_NETWORKS, rewardAssetChoice } from "./reward-asset.mjs";

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

/** Validate with the same decimal parser as the API; new token precision is
 * verified by the server before its staged manifest amount is stored. */
export function monthlyPoolValue(
  value: string,
  token?: { symbol: string; decimals?: number },
): { display: string; minor: string; valid: boolean; error?: string } {
  try {
    const minor = parseAssetAmount(value, token?.decimals ?? (token ? 36 : 6));
    if (BigInt(minor) === 0n) throw new RangeError("Enter a positive amount.");
    const display = token
      ? token.decimals === undefined
        ? `${value} ${token.symbol}`
        : monthlyAmountDisplay(minor, {
            kind: "token",
            symbol: token.symbol,
            decimals: token.decimals,
          })
      : formatMonthlyCapDisplay(minor);
    return {
      display,
      minor: token && token.decimals === undefined ? "0" : minor,
      valid: true,
    };
  } catch (error) {
    return {
      display: token ? `0 ${token.symbol}` : "$0",
      minor: "0",
      valid: false,
      error:
        value.trim() === "" || /^0(?:\.0+)?$/u.test(value)
          ? "Enter a positive amount."
          : token
            ? error instanceof Error
              ? error.message
              : "Enter a positive token amount."
            : "Use up to 2 decimals, at most 1 billion.",
    };
  }
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
  return `${formatBaseUnits(minor, decimals)} ${symbol}`;
}

/** The one optional funding choice of project setup. */
export type FundingChoice = {
  mode: "none" | "monthly";
  network: string;
  assetKind: "stablecoin" | "token" | "native";
  tokenAddress: string;
  tokenSymbol: string;
  monthlyAmount: string;
};

/**
 * The reward, asset and vault fields of a manifest for a funding choice. No
 * monthly funding keeps the unfunded pool with no reward asset and no vault,
 * so the network and asset are chosen only when the owner adds funding; a
 * vault's network cannot change once set. A monthly amount names one network
 * and one asset, with the vault policy of that network when it has one. The
 * server verifies the asset, reads its decimals and stores the amount, sent
 * separately as `monthlyAmount`, in the asset's base units.
 */
export function rewardFields(
  choice: FundingChoice,
  now: Date,
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
        feeBasisPoints: expectedRewardFeeBasisPoints("monthly-pool", false),
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
      : rewardAssetChoice(choice.network, choice.assetKind, "", "");
  const escrow = isEscrowChain(choice.network);
  // Native and stablecoin precision is known here. Custom token decimals are
  // read from chain on save; until then its amount is zero.
  const amount =
    choice.assetKind === "token"
      ? { minor: "0", display: `0 ${asset.symbol}` }
      : choice.assetKind === "native"
        ? monthlyPoolValue(choice.monthlyAmount, network.native)
        : monthlyPoolValue(choice.monthlyAmount);
  return {
    ...(escrow
      ? {
          escrow: {
            schemaVersion: "1",
            effectiveCycle: now.toISOString().slice(0, 7),
            chain: choice.network,
            feeBasisPoints: ESCROW_PAYOUT_FEE_BASIS_POINTS,
            withdrawalFeeBasisPoints: ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
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
      feeBasisPoints: expectedRewardFeeBasisPoints("monthly-pool", escrow),
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
    throw new Error("GitHub lookup failed.");
  }
  if (!response.ok) {
    const message = (value as { message?: unknown } | null)?.message;
    throw new Error(
      response.status === 401
        ? "Sign in with GitHub to look up repositories."
        : typeof message === "string"
          ? message
          : "GitHub lookup failed.",
    );
  }
  return value as T;
}

/**
 * Lists the signed-in maintainer's public, non-archived
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
    throw new Error("GitHub lookup failed.");
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
    throw new Error("GitHub lookup failed.");
  const repositoryFacts = body.repository as RepositoryLookup;
  if (
    !Array.isArray(repositoryFacts.branches) ||
    !repositoryFacts.branches.includes(repositoryFacts.defaultBranch)
  )
    throw new Error("The repository branch list is unavailable. Try again.");
  const commits = repositoryFacts.branchCommits;
  if (
    commits !== undefined &&
    (commits === null ||
      typeof commits !== "object" ||
      Array.isArray(commits) ||
      Object.entries(commits).some(
        ([branch, commit]) =>
          !repositoryFacts.branches.includes(branch) ||
          typeof commit !== "string" ||
          !/^[0-9a-f]{40}$/u.test(commit),
      ))
  )
    throw new Error(
      "The repository branch commits are unavailable. Try again.",
    );
  return repositoryFacts;
}
