import { Link } from "./Link";
import type { ProjectContributor, ProjectView } from "./lib/project-view";
import {
  formatThirds,
  type ReviewerLeader,
  selectReviewerLeaders,
} from "./lib/reviewer-leaders";
import type { DataState } from "./lib/use-snapshot";
import { ContributorStandings } from "./Points";
import {
  Avatar,
  EmptyState,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  formatPercent,
  monthlyPoolLabel,
  monthlyPoolUnfunded,
  reviewBudgetLabel,
  UNFUNDED_POOL_HEADLINE,
} from "./Presentation";

interface CycleAllocationProps {
  updatedAt: string;
  view: ProjectView;
}
export function ProjectLeaderboard({
  state,
  retry,
  ...props
}: CycleAllocationProps & {
  state: DataState;
  retry: () => void;
}) {
  return (
    <div id="contributors">
      <ContributorStandings
        projectId={props.view.project.id}
        scoreState={state}
        retryScore={retry}
        compact
      />
      <details>
        <summary>Cycle allocation details</summary>
        <CycleAllocation {...props} />
      </details>
    </div>
  );
}

export function CycleAllocation({ updatedAt, view }: CycleAllocationProps) {
  const reviewers = new Map(
    selectReviewerLeaders(view.ledger).map((reviewer) => [
      reviewer.actor.id,
      reviewer,
    ]),
  );
  return (
    <>
      <section className="section project-leader-section">
        <div className="section-heading">
          <h2>{formatCycleMonth(view.cycle.id)} leaderboard.</h2>
          <p className="data-freshness">Updated {formatDate(updatedAt)}</p>
          {view.project.reward.reviewBudget ? (
            <p>{reviewBudgetLabel(view.project.reward.reviewBudget)}</p>
          ) : null}
          {view.reward.kind === "monthly-pool" ? (
            <p>
              {monthlyPoolUnfunded(view.project.reward)
                ? `${UNFUNDED_POOL_HEADLINE}.`
                : `Shares simulate the ${monthlyPoolLabel(view.project.reward)} cap.`}{" "}
              Not approved payouts.
            </p>
          ) : null}
        </div>
        {view.leaders.length === 0 ? (
          <EmptyState text="No accepted outcomes in this cycle yet." />
        ) : (
          <div className="leader-table">
            <table className="leader-grid">
              <caption className="visually-hidden">
                {view.project.name} leaderboard
              </caption>
              <thead>
                <tr className="leader-row project-leader-head">
                  <th scope="col">Rank</th>
                  <th scope="col">Contributor</th>
                  <th scope="col">Score</th>
                  <th scope="col">
                    {view.reward.kind === "monthly-pool" &&
                    monthlyPoolUnfunded(view.project.reward)
                      ? "Share of score"
                      : "Simulated share"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.leaders.map((leader) => (
                  <tr
                    className="leader-row project-leader-row"
                    key={leader.actor.id}
                  >
                    <td className="rank-cell">#{leader.rank}</td>
                    <td className="person-cell">
                      <Link
                        className="person-link"
                        href={`/contributors/${encodeURIComponent(leader.actor.login)}`}
                      >
                        <Avatar actor={leader.actor} />
                        <span>
                          <strong>{leader.actor.login}</strong>
                          <small>
                            {leader.acceptedOutcomeCount} accepted events
                          </small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <strong title={`Exact score ${leader.scoreThirds}/3`}>
                        {formatThirds(leader.scoreThirds)}
                      </strong>
                      <ReviewContribution
                        reviewer={reviewers.get(leader.actor.id)}
                      />
                      {leader.computeBonusBasisPoints > 0 ? (
                        <small>
                          +{leader.computeBonusBasisPoints / 100}% receipt
                          evidence
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <strong>
                        <RewardValue leader={leader} view={view} />
                      </strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export function RewardValue({
  leader,
  view,
}: {
  leader: ProjectContributor;
  view: ProjectView;
}) {
  if (leader.simulatedMinor === null) {
    return (
      <>{formatPercent(leader.projectedSharePartsPerMillion ?? 0)} share</>
    );
  }
  if (!monthlyPoolUnfunded(view.project.reward)) {
    return formatMicroUsdc(
      leader.simulatedDisplayMinor ?? leader.simulatedMinor,
    );
  }
  const totalWeight = view.leaders.reduce(
    (total, entry) => total + entry.adjustedWeight,
    0,
  );
  return (
    <>
      {formatPercent(
        totalWeight > 0
          ? Math.round((leader.adjustedWeight * 1_000_000) / totalWeight)
          : 0,
      )}{" "}
      of score
    </>
  );
}

function ReviewContribution({ reviewer }: { reviewer?: ReviewerLeader }) {
  if (!reviewer) return null;
  return (
    <small className="review-score-detail">
      Includes {formatThirds(reviewer.reviewThirds)} review point
      {reviewer.reviewThirds === 3 ? "" : "s"} · {reviewer.reviewEventCount}{" "}
      scored review
      {reviewer.reviewEventCount === 1 ? "" : "s"}
    </small>
  );
}
