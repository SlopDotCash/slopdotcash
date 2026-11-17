// spec/points/scoringPolicy.md, "A scored source records its provenance and keeps the 10-Point minimum"; spec/slopbot/categories.md, "The verdict schema has ten categories and the PRD table names their actions"; spec/slopbot/categories.md, "Debits are whole Points fixed by the table version in force when the debit is recorded"
import { pointsOf, type ScoreTier, scoreTiers, scoreTierThirds } from "@repo/points/client";
import { type Category, currentTableVersion, debitFor, moderatorReview, permittedAction } from "@repo/slopbot/client";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";

export const pointsNotice = "Points have no cash value and cannot be transferred or redeemed.";

const tierLabels = { micro: "Micro", small: "Small", medium: "Medium", large: "Large", xl: "XL", exceptional: "Exceptional" } as const satisfies Record<ScoreTier, string>;

interface PenaltyRow {
  readonly label: string;
  readonly category: Category;
  readonly actionNote?: string;
}

const penaltyRows: ReadonlyArray<PenaltyRow> = [
  { label: "Spam", category: "Spam" },
  { label: "Scam or malicious", category: "Scam" },
  { label: "Clear violation of a quoted project rule", category: "Busywork" },
  { label: "Low quality", category: "LowQuality", actionNote: " (closure-eligible authors only)" },
  { label: "Duplicate", category: "Duplicate" },
  { label: "Out of scope", category: "OutOfScope" },
];

const points = (value: number) => value.toLocaleString("en-US");

/** @throws {never} */
function penaltyAction({ category, actionNote }: PenaltyRow): string {
  return (permittedAction(category) === "CloseAllowed" ? "Close" : "Label") + (moderatorReview(category) ? "; moderator reviews the account" : "") + (actionNote ?? "");
}

/** The contribution tiers Slopbot sizes accepted work with, in Points. */
export function ContributionPointTiers() {
  return (
    <Table label="Contribution point tiers">
      <TableCaption>Contribution tiers</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Tier</TableHead>
          <TableHead className="text-right">Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scoreTiers.map((tier) => (
          <TableRow key={tier}>
            <TableHead scope="row" className="text-foreground">
              {tierLabels[tier]}
            </TableHead>
            <TableCell className="text-right font-mono tabular-nums">{points(pointsOf(scoreTierThirds(tier)))}</TableCell>
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
      <TableCaption>Published penalty table</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Slopbot category</TableHead>
          <TableHead>Action</TableHead>
          <TableHead className="text-right">Debit (points)</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {penaltyRows.map((row) => (
          <TableRow key={row.category}>
            <TableHead scope="row" className="text-foreground">
              {row.label}
            </TableHead>
            <TableCell>{penaltyAction(row)}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{points(debitFor(currentTableVersion, row.category))}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
