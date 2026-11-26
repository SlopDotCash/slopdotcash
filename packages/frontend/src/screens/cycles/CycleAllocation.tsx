// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import { Avatar, EmptyState, Status, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { formatRewardCapDisplay, formatRewardMinor, monthlyPoolUnfunded } from "../../kernels/assetText.ts";
import { capFor, type ExclusionRelationship, type PoolContributor, type PrizeContributor, type ProjectCycleView } from "../../projections/projectView.ts";
import { reviewerStandings } from "../../projections/standings.ts";
import type { ShownProject } from "../projects/project.schema.ts";
import { formatDate, formatMonth } from "../projects/summary.ts";
import { percentText } from "./labels.ts";

export type CycleAllocationProps = {
  /** The month's live view, projected from the public snapshot. */
  view: ProjectCycleView;
  /** When the snapshot was generated. */
  updatedAt: string;
  /** The project as the registry lists it. */
  project: ShownProject;
  /** The monthly pool's committed amount; an unknown amount counts as unfunded. */
  committedMinor?: bigint;
};

const exclusionLabels: Readonly<Record<ExclusionRelationship, string>> = { owner: "owner", "funded-employee": "funded employee", "related-party": "related party" };

export type FundedMeterProps = {
  /** What is funded, when the meter stands alone. */
  label?: string;
  /** The funded amount and the cap, in base units; the bar is left out without a cap. */
  fundedMinor: bigint;
  capMinor?: bigint;
  /** The funded amount and the cap as shown. */
  funded: string;
  cap: string;
};

/** A funded amount against its cap: a bar and the two amounts. */
export function FundedMeter({ label, fundedMinor, capMinor, funded, cap }: FundedMeterProps) {
  const share = capMinor !== undefined && capMinor > 0n ? Number(((fundedMinor > capMinor ? capMinor : fundedMinor) * 10_000n) / capMinor) : undefined;
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      {label ? <span>{label}</span> : null}
      {share !== undefined ? (
        <span aria-hidden className="flex h-2 w-24 overflow-hidden rounded-lg bg-secondary">
          {share > 0 ? <span className="bg-primary" style={{ flexGrow: share }} /> : null}
          {share < 10_000 ? <span style={{ flexGrow: 10_000 - share }} /> : null}
        </span>
      ) : null}
      <span className="font-mono tabular-nums">
        {funded} / {cap}
      </span>
    </span>
  );
}

const linkClass = "flex items-center gap-3 text-foreground hover:underline";

/** @throws {never} */
function unfunded(view: ProjectCycleView, committedMinor: bigint | undefined): boolean {
  return view.kind === "monthly-pool" && view.project.reward.kind === "monthly-pool" && monthlyPoolUnfunded({ fundingState: view.project.reward.fundingState, committedMinor: committedMinor ?? 0n });
}

/** @throws {never} */
function weightShare(view: ProjectCycleView, weight: bigint): bigint {
  const total = view.leaders.reduce((sum, leader) => sum + leader.weight, 0n);
  return total > 0n ? (weight * 1_000_000n) / total : 0n;
}

function RewardValue({ view, leader, project, committedMinor }: { view: ProjectCycleView; leader: PoolContributor | PrizeContributor; project: ShownProject; committedMinor: bigint | undefined }) {
  if (leader.payoutExclusion) {
    const why = exclusionLabels[leader.payoutExclusion];
    return (
      <span title={`Excluded from payout: ${why}`}>
        <Status presentation={{ tone: "Neutral", icon: "Ban", label: "Excluded" }} />
        <span className="sr-only"> from payout ({why})</span>
      </span>
    );
  }
  if ("projectedSharePartsPerMillion" in leader) return <>{percentText(leader.projectedSharePartsPerMillion)} share</>;
  if (!unfunded(view, committedMinor)) return <>{formatRewardMinor(leader.simulatedMinor, project.rewardAsset)}</>;
  return <>{percentText(weightShare(view, leader.weight))}</>;
}

/** The month's contributors ranked from the live snapshot with their projected share; a projection, never an award. */
export function CycleAllocation({ view, updatedAt, project, committedMinor }: CycleAllocationProps) {
  const reviewers = new Map(reviewerStandings(view.ledger).map((reviewer) => [reviewer.actor.id, reviewer]));
  const leaders: ReadonlyArray<PoolContributor | PrizeContributor> = [...view.leaders].sort((left, right) => left.rank - right.rank || left.actor.id.localeCompare(right.actor.id));
  const budget = project.reward.reviewBudget;
  return (
    <section aria-labelledby="allocation-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="allocation-heading" className="text-xl font-semibold text-foreground">
          {formatMonth(view.cycle.id)}
        </h2>
        <p className="text-sm text-muted-foreground">Updated {formatDate(updatedAt)}</p>
        {budget?.fundingState === "committed" ? (
          <p>
            <FundedMeter label="Reviews" fundedMinor={budget.committedMinor} funded={formatRewardMinor(budget.committedMinor)} cap={budget.monthlyCapDisplay} />
          </p>
        ) : null}
        {view.kind === "monthly-pool" && view.project.reward.kind === "monthly-pool" ? (
          <p>
            {unfunded(view, committedMinor) ? (
              <Status presentation={{ tone: "Neutral", icon: "Dot", label: "Not funded yet" }} />
            ) : (
              <FundedMeter
                fundedMinor={committedMinor ?? 0n}
                capMinor={capFor(view.project.reward, view.cycle.id)}
                funded={formatRewardMinor(committedMinor ?? 0n, project.rewardAsset)}
                cap={formatRewardCapDisplay(project.reward.monthlyCapDisplay, project.rewardAsset)}
              />
            )}
          </p>
        ) : null}
      </div>
      {leaders.length === 0 ? (
        <EmptyState title="No accepted work" />
      ) : (
        <Table label={`${project.name} leaderboard`}>
          <TableCaption visuallyHidden>{project.name} leaderboard</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Rank</TableHead>
              <TableHead>Contributor</TableHead>
              <TableHead>Points</TableHead>
              <TableHead>{unfunded(view, committedMinor) ? "Share" : "Projected share"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaders.map((leader) => {
              const reviewer = reviewers.get(leader.actor.id);
              return (
                <TableRow key={leader.actor.id}>
                  <TableCell className="font-mono tabular-nums">#{leader.rank}</TableCell>
                  <TableCell>
                    <a href={`/contributors/${encodeURIComponent(leader.actor.login)}`} className={linkClass}>
                      <Avatar name={leader.actor.login} src={leader.actor.avatarUrl} />
                      <span className="flex flex-col">
                        <strong>{leader.actor.login}</strong>
                        <small className="text-xs text-muted-foreground">{leader.acceptedOutcomeCount} accepted</small>
                      </span>
                    </a>
                  </TableCell>
                  <TableCell>
                    <strong className="font-mono tabular-nums">{leader.points.toLocaleString("en-US")}</strong>
                    {reviewer ? (
                      <span className="block" title="Review points">
                        <Status presentation={{ tone: "Neutral", icon: "Eye", label: reviewer.reviewPoints.toLocaleString("en-US") }} />
                        <span className="sr-only"> review points</span>
                      </span>
                    ) : null}
                    {leader.penaltyPoints > 0 ? (
                      <span className="block" title="Slopbot penalty">
                        <Status presentation={{ tone: "Negative", icon: "Alert", label: `−${leader.penaltyPoints.toLocaleString("en-US")}` }} />
                        <span className="sr-only"> point Slopbot penalty</span>
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <strong className="font-mono tabular-nums">
                      <RewardValue view={view} leader={leader} project={project} committedMinor={committedMinor} />
                    </strong>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
