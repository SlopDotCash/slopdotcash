import { Eye } from "lucide-react";
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
  FundedMeter,
  formatCycleMonth,
  formatDate,
  formatMicroUsdc,
  formatPercent,
  formatPointsFromThirds,
  formatRewardMinor,
  monthlyPoolUnfunded,
  ReviewBudget,
  StatusBadge,
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
        {view.project.reward.reviewBudget?.fundingState === "committed" ? (
          <p>
            <ReviewBudget reviewBudget={view.project.reward.reviewBudget} />
          </p>
        ) : null}
        {view.reward.kind === "monthly-pool" ? (
          <p>
            {monthlyPoolUnfunded(view.project.reward) ? (
              <StatusBadge>{UNFUNDED_POOL_HEADLINE}</StatusBadge>
            ) : (
              <FundedMeter
                fundedMinor={view.project.reward.committedMinor}
                capMinor={view.project.reward.monthlyCapMinor}
                funded={formatRewardMinor(
                  view.project.reward.committedMinor,
                  view.project.rewardAsset,
                )}
                cap={view.project.reward.monthlyCapDisplay}
              />
            )}
          </p>
        ) : null}
      </div>
      {view.leaders.length === 0 ? (
        <EmptyState text="No accepted work" />
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
                        <small>{leader.acceptedOutcomeCount} accepted</small>
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
                      <StatusBadge tone="danger" title="Slopbot penalty">
                        −{formatPointsFromThirds(leader.penaltyThirds)}
                        <span className="visually-hidden">
                          {" "}
                          point Slopbot penalty
                        </span>
                      </StatusBadge>
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
      <StatusBadge
        title={`Excluded from payout: ${PAYOUT_EXCLUSION_LABELS[leader.payoutExclusion]}`}
      >
        Excluded
        <span className="visually-hidden">
          {" "}
          from payout ({PAYOUT_EXCLUSION_LABELS[leader.payoutExclusion]})
        </span>
      </StatusBadge>
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
  // A funded stablecoin is USDC. A funded token or native coin uses that
  // asset's base units. The cent-rounded display field is USDC-only, so a
  // token must use the exact simulated base units (PRD section 6).
  if (!monthlyPoolUnfunded(view.project.reward)) {
    const asset = view.project.rewardAsset;
    if (!asset || asset.kind === "stablecoin") {
      return formatMicroUsdc(
        requiredProjection(leader.simulatedDisplayMinor, "display amount"),
      );
    }
    return formatRewardMinor(
      requiredProjection(leader.simulatedMinor, "amount"),
      asset,
    );
  }
  const totalWeight = view.leaders.reduce(
    (total, entry) => total + entry.adjustedWeight,
    0,
  );
  return formatPercent(
    totalWeight > 0
      ? Math.round((leader.adjustedWeight * 1_000_000) / totalWeight)
      : 0,
  );
}

function ReviewContribution({ reviewer }: { reviewer?: ReviewerLeader }) {
  if (!reviewer) return null;
  return (
    <small className="review-score-detail">
      <StatusBadge icon={<Eye />} title="Review points">
        {formatPointsFromThirds(reviewer.reviewThirds)}
        <span className="visually-hidden"> review points</span>
      </StatusBadge>
    </small>
  );
}
