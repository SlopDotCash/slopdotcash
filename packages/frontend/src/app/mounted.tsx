// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"
import { Cause, Exit } from "effect";
import { useState } from "react";
import type { Route } from "../../gen/app.ts";
import { signInShownInPlace } from "../../gen/frontend__navigation.ts";
import { useMachine } from "../../gen/frontend__navigation.react.ts";
import { loadRegistry } from "../reads/registry.vibe";
import { settingsShownSignedOut } from "../screens/account/index.ts";
import { InboxEmailLink } from "../screens/inbox/index.ts";
import { projectRuntime } from "../screens/projects/reads.vibe";
import { useOnce } from "../screens/security/program/hooks.ts";
import { AccountControl } from "./AccountControl.tsx";
import { type Frame, type PageKind, type RegisteredPage, signInPurposes } from "./pages.ts";
import { pages } from "./registered.tsx";
import { RegistryGate } from "./RegistryGate.tsx";
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
  if (signInShownInPlace(state) && !(kind === "Account" && settingsShownSignedOut(address))) {
    const view = shown.view.status === "signedIn" ? { status: "checking" as const } : shown.view;
    return frame(
      <>
        {kind === "Inbox" ? <InboxEmailLink runtime={runtime} /> : null}
        <SignInPanel view={view} href={loginHrefFor(shown, address)} purpose={kind && signInPurposes[kind]} />
      </>,
    );
  }
  return kind ? <Gated kind={kind} Page={pages[kind]} runtime={runtime} route={route} frame={frame} /> : frame();
}

function Gated({ kind, Page, runtime, route, frame }: { kind: PageKind; Page: RegisteredPage; runtime: PageRuntime; route: Route; frame: Frame }) {
  const boot = useOnce(projectRuntime(runtime), "registry", () => loadRegistry());
  const page = <Page runtime={runtime} route={route} />;
  if (boot.status !== "done") return page;
  return (
    <RegistryGate kind={kind} freshness={boot.value.freshness} frame={frame} onRetry={() => location.reload()}>
      {page}
    </RegistryGate>
  );
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
