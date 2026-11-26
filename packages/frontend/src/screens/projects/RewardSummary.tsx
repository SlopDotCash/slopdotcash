// spec/frontend/projections.md, "Pool funding is Funded, Withdrawn or points only"; spec/frontend/projections.md, "An owner's honor-system promise shows this month's amount as promised, never as vault-backed"; spec/frontend/views.md, "A published maintainer share shows this month's share, and next month's while a change waits"; spec/frontend/views.md, "A project card shows one reward variant per registry policy, and a paid bounty-only program replaces ordinary work on cards"; spec/frontend/presentation.md, "Project tokens have one dollar prefix while native and approved stablecoin tickers have none"
import { ExternalLink } from "@repo/ui";
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { formatPeriod } from "@repo/settlement/kernels/calendar";
import type { ReactNode } from "react";
import { type PromiseFacts, promiseNoticeText, promiseText, promiseWarning } from "../../../gen/frontend__projections.ts";
import type { PoolFunding } from "../../kernels/poolFunding.ts";
import { projectRewardSummaries, type RewardSummary as Summary } from "../../kernels/rewardSummary.ts";
import { bountyFundingLabel, compactPrizeLabel } from "../home/listing.ts";
import type { ShownProject } from "./project.schema.ts";
import { formatMonth, shownPool } from "./summary.ts";

export type RewardSummaryProps = {
  /** The project as the registry lists it. */
  project: ShownProject;
  /** This month's pool funding; an amount shows only while the vaults hold it or the owner promises it. */
  funding: PoolFunding;
  /** The owner's honor-system facts this month. */
  promise: PromiseFacts;
  /** The sentence for the maintainer share the registry publishes this month, or null when there is none. */
  shareNotice: string | null;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const lineClass = "text-gold";

/** A promised token pool's amount reads exactly; a stablecoin's already does. @throws {RangeError} */
function poolAmount(summary: string, project: ShownProject, promised: string): string {
  const asset = project.rewardAsset;
  return promised && asset && asset.kind !== "stablecoin" ? formatBaseUnits({ value: project.reward.monthlyCapMinor, decimals: asset.decimals }) : summary;
}

/** @throws {RangeError} */
function lineOf(summary: Summary, project: ShownProject, promised: string): ReactNode {
  switch (summary.kind) {
    case "monthly-pool":
      return (
        <>
          {poolAmount(summary.amount, project, promised)}
          {summary.token ? (
            <>
              {" "}
              <ExternalLink href={summary.token.url} className={linkClass}>
                {summary.token.symbol}
              </ExternalLink>
            </>
          ) : null}
          {promised ? ` /mo · ${promised}` : " /mo"}
        </>
      );
    case "security-bounty": {
      const per = summary.eligibility === "critical-loss-of-funds" ? "/ critical finding" : "/ finding";
      const status = summary.status === "open" ? "" : ` · bounty ${summary.status}`;
      const funding = project.securityBounty ? ` · ${bountyFundingLabel(project.securityBounty)}` : "";
      return `${summary.amount} ${per}${status}${funding}`;
    }
    case "external-prize":
      return summary.amount ? `${compactPrizeLabel(summary.amount)} external prize` : "External prize";
    case "points-only":
      return "Points only";
    default: {
      const _exhaustive: never = summary;
      return _exhaustive;
    }
  }
}

/** What the project rewards, in the words every registry reward model shares; an owner's promise reads as a promise. */
export function RewardSummary({ project, funding, promise, shareNotice }: RewardSummaryProps) {
  const warning = promiseWarning(promise);
  const promised = warning !== "NoPromise";
  const shown = shownPool(project, funding, promise);
  return (
    <div className="flex flex-col gap-1">
      {funding.display === "PoolWithdrawn" ? (
        <p className="font-medium text-warn">{`Funds were withdrawn from the vault during ${formatMonth(formatPeriod(funding.period))}; it no longer covers this month's amount.`}</p>
      ) : null}
      {projectRewardSummaries(shown).map((summary) => (
        <p key={summary.kind} className={lineClass}>
          {lineOf(summary, shown, promiseText(warning))}
        </p>
      ))}
      {promised ? <p className={lineClass}>{promiseNoticeText}</p> : null}
      {shareNotice ? <p className={lineClass}>{shareNotice}</p> : null}
    </div>
  );
}
