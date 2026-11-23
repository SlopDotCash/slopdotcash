// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/slopbot/categories.md, "The verdict schema has ten categories and the PRD table names their actions"; spec/slopbot/categories.md, "Debits are whole Points fixed by the table version in force when the debit is recorded"
import { pointsOf, type ScoreTier, scoreTiers, scoreTierThirds } from "@repo/points/client";
import { type Category, currentTableVersion, debitFor, moderatorReview, permittedAction } from "@repo/slopbot/client";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";

export const pointsNotice = "Points have no cash value and cannot be transferred or redeemed.";

const tierLabels = { micro: "Micro", small: "Small", medium: "Medium", large: "Large", xl: "XL", exceptional: "Exceptional" } as const satisfies Record<ScoreTier, string>;

interface PenaltyRow {
  readonly label: string;
  readonly category: Category;
}

const penaltyRows: ReadonlyArray<PenaltyRow> = [
  { label: "Spam", category: "Spam" },
  { label: "Scam or malicious", category: "Scam" },
  { label: "Clear violation of a quoted project rule", category: "Busywork" },
  { label: "Required evidence missing from a signed Slop PR", category: "MissingEvidence" },
  { label: "Low quality", category: "LowQuality" },
  { label: "Duplicate", category: "Duplicate" },
  { label: "Out of scope", category: "OutOfScope" },
];

const figure = "font-mono tabular-nums";

const points = (value: number) => value.toLocaleString("en-US");

/** @throws {never} */
function penaltyAction(category: Category): string {
  return (permittedAction(category) === "CloseAllowed" ? "Close" : "Label") + (moderatorReview(category) ? " + account review" : "");
}

/** The contribution tiers Slopbot sizes accepted work with, in Points. */
export function ContributionPointTiers() {
  return (
    <Table label="Contribution point tiers">
      <TableCaption>Contribution tiers</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Tier</TableHead>
          <TableHead>Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scoreTiers.map((tier) => (
          <TableRow key={tier}>
            <TableHead scope="row" className="whitespace-normal">
              {tierLabels[tier]}
            </TableHead>
            <TableCell className={figure}>{points(pointsOf(scoreTierThirds(tier)))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The one published penalty table, read from the category table in force. */
export function PenaltyPointTable() {
  return (
    <Table label="Penalty table">
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {penaltyRows.map((row) => (
          <TableRow key={row.category}>
            <TableHead scope="row" className="whitespace-normal">
              {row.label}
            </TableHead>
            <TableCell className={figure}>{penaltyAction(row.category)}</TableCell>
            <TableCell className={figure}>{points(debitFor(currentTableVersion, row.category))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
