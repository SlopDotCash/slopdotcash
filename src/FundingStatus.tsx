import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  paymentStateLabel,
  StatusBadge,
  vaultStateLabel,
} from "./Presentation";

/** Vault availability and permission to pay are independent facts. */
export function FundingStatus({
  project,
  className = "",
}: {
  project: ProjectDefinition;
  className?: string;
}) {
  return (
    <div className={className}>
      <StatusBadge
        tone={project.escrow?.deployments.length ? "info" : "neutral"}
      >
        Vault: {vaultStateLabel(project)}
      </StatusBadge>
      <StatusBadge
        tone={project.reward.paymentMode === "enabled" ? "success" : "neutral"}
      >
        Payments: {paymentStateLabel(project)}
      </StatusBadge>
    </div>
  );
}
