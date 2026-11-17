// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"
import { Cause, Exit } from "effect";
import { useState } from "react";
import type { Route } from "../../gen/app.ts";
import { signInShownInPlace } from "../../gen/frontend__navigation.ts";
import { useMachine } from "../../gen/frontend__navigation.react.ts";
import { AccountControl } from "./AccountControl.tsx";
import { type Frame, pages, signInPurposes } from "./pages.ts";
import { type PageRuntime, signOut } from "./runtime.vibe";
import { SignInPanel } from "./SignInPanel.tsx";
import { useAddress } from "./useAddress.ts";
import { loginHrefFor, useSession } from "./useSession.ts";

export function RoutePage({ runtime, route, frame }: { runtime: PageRuntime; route: Route; frame: Frame }) {
  const { state, cause } = useMachine(runtime);
  const shown = useSession(runtime);
  const address = useAddress();
  if (cause) throw Cause.squash(cause);
  if (state === undefined || shown === undefined) return frame();
  const kind = route.kind === "Unknown" ? undefined : route.kind;
  if (signInShownInPlace(state)) {
    const view = shown.view.status === "signedIn" ? { status: "checking" as const } : shown.view;
    return frame(<SignInPanel view={view} href={loginHrefFor(shown, address)} purpose={kind && signInPurposes[kind]} />);
  }
  const Page = kind && pages[kind];
  return Page ? <Page runtime={runtime} route={route} /> : frame();
}

type SignOut = "idle" | "signingOut" | "failed";

export function PageAccount({ runtime }: { runtime: PageRuntime }) {
  const shown = useSession(runtime);
  const address = useAddress();
  const [signing, setSigning] = useState<SignOut>("idle");
  const signOutNow = () => {
    setSigning("signingOut");
    void runtime.runPromiseExit(signOut()).then((exit) => setSigning(Exit.isSuccess(exit) ? "idle" : "failed"));
  };
  return (
    <AccountControl
      view={shown?.view ?? { status: "checking" }}
      loginHref={shown ? loginHrefFor(shown, address) : ""}
      onLoginPage={new URL(address, location.origin).pathname === "/login"}
      signingOut={signing === "signingOut"}
      signOutFailed={signing === "failed"}
      onSignOut={signOutNow}
    />
  );
}
