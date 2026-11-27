// spec/app/index.md, "The shell shows one route, opened from the address"; spec/frontend/navigation.md, "Every existing product route is one Page and only private destinations need an account"; spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"; spec/frontend/navigation.md, "A private read belongs to the current account and navigation lifetime"; spec/frontend/composition.md, "Sign-in keeps only a safe same-origin return destination"; spec/backend/accounts.md, "Sign-out ends only the caller's session and revocation never reaches another account"; spec/frontend/routes.md, "A fragment destination opens its section and stays aligned until it settles or the reader takes over"; spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"
import { Cause, Exit } from "effect";
import { type ReactNode, useRef, useState } from "react";
import type { Route } from "../../gen/app.ts";
import { privatePage, signInShownInPlace } from "../../gen/frontend__navigation.ts";
import { useMachine } from "../../gen/frontend__navigation.react.ts";
import { pageOf } from "../../gen/frontend__routes.ts";
import { alignFragments } from "../platform/fragment.vibe";
import { loadRegistry, type RegistryBoot, type RegistryProject } from "../reads/registry.vibe";
import { settingsShownSignedOut } from "../screens/account/index.ts";
import { InboxEmailLink } from "../screens/inbox/index.ts";
import { projectRuntime } from "../screens/projects/reads.vibe";
import { AccountControl, type OwnedProjectLink } from "./AccountControl.tsx";
import { extraRouteOf, ExtraRoutePage } from "./extraRoutes.tsx";
import { retryOnce, useOnce } from "./hooks.ts";
import { type Frame, type PageKind, signInPurposes } from "./pages.ts";
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
  useOnce(runtime, "fragment", () => alignFragments());
  if (cause) throw Cause.squash(cause);
  const kind = route.kind === "Unknown" ? undefined : route.kind;
  if (kind === undefined) {
    const base = typeof location === "undefined" ? "https://slop.cash" : location.origin;
    const extra = extraRouteOf(URL.parse(address, base)?.pathname ?? "/");
    if (extra !== undefined) return <ExtraRoutePage route={extra} runtime={runtime} />;
  }
  if (kind && !privatePage(pageOf(kind))) {
    const Page = pages[kind];
    return <Gated kind={kind} runtime={runtime} frame={frame}><Page runtime={runtime} route={route} /></Gated>;
  }
  if (state === undefined || shown === undefined) return frame();
  if (signInShownInPlace(state) && !(kind === "Account" && settingsShownSignedOut(address))) {
    const view = shown.view.status === "signedIn" ? { status: "checking" as const } : shown.view;
    const signIn = frame(
      <>
        {kind === "Inbox" ? <InboxEmailLink runtime={runtime} /> : null}
        <SignInPanel view={view} href={loginHrefFor(shown, address)} purpose={kind && signInPurposes[kind]} />
      </>,
    );
    return kind ? <Gated kind={kind} runtime={runtime} frame={frame}>{signIn}</Gated> : signIn;
  }
  if (!kind) return frame();
  const Page = pages[kind];
  return <Gated kind={kind} runtime={runtime} frame={frame}><Page runtime={runtime} route={route} /></Gated>;
}

function Gated({ kind, runtime, frame, children }: { kind: PageKind; runtime: PageRuntime; frame: Frame; children: ReactNode }) {
  const section = projectRuntime(runtime);
  const boot = useOnce(section, "registry", () => loadRegistry());
  return (
    <RegistryGate kind={kind} freshness={boot.status === "done" ? boot.value.freshness : { tag: "RegistryCurrent" }} frame={frame} runtime={runtime} onRetry={() => retryOnce(section, "registry")}>
      {children}
    </RegistryGate>
  );
}

export function RegistryBootOf({ runtime, children }: { runtime: PageRuntime; children: (boot: RegistryBoot) => ReactNode }) {
  const boot = useOnce(projectRuntime(runtime), "registry", () => loadRegistry());
  return boot.status === "done" ? children(boot.value) : null;
}

type SignOut = "idle" | "signingOut" | "failed";

function ownedProjectsOf(projects: ReadonlyArray<RegistryProject>, githubId: string): ReadonlyArray<OwnedProjectLink> {
  const owned: OwnedProjectLink[] = [];
  for (const project of projects) {
    const id = typeof project.id === "string" ? project.id : undefined;
    const slug = typeof project.slug === "string" ? project.slug : id;
    const name = typeof project.name === "string" ? project.name : undefined;
    const steward = typeof project.steward === "object" && project.steward !== null ? project.steward : undefined;
    const github = steward !== undefined && "github" in steward && typeof steward.github === "object" && steward.github !== null ? steward.github : undefined;
    const actorId = github !== undefined && "actorId" in github && typeof github.actorId === "string" ? github.actorId : undefined;
    const nodeId = github !== undefined && "nodeId" in github && typeof github.nodeId === "string" ? github.nodeId : undefined;
    if (id !== undefined && slug !== undefined && name !== undefined && (actorId === githubId || nodeId === githubId)) {
      owned.push({ id, slug, name });
    }
  }
  return owned.sort((left, right) => left.name.localeCompare(right.name));
}

export function PageAccount({ runtime }: { runtime: PageRuntime }) {
  const shown = useSession(runtime);
  const address = useAddress();
  const boot = useOnce(projectRuntime(runtime), "registry", () => loadRegistry());
  const [signing, setSigning] = useState<SignOut>("idle");
  const signingRef = useRef(false);
  const signOutNow = () => {
    if (signingRef.current) return;
    signingRef.current = true;
    setSigning("signingOut");
    void runtime.runPromiseExit(signOut()).then((exit) => {
      signingRef.current = false;
      setSigning(Exit.isSuccess(exit) ? "idle" : "failed");
    });
  };
  const base = typeof location === "undefined" ? "https://slop.cash" : location.origin;
  const pathname = URL.parse(address, base)?.pathname ?? "/";
  const ownedProjects =
    shown?.view.status === "signedIn" && boot.status === "done"
      ? ownedProjectsOf(boot.value.projects, shown.view.session.githubId)
      : [];
  return (
    <AccountControl
      view={shown?.view ?? { status: "checking" }}
      loginHref={shown ? loginHrefFor(shown, address) : ""}
      onLoginPage={pathname === "/login"}
      signingOut={signing === "signingOut"}
      signOutFailed={signing === "failed"}
      onSignOut={signOutNow}
      ownedProjects={ownedProjects}
    />
  );
}
