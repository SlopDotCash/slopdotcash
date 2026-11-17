// spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"; spec/security/intake.md, "A new attempt binds authenticated identity, passes admission and keeps its idempotency key"
import { Alert, Button, Disclosure, ExternalLink, StatusIcon } from "@repo/ui";
import { LockKeyhole, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { ReadinessShown } from "./runtime.vibe";
import { utc } from "./summary.ts";

export type IntakePanelProps = {
  readiness: ReadinessShown;
  /** Whether a reporter is signed in, so a stale status can say their draft is kept. */
  signedIn: boolean;
  /** The report form, shown while Slop's private intake is on. */
  form: ReactNode;
  onCheck: () => void;
};

const blocked: Readonly<Record<string, string>> = {
  disabled: "GitHub private vulnerability reporting is turned off for this repository.",
  forbidden: "GitHub refused the private reporting check.",
  unavailable: "Private reporting status is unavailable.",
};

function CheckAgain({ busy, onCheck }: { busy: boolean; onCheck: () => void }) {
  return (
    <Button variant="link" disabled={busy} onClick={onCheck}>
      <RotateCcw aria-hidden className="size-4" /> {busy ? "Checking…" : "Check again"}
    </Button>
  );
}

function checkedAt(value: string | null): string {
  return value === null ? "an unknown time" : utc(value);
}

function GitHubRoute({ readiness, signedIn, onCheck }: Omit<IntakePanelProps, "form">) {
  if (readiness.status === "checking") return <p aria-live="polite">Loading private reporting status…</p>;
  if (readiness.status === "error") return <Alert variant="destructive" action={<CheckAgain busy={false} onCheck={onCheck} />}>{readiness.message}</Alert>;
  const { value, stale, rechecking } = readiness;
  if (value.state === "ready" && value.handoffUrl !== null) {
    if (stale)
      return (
        <Alert variant="destructive" action={<CheckAgain busy={rechecking} onCheck={onCheck} />}>
          Private reporting status from {checkedAt(value.checkedAt)} is out of date.{signedIn ? " Your draft is kept." : ""}
        </Alert>
      );
    return (
      <div aria-live="polite" className="flex flex-col items-start gap-3">
        <p className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-medium text-ok">
            <StatusIcon icon="Check" />
            GitHub private reporting is on
          </span>
          <span>
            (checked {checkedAt(value.checkedAt)}).{value.paidParticipation === "open" ? "" : " No new paid reports now."}
          </span>
        </p>
        <ExternalLink href={value.handoffUrl}>{value.automatic === "ready" ? "Or report directly on GitHub" : "Report privately on GitHub"}</ExternalLink>
      </div>
    );
  }
  return (
    <Alert variant="destructive" action={<CheckAgain busy={rechecking} onCheck={onCheck} />}>
      {blocked[value.state] ?? blocked.unavailable} {stale && value.checkedAt !== null ? `Status from ${utc(value.checkedAt)} is out of date. ` : ""}Check again later.
    </Alert>
  );
}

/** Where a private report goes: Slop's intake first, and GitHub's private route beside it. Never a public issue. */
export function IntakePanel({ readiness, signedIn, form, onCheck }: IntakePanelProps) {
  const stored = readiness.status === "checked" && readiness.value.storedIntake;
  return (
    <section id="security-report" aria-labelledby="security-report-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
      <h2 id="security-report-heading" className="text-xl font-semibold">
        Private report
      </h2>
      <p className="flex items-center gap-2 font-medium text-warn">
        <LockKeyhole aria-hidden className="size-4" />
        Never post exploit details publicly.
      </p>
      {stored ? (
        form
      ) : readiness.status === "checking" ? (
        <p role="status">Checking private intake…</p>
      ) : (
        <p role="status">Slop private intake is unavailable. The private GitHub route below remains separate; never post a public report.</p>
      )}
      <Disclosure key={stored ? "optional" : "options"} summary={stored ? "Optional private GitHub delivery" : "Private reporting options"} defaultOpen={!stored}>
        <div className="flex flex-col gap-3 pt-2 text-foreground">
          <GitHubRoute readiness={readiness} signedIn={signedIn} onCheck={onCheck} />
          <p>
            Already reported on GitHub?{" "}
            <a href="/security#security-link" className="text-primary underline underline-offset-4 hover:decoration-2">
              Verify the private report
            </a>
            .
          </p>
        </div>
      </Disclosure>
    </section>
  );
}
