// spec/security/terms.md, "Paid terms carry their split, funding policy, eligibility class and asset"; spec/security/program.md, "Receipt terms come only from the open published revision"
import { isFullAwardSplit } from "@repo/security/client";
import { programShares, type SharePreview } from "./amounts.ts";
import type { ProgramTerms } from "./terms.schema.ts";

export type SecurityOfferProps = {
  /** The project's published terms; none, or terms that are not open, promise no award. */
  terms: ProgramTerms | undefined;
  /** Leaves out the impact definition, for a summary beside a report under review. */
  compact?: boolean;
  /** The amounts to show instead of the published ones, for an owner previewing an edit. */
  amountPreview?: SharePreview;
};

/** The paid offer a report is received under: the researcher's share first, then the gross, Slop's share and the funding. */
export function SecurityOffer({ terms, compact = false, amountPreview }: SecurityOfferProps) {
  const shares = amountPreview ?? (terms === undefined ? undefined : programShares(terms));
  if (terms === undefined || terms.status !== "open" || shares === undefined)
    return <p className="text-sm text-muted-foreground">No paid offer is open. You can still report privately; no award is promised.</p>;
  const fullAward = isFullAwardSplit(terms.split);
  return (
    <section aria-label="Published bounty offer" className="flex flex-col gap-2 rounded-md border border-border bg-card p-4 text-sm text-card-foreground">
      <p className="text-base">
        <strong className="text-lg font-semibold">{shares.researcher}</strong> to the researcher
      </p>
      <p>
        {fullAward
          ? `${shares.gross} total award, sponsored by ${terms.sponsor.name}. The researcher receives all of it; Slop takes no share and no payout fee.`
          : `${shares.gross} total award · ${shares.slop} to Slop. No additional payout fee.`}
      </p>
      <p>{terms.funding.state === "pledged" ? "Pledged. Awards require owner approval." : "Funding verified at the recorded observation. Awards require owner approval."}</p>
      {compact ? null : <p>{terms.scope.lossDefinition}</p>}
      <p className="text-muted-foreground">
        {terms.fundingPolicy === "after-approval"
          ? "The owner decides whether to award the published amount for each first qualifying finding."
          : "The owner decides awards under the published terms."}
      </p>
    </section>
  );
}
