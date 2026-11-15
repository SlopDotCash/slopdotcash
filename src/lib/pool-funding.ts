import {
  MAINNET_EXECUTION,
  mainnetExecutionEnabled,
} from "../../workers/payment-executor/mainnet-execution.mjs";
import { fetchWithDeadline, readBoundedJson } from "./browser-json";
import type { ProjectDefinition } from "./projects.mjs";
import { resolveRewardCapMinor } from "./reward-cap.mjs";

/**
 * Only money in a vault is shown (operator decision, 15 November 2026). A
 * monthly pool shows its amount when a recorded vault on a paying network
 * holds at least this month's amount; every other pool shows as points only.
 * The balances come from `GET /api/v1/pool-funding`, cached finalized vault
 * counters (PRD section 9). While they load, or when they cannot be read,
 * no amount is shown.
 */

export type VaultFreeBalance = {
  network: string;
  vault: string;
  freeBalance: string | null;
  blockTime: string;
  observedAt: string;
};

export type PoolFundingIndex = Map<string, VaultFreeBalance[]>;

const BASE_UNITS = /^(0|[1-9][0-9]*)$/u;

/** EVM addresses compare case-insensitively; Solana addresses exactly. */
function vaultKey(network: string, vault: string): string {
  return `${network}\n${vault.startsWith("0x") ? vault.toLowerCase() : vault}`;
}

function isVault(value: unknown): value is VaultFreeBalance {
  const row = value as VaultFreeBalance;
  return (
    !!row &&
    typeof row.network === "string" &&
    typeof row.vault === "string" &&
    (row.freeBalance === null ||
      (typeof row.freeBalance === "string" &&
        BASE_UNITS.test(row.freeBalance))) &&
    !Number.isNaN(Date.parse(row.blockTime)) &&
    !Number.isNaN(Date.parse(row.observedAt))
  );
}

export async function loadPoolFunding(
  signal: AbortSignal,
): Promise<{ index: PoolFundingIndex }> {
  const response = await fetchWithDeadline("/api/v1/pool-funding", {
    signal,
  });
  if (!response.ok) throw new Error("Pool funding unavailable");
  const value = (await readBoundedJson(
    response,
    1_048_576,
    "pool funding",
  )) as {
    schema?: unknown;
    projects?: Array<{ projectId?: unknown; vaults?: unknown }>;
  } | null;
  if (
    value?.schema !== "slop-pool-funding-v1" ||
    !Array.isArray(value.projects)
  )
    throw new Error("Pool funding could not be read");
  const index: PoolFundingIndex = new Map();
  for (const project of value.projects) {
    if (
      typeof project?.projectId !== "string" ||
      !Array.isArray(project.vaults) ||
      !project.vaults.every(isVault)
    )
      throw new Error("Pool funding could not be read");
    index.set(project.projectId, project.vaults);
  }
  return { index };
}

export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** A test network is not on the mainnet switch; it always executes. */
function networkPays(network: string): boolean {
  return (
    !Object.hasOwn(MAINNET_EXECUTION, network) ||
    mainnetExecutionEnabled(network)
  );
}

/**
 * True when the project's recorded vaults on paying networks hold at least
 * this month's amount, in the vault asset's base units.
 */
export function poolFunded(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): boolean {
  if (project.reward.kind !== "monthly-pool" || index === null) return false;
  const cap = BigInt(resolveRewardCapMinor(project, utcMonth(now)));
  if (cap === 0n) return false;
  const recorded = new Set(
    (project.escrow?.deployments ?? [])
      .filter((deployment) => networkPays(deployment.network))
      .map((deployment) => vaultKey(deployment.network, deployment.vault)),
  );
  let free = 0n;
  for (const vault of index.get(project.id) ?? []) {
    if (vault.freeBalance === null) continue;
    if (!recorded.has(vaultKey(vault.network, vault.vault))) continue;
    free += BigInt(vault.freeBalance);
  }
  return free >= cap;
}

/**
 * The project as contributors should see it: an unfunded monthly pool reads
 * as points only everywhere the registry amount would otherwise appear.
 */
export function asShown(
  project: ProjectDefinition,
  index: PoolFundingIndex | null,
  now: Date,
): ProjectDefinition {
  if (project.reward.kind !== "monthly-pool") return project;
  if (poolFunded(project, index, now)) return project;
  if (project.reward.monthlyCapMinor === "0" && !project.reward.cycleCaps)
    return project;
  const { cycleCaps: _cycleCaps, ...reward } = project.reward;
  return {
    ...project,
    reward: {
      ...reward,
      monthlyCapMinor: "0",
      // A token pool's label swaps its last word for the token symbol.
      monthlyCapDisplay:
        project.rewardAsset && project.rewardAsset.kind !== "stablecoin"
          ? "0 TOKEN"
          : "$0",
    },
  } as ProjectDefinition;
}
