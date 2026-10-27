import { Link } from "./Link";
import type { PayoutExclusionRelationship } from "./lib/payout-exclusions.mjs";
import {
  type ProjectContributor,
  type ProjectView,
  requiredProjection,
} from "./lib/project-view";
import {
  type ReviewerLeader,
  selectReviewerLeaders,
} from "./lib/reviewer-leaders";
import {
  Avatar,
  EmptyState,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  formatPercent,
  formatPointsFromThirds,
  monthlyPoolLabel,
  monthlyPoolUnfunded,
  reviewBudgetLabel,
  UNFUNDED_POOL_HEADLINE,
} from "./Presentation";

const PAYOUT_EXCLUSION_LABELS: Record<PayoutExclusionRelationship, string> = {
  owner: "owner",
  "funded-employee": "funded employee",
  "related-party": "related party",
};

export function CycleAllocation({
  updatedAt,
  view,
}: {
  updatedAt: string;
  view: ProjectView;
}) {
  const reviewers = new Map(
    selectReviewerLeaders(view.ledger).map((reviewer) => [
      reviewer.actor.id,
      reviewer,
    ]),
  );
  const leaders = [...view.leaders].sort(
    (left, right) =>
      left.rank - right.rank || left.actor.id.localeCompare(right.actor.id),
  );
  return (
    <section className="section project-leader-section">
      <div className="section-heading">
        <h2>{formatCycleMonth(view.cycle.id)}</h2>
        <p className="data-freshness">Updated {formatDate(updatedAt)}</p>
        {view.project.reward.reviewBudget ? (
          <p>{reviewBudgetLabel(view.project.reward.reviewBudget)}</p>
        ) : null}
        {view.reward.kind === "monthly-pool" ? (
          <p>
            {monthlyPoolUnfunded(view.project.reward)
              ? `${UNFUNDED_POOL_HEADLINE}.`
              : `Projected from accepted work · ${monthlyPoolLabel(view.project.reward)}.`}
          </p>
        ) : null}
      </div>
      {view.leaders.length === 0 ? (
        <EmptyState text="No accepted work this month yet." />
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
                <th scope="col">Points</th>
                <th scope="col">
                  {view.reward.kind === "monthly-pool" &&
                  monthlyPoolUnfunded(view.project.reward)
                    ? "Share"
                    : "Projected share"}
                </th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((leader) => (
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
                          {leader.acceptedOutcomeCount} accepted{" "}
                          {leader.acceptedOutcomeCount === 1
                            ? "event"
                            : "events"}
                        </small>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <strong>
                      {formatPointsFromThirds(leader.scoreThirds)}
                    </strong>
                    <ReviewContribution
                      reviewer={reviewers.get(leader.actor.id)}
                    />
                    {leader.penaltyThirds > 0 ? (
                      <small>
                        After a {formatPointsFromThirds(leader.penaltyThirds)}{" "}
                        point Slopbot penalty
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
  );
}

function RewardValue({
  leader,
  view,
}: {
  leader: ProjectContributor;
  view: ProjectView;
}) {
  if (leader.payoutExclusion)
    return (
      <>
        Excluded from payout ({PAYOUT_EXCLUSION_LABELS[leader.payoutExclusion]})
      </>
    );
  if (view.reward.kind === "external-prize-share")
    return (
      <>
        {formatPercent(
          requiredProjection(leader.projectedSharePartsPerMillion, "share"),
        )}{" "}
        share
      </>
    );
  // Token amounts are in the token's base units, never dollars.
  if (
    view.project.rewardAsset?.kind !== "token" &&
    !monthlyPoolUnfunded(view.project.reward)
  ) {
    return formatMicroUsdc(
      requiredProjection(leader.simulatedDisplayMinor, "display amount"),
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
      of payment weight
    </>
  );
}

function ReviewContribution({ reviewer }: { reviewer?: ReviewerLeader }) {
  if (!reviewer) return null;
  return (
    <small className="review-score-detail">
      Includes {formatPointsFromThirds(reviewer.reviewThirds)} review points
    </small>
  );
}
