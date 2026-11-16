// spec/app/index.md, "Story: Open a page by its address"
import { Alert, Button, ExternalLink, Logo, NavTab, NavTabs, NotFound, PageHeader, SiteFooter, SiteHeader } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { useEffect } from "react";
import type { Machine } from "../gen/app.effect.vibe";
import { useMachine } from "../gen/app.react.ts";
import type { Route, RouteKind } from "../gen/app.ts";
import { openingOf } from "./address.ts";
import { opened } from "./routes.vibe";

export interface AppProps {
  /** Provides the route: `routes` of routes.vibe. */
  runtime: ManagedRuntime.ManagedRuntime<Machine, unknown>;
  /** The path and the query of the address the page was loaded at. */
  path: string;
  search: string;
}

/** Each page's heading, as development's pages name it; a page that shows one thing is named by it. */
const headings: Record<Exclude<RouteKind, "Unknown">, (route: Route) => string> = {
  Home: () => "Make money shipping open source.",
  HowItWorks: () => "How Slop works",
  Sponsors: () => "Fund a project",
  CycleArchive: () => "Payment cycles",
  Cycle: (route) => route.cycleId,
  Points: () => "Leaderboard",
  Account: () => "Settings",
  Login: () => "Log in",
  Earnings: () => "Payouts",
  Inbox: () => "Inbox",
  Admin: () => "Admin",
  NewProject: () => "Add a project",
  VettingEvidence: () => "Private vetting evidence",
  SecurityCases: () => "Security cases",
  Project: (route) => route.projectId,
  ManageProject: () => "Manage project",
  SecurityProgram: (route) => `${route.projectId} security bounty`,
  Profile: (route) => route.login,
};

const page = "mx-auto w-full max-w-(--breakpoint-lg) flex-1 px-4 py-8";

/**
 * The route shell: the header, the page the address opened and the footer. Nothing is shown until the address has
 * been opened, so a page never flashes the home page first.
 * @model spec/app/index.md
 */
export function App({ runtime, path, search }: AppProps) {
  const { state, cause } = useMachine(runtime);

  useEffect(() => {
    void runtime.runPromiseExit(opened(openingOf(path, search)));
  }, [runtime, path, search]);

  if (cause) return <Alert variant="destructive" className="m-6">Slop could not load.</Alert>;
  if (!state || state.opened === 0) return null;
  const { route } = state;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        brand={<a href="/" aria-label="Slop home" className="rounded-sm"><Logo wordmark /></a>}
        nav={<NavTabs label="Main"><NavTab href="/how-it-works" current={route.kind === "HowItWorks"}>How It Works</NavTab></NavTabs>}
        account={<Button asChild variant="outline" size="sm"><a href="/login">Log in</a></Button>}
      />
      {route.kind === "Unknown" ? <NotFound className={page} /> : <main className={page}><PageHeader title={headings[route.kind](route)} /></main>}
      <SiteFooter compact={route.kind !== "Home"} brand={<Logo variant="inverse" />}>
        <ExternalLink href="https://github.com/SlopDotCash/slopdotcash">GitHub</ExternalLink>
        <ExternalLink href="https://x.com/SlopCash">X</ExternalLink>
        <ExternalLink href="https://www.linkedin.com/company/slop-cash">LinkedIn</ExternalLink>
        <a href="mailto:hello@slop.cash">hello@slop.cash</a>
      </SiteFooter>
    </div>
  );
}
