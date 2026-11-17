// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import { Avatar, EmptyState, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { formatRewardMinor, monthlyPoolLabel, monthlyPoolUnfunded } from "../../kernels/assetText.ts";
import type { ExclusionRelationship, PoolContributor, PrizeContributor, ProjectCycleView } from "../../projections/projectView.ts";
import { reviewerStandings } from "../../projections/standings.ts";
import { reviewBudgetLabel } from "../home/listing.ts";
import { formatDate, formatMonth, type ShownProject } from "../projects/index.ts";
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
  if (leader.payoutExclusion) return <>Excluded from payout ({exclusionLabels[leader.payoutExclusion]})</>;
  if ("projectedSharePartsPerMillion" in leader) return <>{percentText(leader.projectedSharePartsPerMillion)} share</>;
  if (!unfunded(view, committedMinor)) return <>{formatRewardMinor(leader.simulatedMinor, project.rewardAsset)}</>;
  return <>{percentText(weightShare(view, leader.weight))} of payment weight</>;
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
        {budget ? <p>{reviewBudgetLabel(budget)}</p> : null}
        {view.kind === "monthly-pool" && view.project.reward.kind === "monthly-pool" ? (
          <p>
            {unfunded(view, committedMinor)
              ? "Not funded yet."
              : `Projected from accepted work · ${monthlyPoolLabel({ fundingState: view.project.reward.fundingState, committedMinor: committedMinor ?? 0n, monthlyCapDisplay: project.reward.monthlyCapDisplay }, project.rewardAsset)}.`}
          </p>
        ) : null}
      </div>
      {leaders.length === 0 ? (
        <EmptyState title="No accepted work this month yet." />
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
                        <small className="text-xs text-muted-foreground">
                          {leader.acceptedOutcomeCount} accepted {leader.acceptedOutcomeCount === 1 ? "event" : "events"}
                        </small>
                      </span>
                    </a>
                  </TableCell>
                  <TableCell>
                    <strong className="font-mono tabular-nums">{leader.points.toLocaleString("en-US")}</strong>
                    {reviewer ? <small className="block text-xs text-muted-foreground">Includes {reviewer.reviewPoints.toLocaleString("en-US")} review points</small> : null}
                    {leader.penaltyPoints > 0 ? <small className="block text-xs text-muted-foreground">After a {leader.penaltyPoints.toLocaleString("en-US")} point Slopbot penalty</small> : null}
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
