// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"
import { poolDisplay } from "../../../gen/frontend__projections.ts";
import { formatRewardCapDisplay } from "../../kernels/assetText.ts";
import type { ListedProject } from "../home/listing.ts";

export type NetworkPays = (network: string) => boolean;

/** @throws {never} */
export function paymentsOn(project: ListedProject, networkPays: NetworkPays): boolean {
  return project.reward.kind !== "external-prize-share" && (project.escrow?.deployments ?? []).some((deployment) => networkPays(deployment.network));
}

/** @throws {never} */
export function vaultStateLabel(project: ListedProject, networkPays: NetworkPays): string {
  if (project.reward.kind === "external-prize-share") return "Not applicable";
  if (!project.escrow?.deployments.length) return "Not set up";
  return paymentsOn(project, networkPays) ? "Live" : "Set up";
}

/** @throws {never} */
export function sponsorPoolLabel(project: ListedProject): string {
  const { reward } = project;
  if (reward.kind === "external-prize-share" && reward.externalOpportunity?.name) return `external prize share · ${reward.externalOpportunity.name}`;
  if (poolDisplay(project.funding) !== "PoolFunded" || reward.monthlyCapMinor === 0n) return "points only";
  return `${formatRewardCapDisplay(reward.monthlyCapDisplay, project.rewardAsset)} monthly · in the vault`;
}
