// spec/settlement/monthly.md, "Only a current owner, steward or repository administrator changes another recipient's amount"; spec/settlement/allocation.md, "The largest remainders receive the remaining units exactly once"
import { cn } from "@repo/ui";

export type AwardAmountsProps = {
  /** The gross amount, already formatted from exact base units. */
  gross: string;
  /** What the contributor receives after the fee, already formatted. */
  net: string;
  /** The 2% fee, already formatted. */
  fee: string;
  /** Names the gross as the saved allocation rather than a frozen award. */
  saved?: boolean;
  className?: string;
};

/** One recipient's gross, contributor amount and fee, exactly as computed from base units. */
export function AwardAmounts({ gross, net, fee, saved = false, className }: AwardAmountsProps) {
  const rows: ReadonlyArray<readonly [string, string]> = [
    [saved ? "Saved gross" : "Award", gross],
    ["Contributor receives", net],
    ["Fee", fee],
  ];
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm", className)}>
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="font-mono text-foreground tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
