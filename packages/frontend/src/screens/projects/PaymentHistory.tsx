// spec/frontend/projections.md, "Ordinary public payment rows require finalized evidence and a public account"; spec/frontend/projections.md, "Award, funding and settlement status are independent facts"; spec/frontend/paymentHistory.md, "Rows publish only after the final page, and every inconsistency is an error"
import type { CycleIndexEntry, DirectTransfer } from "@repo/settlement/client";
import { parseBaseUnits } from "@repo/settlement/kernels/amounts";
import { Alert, Button, ExternalLink, Status, Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@repo/ui";
import { useState } from "react";
import type { ReadStatus } from "../../../gen/frontend__requests.ts";
import { formatRewardMinor } from "../../kernels/assetText.ts";
import type { Shown } from "../home/listing.ts";
import { cycleLabel, directMonths, formatDate, formatMonth, historyShown } from "./summary.ts";

export type PaymentHistoryProps = {
  /** The project whose cycles and direct payments these are. */
  project: { readonly id: string; readonly slug: string; readonly name: string; readonly externalPrize: boolean };
  /** The project's published cycles, newest first; the section waits for them. */
  cycles: ReadonlyArray<CycleIndexEntry> | undefined;
  /** The project's direct transfers, read whole. */
  direct: Shown<ReadonlyArray<DirectTransfer>>;
  /** Now, in milliseconds, against which a cycle's review window is judged. */
  nowMs: number;
};

const linkClass = "text-primary underline underline-offset-4 hover:decoration-2";

const settled: ReadonlySet<ReadStatus> = new Set(["Current", "Empty", "Stale"]);

const pending: ReadonlySet<ReadStatus> = new Set(["Idle", "Loading"]);

/** @throws {RangeError} */
function usdc(minor: string): string {
  return formatRewardMinor(parseBaseUnits(minor) ?? 0n);
}

/** The project's closed cycles and the direct payments made for each month's work; loading never reads as an empty history. */
export function PaymentHistory({ project, cycles, direct, nowMs }: PaymentHistoryProps) {
  const [showHistory, setShowHistory] = useState(false);
  if (cycles === undefined) return null;
  const { externalPrize } = project;
  const months = directMonths(direct.value ?? []);
  const directLoading = !externalPrize && pending.has(direct.status);
  const directFailed = !externalPrize && !settled.has(direct.status) && !pending.has(direct.status);
  if (cycles.length === 0 && months.length === 0 && (externalPrize || settled.has(direct.status))) return null;
  const limited = months.length > historyShown || cycles.length > historyShown;
  return (
    <section aria-label={externalPrize ? "Cycle history" : "Payment history"} className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-foreground">{externalPrize ? "Cycle history" : "Payment history"}</h2>
      {directFailed ? (
        <Alert
          variant="warn"
          announcement="Polite"
          action={
            <Button variant="outline" size="sm" onClick={direct.onRetry}>
              Retry direct payments
            </Button>
          }
        >
          Direct payments unavailable.
        </Alert>
      ) : null}
      {directLoading ? <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Loading direct payments…" }} /> : null}
      {(showHistory ? months : months.slice(0, historyShown)).map((month) => (
        <p key={month.month} className="flex flex-col gap-1">
          <strong className="font-mono font-medium tabular-nums">{formatRewardMinor(month.amountMicro)} paid directly</strong>
          <span className="text-sm text-muted-foreground">
            Paid {formatDate(month.paidOn)} for {formatMonth(month.month)} work · {month.count} transfers ·{" "}
            <ExternalLink href={`/api/v1/payments/projects/${encodeURIComponent(project.id)}/direct-transfers`} className={linkClass}>
              Disclosure
            </ExternalLink>
          </span>
        </p>
      ))}
      {cycles.length === 0 ? (
        directLoading ? null : <p className="text-muted-foreground">No cycles have closed yet.</p>
      ) : (
        <Table label={`${project.name} cycles`}>
          <TableCaption visuallyHidden>{project.name} cycles</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Cycle</TableHead>
              {externalPrize ? null : (
                <>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                </>
              )}
              <TableHead>State</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(showHistory ? cycles : cycles.slice(0, historyShown)).map((cycle) => (
              <TableRow key={cycle.cycleId}>
                <TableHead scope="row">
                  <a href={`/cycles/${project.slug}/${cycle.cycleId}`} className={linkClass}>
                    {cycle.cycleId}
                  </a>
                </TableHead>
                {externalPrize ? null : (
                  <>
                    <TableCell className="text-right font-mono tabular-nums">{usdc(cycle.reward.approvedMinor)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{usdc(cycle.reward.feeMinor)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{usdc(cycle.reward.paidMinor)}</TableCell>
                  </>
                )}
                <TableCell>{cycleLabel(cycle, nowMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {limited ? (
        <Button variant="outline" className="self-start" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
          {showHistory ? "Show recent history" : `Show complete ${externalPrize ? "cycle" : "payment"} history`}
        </Button>
      ) : null}
    </section>
  );
}
