// spec/app/index.md, "Story: Open a page by its address"
import { Alert, Button, cn, ExternalLink, focusRing, Logo, NavTab, NavTabs, NotFound, PageHeader, SiteFooter, SiteHeader } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { type ReactNode, useEffect } from "react";
import type { Machine } from "../gen/app.effect.vibe";
import { useMachine } from "../gen/app.react.ts";
import type { Route, RouteKind } from "../gen/app.ts";
import { openingOf } from "./address.ts";
import { applyHead, domainOf, routeHead } from "./head.ts";
import { opened } from "./routes.vibe";

export interface AppProps {
  /** Provides the route: `routes` of routes.vibe. */
  runtime: ManagedRuntime.ManagedRuntime<Machine, unknown>;
  /** The path, the query and the hash of the address the page was loaded at, and the host that served it. */
  path: string;
  search: string;
  hash: string;
  hostname: string;
  content?: (route: Route, frame: (children?: ReactNode, title?: string) => ReactNode) => ReactNode;
  account?: ReactNode;
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
const framing = (heading: string) => (children?: ReactNode, title = heading) => <main className={page}><PageHeader title={title} />{children}</main>;
const headingOnly: NonNullable<AppProps["content"]> = (_route, frame) => frame();

/**
 * The route shell: the header, the page the address opened and the footer. Until the address has been opened, in the
 * effects of the first render, it shows an empty busy page rather than the home page it starts on.
 * @model spec/app/index.md
 */
export function App({ runtime, path, search, hash, hostname, content, account }: AppProps) {
  const { state, cause } = useMachine(runtime);
  const route = state && state.opened > 0 ? state.route : undefined;

  useEffect(() => {
    void runtime.runPromiseExit(opened(openingOf(path, search, hash)));
  }, [runtime, path, search, hash]);
  useEffect(() => {
    if (route) applyHead(routeHead(route));
  }, [route]);

  if (cause) return <Alert variant="destructive" className="m-6">Slop could not load.</Alert>;
  if (!route) return <main aria-busy="true" className="min-h-dvh" />;

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader
        brand={<a href="/" aria-label="Slop home" className={cn(focusRing, "rounded-sm")}><Logo wordmark label={domainOf(hostname)} /></a>}
        nav={<NavTabs label="Main"><NavTab href="/how-it-works" current={route.kind === "HowItWorks"}>How It Works</NavTab></NavTabs>}
        account={account ?? <Button asChild variant="outline" size="sm"><a href="/login">Log in</a></Button>}
      />
      {route.kind === "Unknown" ? <NotFound className={page} /> : (content ?? headingOnly)(route, framing(headings[route.kind](route)))}
      <SiteFooter compact={route.kind !== "Home"} brand={<Logo variant="inverse" size={route.kind === "Home" ? "xl" : "lg"} />}>
        <ExternalLink href="https://github.com/SlopDotCash/slopdotcash">GitHub</ExternalLink>
        <ExternalLink href="https://x.com/SlopCash">X</ExternalLink>
        <ExternalLink href="https://www.linkedin.com/company/slop-cash">LinkedIn</ExternalLink>
        <a href="mailto:hello@slop.cash">hello@slop.cash</a>
      </SiteFooter>
    </div>
  );
}
