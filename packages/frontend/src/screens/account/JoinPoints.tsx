// spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"; spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can"; spec/backend/accounts.md, "Active memberships are public and a hide request is refused"
import { Button } from "@repo/ui";
import { Eye, LogIn } from "lucide-react";
import type { SignInState } from "./signIn.vibe";

export type JoinPointsProps = {
  /** Whether the session check is still running, failed, or settled signed out. */
  session: "checking" | "failed" | "signedOut";
  /** The sign-in attempt: waiting for GitHub, its last message, and whether the account was closed. */
  attempt: SignInState;
  /** The product site's login page, when this origin cannot sign in itself. */
  elsewhere?: { readonly href: string; readonly host: string };
  /** Starts the GitHub sign-in; `reopen` reopens a closed account. */
  onStart: (reopen: boolean) => void;
};

/** GitHub sign-in to a public Slop membership, with the disclosure that it is public. */
export function JoinPoints({ session, attempt, elsewhere, onStart }: JoinPointsProps) {
  if (elsewhere) {
    return (
      <Button asChild className="self-start">
        <a href={elsewhere.href} aria-label={`Continue with GitHub on ${elsewhere.host}`}>
          <LogIn aria-hidden className="size-4" />
          Continue with GitHub
        </a>
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-4">
      {session === "failed" ? <p role="status">Could not check your session. Sign in again.</p> : null}
      <p className="flex items-center gap-2">
        <Eye aria-hidden className="size-4" /> Membership and X link are public
      </p>
      <Button loading={attempt.waiting} disabled={session === "checking"} onClick={() => onStart(attempt.closedAccount)}>
        {attempt.waiting ? null : <LogIn aria-hidden className="size-4" />}
        {attempt.waiting ? "Waiting for GitHub…" : attempt.closedAccount ? "Reopen account" : "Continue with GitHub"}
      </Button>
      <p role="status">{attempt.message}</p>
    </div>
  );
}
