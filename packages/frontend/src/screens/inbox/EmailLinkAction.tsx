// spec/frontend/emailAction.md, "An email verify or unsubscribe token survives sign-in and is applied once to the signed-in account"; spec/backend/email.md, "Verification is account-bound, single-use, unexpired and applies the consent requested with it"
import { Alert, Button } from "@repo/ui";
import { Cause } from "effect";
import { useState } from "react";
import type { EmailAction } from "../../../gen/frontend__emailAction.ts";
import { useMachine } from "../../../gen/frontend__emailAction.react.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { type Settled, run, useMounted } from "../security/program/hooks.ts";
import { type InboxRuntime, checkEmailLink, confirmEmailLink, dismissEmailLink, inboxRuntime } from "./runtime.vibe";

export type EmailLinkStep = "invalid" | "checking" | "recheck" | "signIn" | "ready" | "done";

export type EmailLinkActionProps = {
  link: "verify" | "unsubscribe";
  step: EmailLinkStep;
  /** Why the last check or request did not finish. */
  error?: string;
  /** While the request is in flight. */
  busy?: boolean;
  signInHref: string;
  onConfirm: () => void;
  onDismiss: () => void;
  onRetryCheck: () => void;
};

/** A verify or unsubscribe link opened from an email: nothing is sent until the person confirms it. */
export function EmailLinkAction({ link, step, error, busy = false, signInHref, onConfirm, onDismiss, onRetryCheck }: EmailLinkActionProps) {
  const verb = link === "verify" ? "Verify email" : "Unsubscribe";
  return (
    <section aria-labelledby="email-link-action" className="flex flex-col items-start gap-3 rounded-md border border-border bg-card p-4 text-card-foreground">
      <h2 id="email-link-action" className="text-lg font-semibold text-foreground">
        {verb}
      </h2>
      {step === "invalid" ? (
        <Alert variant="destructive">This email link is invalid.</Alert>
      ) : step === "done" ? (
        <>
          <Alert variant="ok">{link === "verify" ? "Email verified." : "Email notifications stopped."}</Alert>
          <a href="/account#notifications" className="text-primary underline underline-offset-4">
            Email preferences
          </a>
        </>
      ) : step === "checking" ? (
        <p role="status">Checking your account…</p>
      ) : step === "recheck" ? (
        <Button variant="outline" onClick={onRetryCheck}>
          Retry account check
        </Button>
      ) : step === "signIn" ? (
        <Button asChild variant="outline">
          <a href={signInHref}>Sign in to verify email</a>
        </Button>
      ) : (
        <Button variant="outline" loading={busy} onClick={onConfirm}>
          {busy ? "Saving…" : verb}
        </Button>
      )}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <Button variant="link" disabled={busy} onClick={onDismiss}>
        Dismiss
      </Button>
    </section>
  );
}

type BodyProps = { section: InboxRuntime; state: EmailAction; signInHref: string; onRetryCheck: () => void };

function stepOf(state: EmailAction, check: Settled<string | undefined>): { step: EmailLinkStep; problem?: string } {
  if (!state.tokenValid) return { step: "invalid" };
  if (state.done) return { step: "done" };
  if (state.kind !== "VerifyEmail") return { step: "ready" };
  if (check.status === "running") return { step: "checking" };
  if (check.status === "failed") return { step: "recheck", problem: check.message };
  if (check.value !== undefined) return { step: "recheck", problem: check.value };
  return { step: state.signedIn === 0 ? "signIn" : "ready" };
}

function LinkBody({ section, state, signInHref, onRetryCheck }: BodyProps) {
  const check = useMounted(section, checkEmailLink);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { step, problem } = stepOf(state, check);
  const confirm = () => {
    setBusy(true);
    setError(undefined);
    void run(section, confirmEmailLink()).then((done) => {
      setBusy(false);
      setError(done.ok ? done.value : done.message);
    });
  };
  return (
    <EmailLinkAction
      link={state.kind === "VerifyEmail" ? "verify" : "unsubscribe"}
      step={step}
      error={error ?? problem}
      busy={busy}
      signInHref={signInHref}
      onConfirm={confirm}
      onDismiss={() => void run(section, dismissEmailLink())}
      onRetryCheck={onRetryCheck}
    />
  );
}

/** The pending email link of this tab, kept across sign-in and applied once; shown signed in or out. */
export function InboxEmailLink({ runtime }: { runtime: PageRuntime }) {
  const section = inboxRuntime(runtime);
  const { state, cause } = useMachine(section);
  const shown = useSession(runtime);
  const [checks, setChecks] = useState(0);
  if (cause) throw Cause.squash(cause);
  if (state === undefined || state.kind === "NoEmailAction" || shown === undefined) return null;
  return (
    <LinkBody
      key={`${state.generation}:${checks}`}
      section={section}
      state={state}
      signInHref={loginHrefFor(shown, "/inbox")}
      onRetryCheck={() => setChecks((value) => value + 1)}
    />
  );
}
