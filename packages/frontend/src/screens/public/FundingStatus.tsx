// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { cn, Status, type StatusProps } from "@repo/ui";
import type { ListedProject } from "../home/listing.ts";
import { type NetworkPays, paymentsOn } from "./funding.ts";

export type FundingStatusProps = {
  project: ListedProject;
  /** Whether payments run on a network: a test network always, a main network once reviewed. */
  networkPays: NetworkPays;
  className?: string;
};

/** @throws {never} */
function vaultPresentation(project: ListedProject, networkPays: NetworkPays): StatusProps["presentation"] {
  if (!project.escrow?.deployments.length) return { tone: "Neutral", icon: "Lock", label: "No vault" };
  return paymentsOn(project, networkPays) ? { tone: "Positive", icon: "Lock", label: "Live" } : { tone: "Caution", icon: "Lock", label: "Payments off" };
}

/** One badge: a recorded vault that can pay, one whose payments are off, or none; nothing for an external prize. */
export function FundingStatus({ project, networkPays, className }: FundingStatusProps) {
  if (project.reward.kind === "external-prize-share") return null;
  return (
    <div className={cn("flex", className)}>
      <Status presentation={vaultPresentation(project, networkPays)} />
    </div>
  );
}
