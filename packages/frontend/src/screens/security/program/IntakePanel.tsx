// spec/security/reportingReadiness.md, "Only a fresh, enabled, verified observation is ready"; spec/security/intake.md, "A new attempt binds authenticated identity, passes admission and keeps its idempotency key"
import { Button, ExternalLink, Spinner, Status } from "@repo/ui";
import { ArrowRight, ExternalLink as ExternalLinkIcon, RotateCcw } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { ReadinessShown } from "./runtime.vibe";
import { utc } from "./summary.ts";

export type IntakePanelProps = {
  readiness: ReadinessShown;
  /** The report form, shown while Slop's private intake is on. */
  form: ReactNode;
  onCheck: () => void;
};

const blocked: Readonly<Record<string, string>> = {
  disabled: "GitHub private reporting off",
  forbidden: "GitHub access denied",
  unavailable: "Status unavailable",
};

function CheckAgain({ busy, onCheck }: { busy: boolean; onCheck: () => void }) {
  const label = busy ? "Checking…" : "Check again";
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} disabled={busy} onClick={onCheck}>
      <RotateCcw aria-hidden className="size-4" />
    </Button>
  );
}

function GitHubRoute({ readiness, onCheck }: Omit<IntakePanelProps, "form">) {
  if (readiness.status === "checking") return <Spinner size="sm" label="Loading private reporting status…" />;
  if (readiness.status === "error")
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-destructive">
        <Status presentation={{ tone: "Negative", icon: "Alert", label: readiness.message }} />
        <CheckAgain busy={false} onCheck={onCheck} />
      </p>
    );
  const { value, stale, rechecking } = readiness;
  if (value.state === "ready" && value.handoffUrl !== null)
    return (
      <div aria-live="polite" className="flex flex-col items-start gap-3">
        {stale ? (
          <p role="alert" className="flex flex-wrap items-center gap-2">
            <Status presentation={{ tone: "Caution", icon: "Alert", label: `Stale · ${value.checkedAt === null ? "unknown time" : utc(value.checkedAt)}` }} />
            <CheckAgain busy={rechecking} onCheck={onCheck} />
          </p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <Status presentation={{ tone: "Positive", icon: "Check", label: "GitHub on" }} />
              <span>Checked {value.checkedAt === null ? "at an unknown time" : utc(value.checkedAt)}</span>
            </p>
            <ExternalLink
              href={value.handoffUrl}
              className={
                value.automatic === "ready"
                  ? "inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:decoration-2"
                  : "inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              }
            >
              Report on GitHub <ExternalLinkIcon aria-hidden className="size-4" />
            </ExternalLink>
          </>
        )}
      </div>
    );
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2">
      <Status presentation={{ tone: "Negative", icon: "Alert", label: blocked[value.state] ?? blocked.unavailable }} />
      {stale && value.checkedAt !== null ? <Status presentation={{ tone: "Caution", icon: "Clock", label: `Stale · ${utc(value.checkedAt)}` }} /> : null}
      <CheckAgain busy={rechecking} onCheck={onCheck} />
    </p>
  );
}

/** Where a private report goes: Slop's intake first, and GitHub's private route beside it. Never a public issue. */
export function IntakePanel({ readiness, form, onCheck }: IntakePanelProps) {
  const stored = readiness.status === "checked" && readiness.value.storedIntake;
  const [open, setOpen] = useState<boolean | null>(null);
  return (
    <section aria-labelledby="security-report" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-card-foreground">
      <h2 id="security-report" className="text-xl font-semibold">
        Private report
      </h2>
      <p className="flex flex-wrap items-center gap-3">
        <Status presentation={{ tone: "Neutral", icon: "Lock", label: "Private" }} />
        {readiness.status === "checked" && readiness.value.paidParticipation !== "open" ? <Status presentation={{ tone: "Caution", icon: "Alert", label: "No paid reports" }} /> : null}
      </p>
      {stored ? form : readiness.status === "checking" ? <Spinner size="sm" label="Checking private intake…" /> : <p role="status">Slop intake unavailable</p>}
      <details open={open ?? !stored} onToggle={(event) => setOpen(event.currentTarget.open)} className="group flex flex-col gap-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 self-start rounded-sm text-sm font-medium text-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          GitHub option
        </summary>
        <div className="mt-2 flex flex-col gap-3 text-foreground">
          <GitHubRoute readiness={readiness} onCheck={onCheck} />
          <p>
            <a href="/security#security-link" className="inline-flex items-center gap-1 text-primary underline underline-offset-4 hover:decoration-2">
              Verify a GitHub report <ArrowRight aria-hidden className="size-3.5" />
            </a>
          </p>
        </div>
      </details>
    </section>
  );
}
