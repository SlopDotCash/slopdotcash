// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/poolListing.md, "A project left out of the lists still opens by direct link and says why"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { ExternalLink } from "@repo/ui";
import { formatPeriod } from "@repo/settlement/kernels/calendar";
import type { ReactNode } from "react";
import { notListedText, showsNotListed } from "../../../gen/frontend__poolListing.ts";
import { promiseNoticeText } from "../../../gen/frontend__projections.ts";
import type { PoolFunding } from "../../kernels/poolFunding.ts";
import { projectRewardSummaries, type RewardSummary as Summary } from "../../kernels/rewardSummary.ts";
import { bountyFundingLabel, compactPrizeLabel } from "../home/listing.ts";
import type { ShownProject } from "./project.schema.ts";
import { formatMonth, projectListing, promise, shownReward } from "./summary.ts";

export type RewardSummaryProps = {
  /** The project as the registry lists it. */
  project: ShownProject;
  /** This month's pool funding; an amount shows only while the vaults hold it. */
  funding: PoolFunding;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

/** @throws {RangeError} */
function lineOf(summary: Summary, project: ShownProject, warning: string): ReactNode {
  switch (summary.kind) {
    case "monthly-pool":
      return (
        <>
          {summary.amount}
          {summary.token ? (
            <>
              {" "}
              <ExternalLink href={summary.token.url} className={linkClass}>
                {summary.token.symbol}
              </ExternalLink>
            </>
          ) : null}
          {" monthly, split between contributors"}
          {warning ? ` · ${warning}` : null}
        </>
      );
    case "security-bounty": {
      const per = summary.eligibility === "critical-loss-of-funds" ? "per critical vulnerability that would result in loss of funds" : "per accepted security finding";
      const status = summary.status === "open" ? "" : ` · bounty ${summary.status}`;
      const funding = project.securityBounty ? ` · ${bountyFundingLabel(project.securityBounty)}` : "";
      return `${summary.amount} ${per}${status}${funding}`;
    }
    case "external-prize":
      return `${summary.amount ? `${compactPrizeLabel(summary.amount)} external prize pool` : "External prize"} · organizer decides awards`;
    case "points-only":
      return "Points only · no cash rewards";
    default: {
      const _exhaustive: never = summary;
      return _exhaustive;
    }
  }
}

/** What the project rewards, in the words every registry reward model shares. */
export function RewardSummary({ project, funding }: RewardSummaryProps) {
  const shown = shownReward(project, funding);
  const warning = promise(project, funding);
  return (
    <div className="flex flex-col gap-1">
      {funding.display === "PoolWithdrawn" ? (
        <p className="font-medium text-warn">{`Funds were withdrawn from the vault during ${formatMonth(formatPeriod(funding.period))}; it no longer covers this month's amount.`}</p>
      ) : null}
      {showsNotListed(projectListing({ project, funding }), warning !== "") ? <p className="text-lg font-medium text-foreground">{notListedText}</p> : null}
      {warning ? <p className="font-medium text-warn">{promiseNoticeText}</p> : null}
      {projectRewardSummaries(shown).map((summary) => (
        <p key={summary.kind} className="text-lg font-medium text-foreground">
          {lineOf(summary, shown, warning)}
        </p>
      ))}
    </div>
  );
}
