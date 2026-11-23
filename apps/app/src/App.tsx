// spec/app/index.md, "Story: Open a page by its address"; spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"; spec/frontend/presentation.md, "The wordmark and footer domain follow the serving host"
import { useNotFoundMounted } from "@repo/frontend/app";
import { CONTACT_EMAIL, CONTACT_MAILTO, SOURCE_REPOSITORY } from "@repo/frontend/platform/site";
import type { RegistryBoot } from "@repo/frontend/reads/registry";
import { Alert, Button, cn, ExternalLink, focusRing, Logo, NotFound, PageHeader, shell, SiteFooter, SiteHeader } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import type { ReactNode } from "react";
import type { Machine } from "../gen/app.effect.vibe";
import { useMachine } from "../gen/app.react.ts";
import type { Route, RouteKind } from "../gen/app.ts";
import { type DocumentHead, documentHead, domainOf } from "./head.ts";

export interface AppProps {
  /** Holds the route, opened from the address before the first render: `routes` of routes.vibe. */
  runtime: ManagedRuntime.ManagedRuntime<Machine, unknown>;
  /** The host that served the page. */
  hostname: string;
  content?: (route: Route, frame: (children?: ReactNode, title?: string) => ReactNode) => ReactNode;
  account?: ReactNode;
  /** Renders what it is given with the registry the pages booted, once it has loaded. */
  registry?: (render: (boot: RegistryBoot) => ReactNode) => ReactNode;
}

const headings: Record<Exclude<RouteKind, "Unknown" | "Home">, (route: Route) => string> = {
  HowItWorks: () => "How Slop works",
  Sponsors: () => "Fund a project",
  CycleArchive: () => "Payment cycles",
  Cycle: (route) => route.cycleId,
  Points: () => "Contributors",
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
  Fee: () => "Submission fee",
  FeeReport: () => "Report deposit",
};

const page = cn(shell, "flex-1 py-8");
const framing = (heading?: string) => (children?: ReactNode, title = heading) => (
  <main className={page}>
    {title === undefined ? null : <PageHeader title={title} />}
    {children}
  </main>
);
const headingOnly: NonNullable<AppProps["content"]> = (_route, frame) => frame();

function Head({ head }: { head: DocumentHead | undefined }) {
  const notFound = useNotFoundMounted();
  if (head === undefined) return null;
  return (
    <>
      <title>{head.title}</title>
      {notFound ? null : head.canonical === undefined ? <meta name="robots" content="noindex" /> : (
        <>
          <link rel="canonical" href={head.canonical} />
          <meta property="og:url" content={head.canonical} />
        </>
      )}
    </>
  );
}

/**
 * The route shell: the document head, the header, the page the address opened and the footer.
 * @model spec/app/index.md
 */
export function App({ runtime, hostname, content, account, registry }: AppProps) {
  const { state, cause } = useMachine(runtime);
  const route = state && state.opened > 0 ? state.route : undefined;

  if (cause) return <Alert variant="destructive" className="m-6">Slop could not load.</Alert>;
  if (!route) return <main aria-busy="true" className="min-h-dvh" />;

  const home = route.kind === "Home";
  const head = documentHead(route, undefined);
  return (
    <div className="flex min-h-dvh flex-col">
      {head === undefined && registry ? registry((boot) => <Head head={documentHead(route, boot)} />) : <Head head={head} />}
      <SiteHeader
        brand={<a href="/" aria-label="Slop home" className={cn(focusRing, "rounded-sm")}><Logo size="header" wordmark label={domainOf(hostname)} /></a>}
        nav={<Button asChild variant="outline" size="sm"><a href="/how-it-works" aria-label="How it works">How It Works</a></Button>}
        account={account ?? <Button asChild variant="inverse" size="sm"><a href="/login">Log in</a></Button>}
      />
      <div id="main" className="flex flex-1 flex-col">
        {route.kind === "Unknown" ? <NotFound className={page} /> : (content ?? headingOnly)(route, framing(route.kind === "Home" ? undefined : headings[route.kind](route)))}
      </div>
      <SiteFooter compact={!home} brand={<Logo variant="inverse" size={home ? "xl" : "lg"} />}>
        <ExternalLink href={SOURCE_REPOSITORY}>GitHub</ExternalLink>
        <ExternalLink href="https://x.com/SlopCash">X</ExternalLink>
        <ExternalLink href="https://www.linkedin.com/company/slop-cash">LinkedIn</ExternalLink>
        <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
      </SiteFooter>
    </div>
  );
}
