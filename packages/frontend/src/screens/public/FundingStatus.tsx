// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"
import { cn, Status } from "@repo/ui";
import type { ListedProject } from "../home/listing.ts";
import { type NetworkPays, paymentsOn, vaultStateLabel } from "./funding.ts";

export type FundingStatusProps = {
  project: ListedProject;
  /** Whether payments run on a network: a test network always, a main network once reviewed. */
  networkPays: NetworkPays;
  className?: string;
};

/** A project's vault and whether it may pay: two independent facts, side by side. */
export function FundingStatus({ project, networkPays, className }: FundingStatusProps) {
  const paying = paymentsOn(project, networkPays);
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1", className)}>
      <Status presentation={{ tone: project.escrow?.deployments.length ? "Notice" : "Neutral", icon: "Lock", label: `Vault: ${vaultStateLabel(project, networkPays)}` }} />
      <Status presentation={{ tone: paying ? "Positive" : "Neutral", icon: paying ? "Check" : "Pause", label: `Payments: ${paying ? "Enabled" : "Disabled"}` }} />
    </div>
  );
}
