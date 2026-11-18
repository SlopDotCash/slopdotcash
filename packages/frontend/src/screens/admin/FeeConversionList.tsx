// spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"
import { CopyButton, Status } from "@repo/ui";
import { type FeeReport, networkConversions } from "./feeReport.ts";
import { Chip } from "./parts.tsx";

export type FeeConversionListProps = {
  /** The administrator's fee conversion report, already checked. */
  report: FeeReport;
};

/** Each network's target, USDC or not converted, and its finalized live conversion totals. */
export function FeeConversionList({ report }: FeeConversionListProps) {
  return (
    <dl className="flex flex-col gap-4 rounded-md border border-border p-4">
      {networkConversions(report).map((network) => (
        <div key={network.network} className="flex flex-col gap-1">
          <dt className="text-sm font-semibold text-foreground">{network.name}</dt>
          <dd>
            <Status presentation={{ tone: "Neutral", icon: network.target === "USDC" ? "Refresh" : "Slash", label: network.target }} />
          </dd>
          {network.totals.map((total) => (
            <dd key={total.token} className="flex flex-wrap items-center gap-2 text-sm break-words text-foreground">
              <code title={total.token} className="font-mono text-xs">
                {total.tokenPreview}
              </code>
              <CopyButton text={total.token} label="Copy token address" />
              <span>
                <span title="Base units">{total.amountIn}</span> → {total.converted}
              </span>
              <Chip title={`${total.conversions} ${total.conversions === 1 ? "conversion" : "conversions"}`}>×{total.conversions}</Chip>
            </dd>
          ))}
          {network.none ? (
            <dd className="text-sm text-muted-foreground">
              <span aria-hidden>—</span>
              <span className="sr-only">No conversions</span>
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
