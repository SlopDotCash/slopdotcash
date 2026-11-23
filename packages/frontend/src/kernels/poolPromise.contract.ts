// spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
import { type PoolDisplay, type PoolRead, promiseText, promiseWarning } from "../../gen/frontend__projections.ts";
import { pool } from "../screens/home/fixtures.ts";
import { cardReward } from "../screens/home/listing.ts";
import { projectPromise } from "../screens/home/promise.ts";
import { networkPays } from "./payingNetworks.ts";
import { type FundingVault, poolFunding } from "./poolFunding.ts";
import { vaultUnread } from "./poolPromise.ts";
import { vectors } from "./vectors.ts";

const nowMs = Date.parse("2026-11-15T12:00:00Z");
const vault = "0x4F891b8c3d3fab9150fcdc94176b96863cd02899";
const deployments = [{ network: "base-mainnet", vault }];
const vaultOf = (freeBalance: bigint | null): FundingVault => ({ network: "base-mainnet", vault: vault.toLowerCase(), freeBalance });

interface Case {
  readonly honorSystem: boolean;
  readonly read: PoolRead;
  readonly vaults: ReadonlyArray<FundingVault>;
}

function shown({ honorSystem, read, vaults }: Case): [string, PoolDisplay, string] {
  const funding = poolFunding({ pool: { monthlyPool: true, deployments, capFor: () => 250_000_000n }, read, vaults, networkPays, nowMs });
  const promise = projectPromise({ pool: funding.facts, honorSystem, deployments, vaults, networkPays });
  const project = { ...pool, reward: { ...pool.reward, monthlyCapMinor: 250_000_000n, monthlyCapDisplay: "$250" }, funding: funding.facts, promise };
  const card = cardReward(project);
  return [promiseText(promiseWarning(promise)), funding.display, [`${card.amount}${card.unit ?? ""}`, card.tag, card.warning].filter((part) => part !== undefined).join(" · ")];
}

export const anOwnerPromiseTellsAShortVaultFromAnUnreadOneAndNeverFundsThePool = vectors<Case, [string, PoolDisplay, string]>([
  [{ honorSystem: true, read: "PoolCurrent", vaults: [vaultOf(null)] }, ["Promised · Vault funding unverified", "PointsOnly", "$250/mo · Promised · Vault funding unverified"]],
  [{ honorSystem: true, read: "PoolCurrent", vaults: [vaultOf(249_999_999n)] }, ["Promised · Not vaulted", "PointsOnly", "$250/mo · Promised · Not vaulted"]],
  [{ honorSystem: true, read: "PoolCurrent", vaults: [vaultOf(250_000_000n)] }, ["", "PoolFunded", "$250/mo · Vaulted"]],
  [{ honorSystem: true, read: "PoolCurrent", vaults: [] }, ["Promised · Vault funding unverified", "PointsOnly", "$250/mo · Promised · Vault funding unverified"]],
  [{ honorSystem: true, read: "PoolFailed", vaults: [vaultOf(249_999_999n)] }, ["Promised · Vault funding unverified", "PointsOnly", "$250/mo · Promised · Vault funding unverified"]],
  [{ honorSystem: false, read: "PoolCurrent", vaults: [vaultOf(249_999_999n)] }, ["", "PointsOnly", "$250/mo · Configured · Not vaulted"]],
], shown);

export const everyRecordedVaultIsUnreadWhileTheReadIsNotCurrent = vectors<[boolean, boolean[]], boolean>([
  [[true, []], false],
  [[true, [true, true]], false],
  [[true, [true, false]], true],
  [[false, []], false],
  [[false, [true]], true],
], ([current, recorded]) => vaultUnread(current, recorded));
