// spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"
import { Status } from "@repo/ui";
import { type FeeReport, networkConversions } from "./feeReport.ts";

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
          {network.lines.map((line) => (
            <dd key={line} className="text-sm break-words text-foreground">
              {line}
            </dd>
          ))}
          {network.none ? <dd className="text-sm text-muted-foreground">No conversions</dd> : null}
        </div>
      ))}
    </dl>
  );
}
