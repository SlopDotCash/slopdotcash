// spec/backend/accounts.md, "A web sign-in consumes one web assertion and opens a public membership"; spec/backend/accounts.md, "An ordinary sign-in cannot reopen a closed account; explicit reopening can"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"
import { PageHeader } from "@repo/ui";
import { LogIn } from "lucide-react";
import type { PageProps } from "../../app/pages.ts";
import type { SessionShown } from "../../app/runtime.vibe";
import { loginHrefFor, useSession } from "../../app/useSession.ts";
import { parseNext } from "../../session/loginReturn.ts";
import { openSignInWindow } from "./browserWindow.ts";
import { JoinPoints, type JoinPointsProps } from "./JoinPoints.tsx";
import { loginRuntime, startSignIn, watchSignIn } from "./signIn.vibe";
import { useView } from "./useView.ts";

export type LoginViewProps = Omit<JoinPointsProps, "session"> & {
  /** The settled session: signed in shows the redirect in place of the sign-in. */
  session: JoinPointsProps["session"] | "signedIn";
};

/** The login page: GitHub sign-in, then the redirect to where the visitor was going. */
export function LoginView({ session, ...join }: LoginViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-(--breakpoint-md) flex-1 flex-col gap-8 px-4 py-12">
      <PageHeader title={session === "signedIn" ? "Signed in" : "Log in"} icon={<LogIn className="size-6" />} />
      {session === "signedIn" ? <p role="status">Redirecting…</p> : <JoinPoints session={session} {...join} />}
    </main>
  );
}

function elsewhereOf(shown: SessionShown): JoinPointsProps["elsewhere"] {
  const { origins, pageOrigin } = shown.deployment;
  if (origins.browserOrigins.has(pageOrigin)) return undefined;
  const next = parseNext(location.search, pageOrigin);
  return { href: loginHrefFor(shown, next.tag === "SameOriginPath" ? next.path : "/"), host: new URL(origins.site).hostname };
}

const idle = { waiting: false, message: "", closedAccount: false };

export function LoginPage({ runtime }: PageProps) {
  const shown = useSession(runtime);
  const login = loginRuntime(runtime);
  const attempt = useView(login, watchSignIn) ?? idle;
  if (shown === undefined) return null;
  const local = shown.deployment.localBackendOrigin !== undefined;
  return (
    <LoginView
      session={shown.view.status}
      attempt={attempt}
      elsewhere={elsewhereOf(shown)}
      onStart={(reopen) => void login.runPromiseExit(startSignIn(reopen, openSignInWindow(local)))}
    />
  );
}
