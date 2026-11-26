// spec/security/cases.md, "Slopbot drafts advice for each appeal and always escalates a private case"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Alert, Progress, Spinner, Status } from "@repo/ui";
import { Bot } from "lucide-react";
import { badge, escalationLabels } from "./labels.ts";
import { RetryButton, type RetryProps } from "./parts.tsx";

/** Slopbot's first triage of an open appeal: a draft for the moderator who decides; it never decides the appeal. */
export function AppealTriage({ record, busy, error, onRetry }: RetryProps) {
  const triage = record.appealTriage ?? null;
  const canRun = record.allowedActions.includes("triage-appeal");
  if (triage === null && !canRun) return null;
  const headingId = `appeal-triage-${record.id}`;
  const confidence = triage?.confidence == null ? null : Math.round(triage.confidence * 100);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="inline-flex items-center gap-2 font-semibold text-foreground">
        <Bot aria-hidden className="size-4" /> Appeal draft
      </h4>
      {triage === null ? null : triage.state === "running" ? (
        <Spinner size="sm" label="Slopbot is drafting a resolution…" />
      ) : triage.state === "complete" ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Status title="Drafted resolution" presentation={badge(triage.proposedOutcome === "return" ? "Return" : "Uphold")} />
            {confidence === null ? null : (
              <>
                <Progress aria-label="Confidence" title="Confidence" value={confidence} max={100} className="w-24" /> {confidence}%
              </>
            )}
            <Status presentation={badge("Moderator decides")} />
          </div>
          {triage.escalationReasons.length === 0 ? null : <p>{triage.escalationReasons.map((reason) => escalationLabels[reason] ?? reason).join("; ")}</p>}
          <p>{triage.rationale}</p>
        </>
      ) : (
        <p>
          <Status presentation={triage.state === "unavailable" ? badge("Unavailable") : badge("Failed", "Negative", "Alert")} />
        </p>
      )}
      {canRun ? <RetryButton busy={busy} label={busy ? "Starting…" : "Run the appeal triage again"} onRetry={onRetry} /> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </section>
  );
}
