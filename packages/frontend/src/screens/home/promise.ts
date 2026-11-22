// spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"
import type { PoolFacts, PromiseFacts } from "../../../gen/frontend__projections.ts";
import type { Deployment, FundingVault } from "../../kernels/poolFunding.ts";
import { promiseFacts } from "../../kernels/poolPromise.ts";

const vaultKey = (network: string, vault: string) => `${network}\n${vault.startsWith("0x") ? vault.toLowerCase() : vault}`;

const vaultRead = (vault: FundingVault) => vault.freeBalance !== null || (vault.openPledgedGross !== undefined && vault.openPledgedGross !== null);

/** A project's honor-system facts this month, from its recorded vaults on paying networks and the cached vault reads. @throws {never} */
export function projectPromise({ pool, honorSystem, deployments, vaults, networkPays }: {
  pool: PoolFacts;
  honorSystem: boolean;
  deployments: ReadonlyArray<Deployment>;
  vaults: ReadonlyArray<FundingVault>;
  networkPays: (network: string) => boolean;
}): PromiseFacts {
  const read = new Set(vaults.filter(vaultRead).map((vault) => vaultKey(vault.network, vault.vault)));
  const recorded = new Set(deployments.filter((deployment) => networkPays(deployment.network)).map((deployment) => vaultKey(deployment.network, deployment.vault)));
  return promiseFacts(pool, honorSystem, [...recorded].map((key) => read.has(key)));
}

/** The facts of a pool whose owner made no promise. @throws {never} */
export function noPromise(pool: PoolFacts): PromiseFacts {
  return { pool, honorSystem: false, vaultUnread: false };
}
