// spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { Alert, Spinner, Status } from "@repo/ui";
import { Sparkles } from "lucide-react";
import { badge, lossLabels } from "./labels.ts";
import { Fact, InfoTip, RetryButton, type RetryProps } from "./parts.tsx";

/** The automatic private analysis, for the owner and triagers only: a proposal the maintainer decides on. */
export function AnalysisPanel({ record, busy, error, onRetry }: RetryProps) {
  const analysis = record.analysis ?? null;
  const canRun = record.allowedActions.includes("analyze");
  if (analysis === null && !canRun) return null;
  const headingId = `analysis-${record.id}`;
  const loss = analysis?.potentialLoss ? lossLabels[analysis.potentialLoss] : undefined;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="inline-flex items-center gap-2 font-semibold text-foreground">
        <Sparkles aria-hidden className="size-4" /> AI summary
      </h4>
      {analysis === null ? null : analysis.state === "running" ? (
        <Spinner size="sm" label="Analyzing the private report…" />
      ) : analysis.state === "complete" ? (
        <>
          <p>{analysis.summary}</p>
          <dl className="flex flex-col gap-2">
            <Fact term="Proposed severity">{analysis.proposedSeverity ?? "—"}</Fact>
            <Fact term="Loss of funds">{loss ? <Status presentation={badge(loss[0], loss[1])} /> : (analysis.potentialLoss ?? "—")}</Fact>
            <Fact term="Possible duplicates">{analysis.duplicateCaseIds.length === 0 ? "None found" : analysis.duplicateCaseIds.join(", ")}</Fact>
            <Fact term="Remediation">{analysis.remediation ?? "—"}</Fact>
          </dl>
          <p className="flex items-center gap-2">
            <Status presentation={badge("AI")} /> <InfoTip text="AI proposal; you decide" />
          </p>
        </>
      ) : (
        <p>
          <Status presentation={analysis.state === "unavailable" ? badge("Unavailable") : badge("Failed", "Negative", "Alert")} />
        </p>
      )}
      {canRun ? <RetryButton busy={busy} label={busy ? "Starting…" : "Run the analysis again"} onRetry={onRetry} /> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </section>
  );
}
