// spec/security/cases.md, "A technical decision records the finding, duplicate identity and relatedness"; spec/security/privacy.md, "Read authorization comes from the current case roles and is audited before delivery"
import { Alert } from "@repo/ui";
import { lossLabels } from "./labels.ts";
import { Fact, RetryButton, type RetryProps } from "./parts.tsx";

/** The automatic private analysis, for the owner and triagers only: a proposal the maintainer decides on. */
export function AnalysisPanel({ record, busy, error, onRetry }: RetryProps) {
  const analysis = record.analysis ?? null;
  const headingId = `analysis-${record.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="font-semibold text-foreground">
        Advisory assessment
      </h4>
      {analysis === null ? (
        <p className="text-muted-foreground">No analysis yet.</p>
      ) : analysis.state === "running" ? (
        <p aria-live="polite" className="text-muted-foreground">
          Analyzing the private report…
        </p>
      ) : analysis.state === "complete" ? (
        <>
          <p>{analysis.summary}</p>
          <dl className="flex flex-col gap-2">
            <Fact term="Proposed severity">{analysis.proposedSeverity ?? "—"}</Fact>
            <Fact term="Loss of funds">{analysis.potentialLoss ? (lossLabels[analysis.potentialLoss] ?? analysis.potentialLoss) : "—"}</Fact>
            <Fact term="Possible duplicates">{analysis.duplicateCaseIds.length === 0 ? "None found" : analysis.duplicateCaseIds.join(", ")}</Fact>
            <Fact term="Remediation">{analysis.remediation ?? "—"}</Fact>
          </dl>
          <p className="text-sm text-muted-foreground">AI proposal. The report text can try to influence it; you decide.</p>
        </>
      ) : (
        <p className="text-muted-foreground">{analysis.state === "unavailable" ? "Analysis unavailable. Run it again later." : "The analysis failed."}</p>
      )}
      {record.allowedActions.includes("analyze") ? <RetryButton busy={busy} label="Run the analysis again" onRetry={onRetry} /> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </section>
  );
}
