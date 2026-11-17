// spec/fees/feeReport.md, "Only an administrator reads the fee report, and it never contains a signed transaction or secret"; spec/fees/feeReport.md, "The report shows the latest 100 rows, finalized live totals per token as decimal strings, 24-hour state counts and each network's target"; spec/fees/conversion.md, "Each evaluation records one outcome from the pinned order of checks"
import { useState } from "react";
import type { PageRuntime } from "../../app/runtime.vibe";
import { useRun } from "../setup/proposal/run.ts";
import { adminReadMessages, feeConversionReport } from "./actions.vibe";
import { FeeConversionList } from "./FeeConversionList.tsx";
import { LoadFailure, Waiting } from "./parts.tsx";

export type FeeConversionsProps = {
  runtime: PageRuntime;
  actorId: string;
};

/** The administrator's read-only fee conversion report; a report that does not read as one is an error with Retry. */
export function FeeConversions({ runtime, actorId }: FeeConversionsProps) {
  const [attempt, setAttempt] = useState(0);
  const read = useRun(runtime, `fees:${actorId}:${attempt}`, () => feeConversionReport(actorId), adminReadMessages.fees);
  return (
    <section aria-labelledby="admin-fee-conversions" className="flex flex-col gap-4">
      <h2 id="admin-fee-conversions" className="text-lg font-semibold text-foreground">
        Fee conversions
      </h2>
      {read === undefined || read.status === "running" ? (
        <Waiting>Loading fee conversions…</Waiting>
      ) : read.status === "failed" ? (
        <LoadFailure message={read.message} onRetry={() => setAttempt((count) => count + 1)} />
      ) : (
        <FeeConversionList report={read.value} />
      )}
    </section>
  );
}
