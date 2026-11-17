// spec/app/index.md, "The shell shows one route, opened from the address": what the document says of the route it shows.
import type { Route, RouteKind } from "../gen/app.ts";

const homeTitle = "Slop: make money shipping open source";
/** The title of each page that names it without a record, as development's `ROUTES` and `STATIC_PAGE_TITLES` do. */
const titles: Partial<Record<RouteKind, string>> = {
  Home: homeTitle, HowItWorks: "How it works", Sponsors: "Sponsors", CycleArchive: "Cycle archive", Points: "Leaderboard",
  NewProject: "Add a project", Account: "Account", Login: "Log in", Earnings: "Your payouts", Inbox: "Inbox", Admin: "Admin",
  VettingEvidence: "Private vetting evidence", SecurityCases: "Security cases",
};
/** The canonical path of each page that names it without a record. */
const paths: Partial<Record<RouteKind, string>> = {
  Home: "/", HowItWorks: "/how-it-works", Sponsors: "/sponsors", CycleArchive: "/cycles", Points: "/points", NewProject: "/projects/new",
  Account: "/account", Login: "/login", Earnings: "/earnings", Inbox: "/inbox", Admin: "/admin", VettingEvidence: "/vetting-evidence",
  SecurityCases: "/security",
};

/**
 * The document title and canonical path of `route`, as development's `routeHead`; a missing page has no canonical. A
 * project's pages name it by its id until the registry read of the business-logic phase gives its name.
 */
export function routeHead(route: Route): { title: string; path: string | null } {
  const titled = (name: string, path: string | null) => ({ title: name === homeTitle ? name : `${name} · Slop`, path });
  const project = `/projects/${encodeURIComponent(route.projectId)}`;
  switch (route.kind) {
    case "Unknown": return titled("Page not found", null);
    case "Profile": return titled(route.login, `/contributors/${encodeURIComponent(route.login)}`);
    case "Cycle": return titled(`${route.projectId} ${route.cycleId} cycle`, `/cycles/${encodeURIComponent(route.projectId)}/${encodeURIComponent(route.cycleId)}`);
    case "Project": return titled(route.projectId, project);
    case "ManageProject": return titled(`Manage ${route.projectId}`, `${project}/manage`);
    case "SecurityProgram": return titled(`${route.projectId} security bounty`, `${project}/security`);
    default: return titled(titles[route.kind]!, paths[route.kind]!);
  }
}

/** Sets the title, and the canonical link or, for a missing page that the shell still answers with 200, noindex. */
export function applyHead({ title, path }: { title: string; path: string | null }) {
  document.title = title;
  document.head.querySelector('link[rel="canonical"]')?.remove();
  document.head.querySelector('meta[name="robots"]')?.remove();
  const tag = path === null ? Object.assign(document.createElement("meta"), { name: "robots", content: "noindex" })
    : Object.assign(document.createElement("link"), { rel: "canonical", href: `https://slop.cash${path}` });
  document.head.append(tag);
}

/** The domain the wordmark names: slop.tech where the page was served from it, slop.cash everywhere else. */
export const domainOf = (hostname: string) => (["slop.tech", "www.slop.tech"].includes(hostname.toLowerCase().replace(/\.$/u, "")) ? "slop.tech" : "slop.cash");
