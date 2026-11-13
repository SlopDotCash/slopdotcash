import { Vault } from "lucide-react";
import type { ProjectDefinition } from "./lib/projects.mjs";
import { StatusBadge } from "./Presentation";

/** One badge: a recorded vault that can pay, one whose payments are off, or none. */
export function FundingStatus({
  project,
  className = "",
}: {
  project: ProjectDefinition;
  className?: string;
}) {
  // An external prize is never paid through a vault.
  if (project.reward.kind === "external-prize-share") return null;
  const [tone, label] = !project.escrow?.deployments.length
    ? (["neutral", "No vault"] as const)
    : project.reward.paymentMode === "enabled"
      ? (["success", "Live"] as const)
      : (["warning", "Payments off"] as const);
  return (
    <div className={className}>
      <StatusBadge tone={tone} icon={<Vault aria-hidden="true" size={14} />}>
        {label}
      </StatusBadge>
    </div>
  );
}
