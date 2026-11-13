import { Check } from "lucide-react";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  formatSecurityAmount,
  isFullAwardSplit,
  securityBountySplit,
} from "./lib/security-bounty.mjs";
import { MetricGrid, MetricTile, StatusBadge } from "./Presentation";

/** The same immutable program terms drive discovery, review and owner preview. */
export function SecurityOffer({
  project,
  compact = false,
  amountPreview,
}: {
  project: Pick<ProjectDefinition, "securityBounty">;
  compact?: boolean;
  amountPreview?: { gross: string; researcher: string; slop: string };
}) {
  const terms = project.securityBounty;
  if (!terms || terms.status !== "open")
    return (
      <p>
        <StatusBadge>No bounty</StatusBadge>
      </p>
    );
  const fullAward = isFullAwardSplit(terms.split);
  const amount = (minor: string) => formatSecurityAmount(minor, terms.amount);
  const { gross, researcher, slop } =
    amountPreview ??
    (() => {
      const split = securityBountySplit(terms.amount.grossMinor, terms.split);
      return {
        gross: amount(split.grossMinor),
        researcher: amount(split.researcherMinor),
        slop: amount(split.slopMinor),
      };
    })();
  return (
    <section
      className={`security-offer${compact ? " security-offer-compact" : ""}`}
      aria-label="Published bounty offer"
    >
      <MetricGrid>
        <MetricTile label="Researcher" value={researcher} />
      </MetricGrid>
      <p>
        {fullAward
          ? `100% researcher of ${gross} · ${terms.sponsor.name}`
          : `75% researcher | 25% Slop (${slop}) of ${gross}`}
      </p>
      <p className="security-offer-funding">
        {terms.funding.state === "pledged" ? (
          <StatusBadge tone="warning">Pledged</StatusBadge>
        ) : (
          <StatusBadge tone="success" icon={<Check />}>
            Funded
          </StatusBadge>
        )}
      </p>
    </section>
  );
}
