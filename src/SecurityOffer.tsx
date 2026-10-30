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
  amountPreview,
}: {
  project: Pick<ProjectDefinition, "securityBounty">;
  compact?: boolean;
  amountPreview?: { gross: string; researcher: string; slop: string };
}) {
  const terms = project.securityBounty;
  if (!terms || terms.status !== "open")
    return (
      <p className="field-hint">
        No paid offer is open. You can still report privately; no award is
        promised.
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
      <p className="security-offer-net">
        <strong>{researcher}</strong> to the researcher
      </p>
      <p>
        {fullAward
          ? `${gross} total award, sponsored by ${terms.sponsor.name}. The researcher receives all of it; Slop takes no share and no payout fee.`
          : `${gross} total award · ${slop} to Slop. No additional payout fee.`}
      </p>
      <p className="security-offer-funding">
        {terms.funding.state === "pledged"
          ? "Pledged. Awards require owner approval."
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
