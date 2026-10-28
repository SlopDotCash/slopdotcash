import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  formatSecurityAmount,
  isFullAwardSplit,
  securityBountySplit,
} from "./lib/security-bounty.mjs";

/** The same immutable program terms drive discovery, review and owner preview. */
export function SecurityOffer({
  project,
  compact = false,
}: {
  project: Pick<ProjectDefinition, "securityBounty">;
  compact?: boolean;
}) {
  const terms = project.securityBounty;
  if (!terms || terms.status !== "open")
    return (
      <p className="field-hint">
        No paid offer is open. You can still report privately; no award is
        promised.
      </p>
    );
  const split = securityBountySplit(terms.amount.grossMinor, terms.split);
  const fullAward = isFullAwardSplit(terms.split);
  const amount = (minor: string) => formatSecurityAmount(minor, terms.amount);
  return (
    <section
      className={`security-offer${compact ? " security-offer-compact" : ""}`}
      aria-label="Published bounty offer"
    >
      <p className="security-offer-net">
        <strong>{amount(split.researcherMinor)}</strong> to the researcher
      </p>
      <p>
        {fullAward
          ? `${amount(split.grossMinor)} total award, sponsored by ${terms.sponsor.name}. The researcher receives all of it; Slop takes no share and no payout fee.`
          : `${amount(split.grossMinor)} total award · ${amount(split.slopMinor)} to Slop. No additional payout fee.`}
      </p>
      <p className="security-offer-funding">
        {fullAward
          ? "Pledged — funded after approval. An approved award is not payable until a full-award payment path is approved and released."
          : terms.funding.state === "pledged"
            ? "Pledged — funded after approval. Payment requires verified funding."
            : "Funding verified at the recorded observation. Awards require owner approval."}
      </p>
      {!compact ? <p>{terms.scope.lossDefinition}</p> : null}
      <p className="field-hint">
        {terms.fundingPolicy === "after-approval"
          ? "The owner decides whether to award the published amount for each first qualifying finding."
          : "The owner decides awards under the published terms."}
      </p>
    </section>
  );
}
