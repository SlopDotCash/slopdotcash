// spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/presentation.md, "Amounts display exactly in their asset's decimals with grouped whole digits and no trailing fraction zeros"
import type { CycleMoneyLines } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { formatRewardMinor } from "../../kernels/assetText.ts";

export type AmountPhase = "suggestedMinor" | "approvedMinor" | "paidMinor";

export const amountPhases: ReadonlyArray<readonly [string, AmountPhase]> = [
  ["Suggested", "suggestedMinor"],
  ["Approved", "approvedMinor"],
  ["Paid", "paidMinor"],
];

export type CycleAmountHistoryProps = {
  /** The record's amounts at each phase, in USDC micro-units, with the pool and review lines when recorded. */
  amounts: Readonly<Record<AmountPhase, string>> & { readonly lines?: CycleMoneyLines };
};

/** A USDC micro-unit amount, exactly. @throws {never} */
export function usdcText(minor: string): string {
  return formatRewardMinor(parseBaseUnits(minor) ?? 0n);
}

/** The suggested, approved and paid amounts of a cycle or a contributor row, each split into pool and review lines when recorded. */
export function CycleAmountHistory({ amounts }: CycleAmountHistoryProps) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {amountPhases.map(([label, key]) => (
        <div key={key} className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="font-mono tabular-nums">
            {usdcText(amounts[key])}
            {amounts.lines ? (
              <small className="block text-xs text-muted-foreground">
                Pool {usdcText(amounts.lines.sharedPool[key])} + review {usdcText(amounts.lines.reviewBudget[key])}
              </small>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
