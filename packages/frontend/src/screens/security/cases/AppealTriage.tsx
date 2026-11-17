// spec/security/cases.md, "Slopbot drafts advice for each appeal and always escalates a private case"; spec/security/cases.md, "An independent moderator upholds or returns the appeal"
import { Alert } from "@repo/ui";
import { escalationLabels } from "./labels.ts";
import { Fact, RetryButton, type RetryProps } from "./parts.tsx";

/** Slopbot's first triage of an open appeal: a draft for the moderator who decides; it never decides the appeal. */
export function AppealTriage({ record, busy, error, onRetry }: RetryProps) {
  const triage = record.appealTriage ?? null;
  const headingId = `appeal-triage-${record.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h4 id={headingId} className="font-semibold text-foreground">
        Slopbot appeal triage
      </h4>
      {triage === null ? (
        <p className="text-muted-foreground">No appeal triage yet.</p>
      ) : triage.state === "running" ? (
        <p aria-live="polite" className="text-muted-foreground">
          Slopbot is drafting a resolution…
        </p>
      ) : triage.state === "complete" ? (
        <>
          <dl className="flex flex-col gap-2">
            <Fact term="Drafted resolution">{triage.proposedOutcome === "return" ? "Return the case for a new technical review" : "Keep the decision"}</Fact>
            <Fact term="Confidence">{triage.confidence === null ? "—" : `${Math.round(triage.confidence * 100)}%`}</Fact>
            <Fact term="Escalated to a moderator">{triage.escalationReasons.map((reason) => escalationLabels[reason] ?? reason).join("; ")}</Fact>
          </dl>
          <p>{triage.rationale}</p>
          <p className="text-sm text-muted-foreground">Slopbot draft. The appeal text can try to influence it; a moderator decides.</p>
        </>
      ) : (
        <p className="text-muted-foreground">
          {triage.state === "unavailable" ? "Slopbot triage is unavailable. A moderator decides without a draft." : "The appeal triage failed. A moderator decides without a draft."}
        </p>
      )}
      {record.allowedActions.includes("triage-appeal") ? <RetryButton busy={busy} label="Run the appeal triage again" onRetry={onRetry} /> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </section>
  );
}
