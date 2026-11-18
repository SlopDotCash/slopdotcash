// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/program.md, "Receipt terms come only from the open published revision"
import { isFullAwardSplit } from "@repo/security/client";
import { Metric, MetricGrid, Status } from "@repo/ui";
import { programShares, type SharePreview } from "./amounts.ts";
import type { ProgramTerms } from "./terms.schema.ts";

export type SecurityOfferProps = {
  /** The project's published terms; none, or terms that are not open, promise no award. */
  terms: ProgramTerms | undefined;
  /** A tighter offer, for a summary beside a report under review. */
  compact?: boolean;
  /** The amounts to show instead of the published ones, for an owner previewing an edit. */
  amountPreview?: SharePreview;
};

/** The paid offer a report is received under: the researcher's share, the split of the gross, and the funding. */
export function SecurityOffer({ terms, compact = false, amountPreview }: SecurityOfferProps) {
  const shares = amountPreview ?? (terms === undefined ? undefined : programShares(terms));
  if (terms === undefined || terms.status !== "open" || shares === undefined)
    return (
      <p>
        <Status presentation={{ tone: "Neutral", icon: "Slash", label: "No bounty" }} />
      </p>
    );
  return (
    <section aria-label="Published bounty offer" className={`flex flex-col text-sm text-card-foreground ${compact ? "gap-1" : "gap-2"}`}>
      <MetricGrid>
        <Metric label="Researcher" value={shares.researcher} />
      </MetricGrid>
      <p>{isFullAwardSplit(terms.split) ? `100% researcher of ${shares.gross} · ${terms.sponsor.name}` : `75% researcher | 25% Slop (${shares.slop}) of ${shares.gross}`}</p>
      <p>
        {terms.funding.state === "pledged" ? (
          <Status presentation={{ tone: "Caution", icon: "Clock", label: "Pledged" }} />
        ) : (
          <Status presentation={{ tone: "Positive", icon: "Check", label: "Funded" }} />
        )}
      </p>
      <p>Owner approval required · no additional payout fee.</p>
    </section>
  );
}
