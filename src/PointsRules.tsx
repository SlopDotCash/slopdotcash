import { PENALTY_ROWS } from "./lib/penalty-guide";
import { SCORE_TIERS } from "./lib/score-records";
import { formatPointsFromThirds } from "./Presentation";

const TIER_LABELS = {
  micro: "Micro",
  small: "Small",
  medium: "Medium",
  large: "Large",
  xl: "XL",
  exceptional: "Exceptional",
} as const;

/** The same canonical contribution tiers on the guide and ranking pages. */
export function ContributionPointTiers() {
  return (
    <section
      className="plain-table-wrap score-tier-wrap"
      aria-label="Contribution point tiers"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
      tabIndex={0}
    >
      <table className="plain-table score-tier-table">
        <caption>Contribution tiers</caption>
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">Points</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(SCORE_TIERS).map(([tier, thirds]) => (
            <tr key={tier}>
              <th scope="row">
                {TIER_LABELS[tier as keyof typeof TIER_LABELS]}
              </th>
              <td>{formatPointsFromThirds(thirds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The one published penalty table (PRD section 7). Its rows come from
 * src/lib/penalty-guide.ts, which derives them from PENALTY_TABLE in
 * workers/slopbot/penalties.ts. Debits are Slop Score thirds, shown in
 * points.
 */
export function PenaltyPointTable() {
  return (
    <section
      className="plain-table-wrap score-tier-wrap penalty-table-wrap"
      aria-label="Penalty table"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard access is required to scroll this overflow region.
      tabIndex={0}
    >
      <table className="plain-table score-tier-table">
        <caption>Published penalty table</caption>
        <thead>
          <tr>
            <th scope="col">Slopbot category</th>
            <th scope="col">Action</th>
            <th scope="col">Debit (points)</th>
          </tr>
        </thead>
        <tbody>
          {PENALTY_ROWS.map((row) => (
            <tr key={row.category}>
              <th scope="row">{row.category}</th>
              <td>{row.action}</td>
              <td>{formatPointsFromThirds(row.debitThirds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
