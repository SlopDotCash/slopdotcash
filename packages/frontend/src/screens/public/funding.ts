// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
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
