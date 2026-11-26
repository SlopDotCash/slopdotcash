// spec/frontend/routes.md, "Each route has one title, canonical and index policy, and private routes never name a private identifier"; spec/frontend/presentation.md, "The wordmark and footer domain follow the serving host"
import { publicDomain } from "@repo/frontend/presentation";
import { SITE_ORIGIN } from "@repo/frontend/platform/site";
import { type RegistryBoot, type RegistryProject, findHistoricalProject, findProject } from "@repo/frontend/reads/registry";
import { recordKind, routeHead, staticTitle } from "@repo/frontend/routes";
import type { Route } from "../gen/app.ts";

export interface DocumentHead {
  readonly title: string;
  readonly canonical: string | undefined;
}

interface RouteRecord {
  readonly name: string;
  readonly segments: Readonly<Record<string, string>>;
}

const homeTitle = staticTitle("Home");

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);

const bountyOnly = ({ securityBounty }: RegistryProject) =>
  typeof securityBounty === "object" && securityBounty !== null && "rewardMode" in securityBounty && securityBounty.rewardMode === "bounty-only";

function projectRecord(route: Route, project: RegistryProject | undefined): RouteRecord | undefined {
  const id = text(project?.id);
  const name = text(project?.name);
  if (project === undefined || id === undefined || name === undefined) return undefined;
  const slug = text(project.slug) ?? id;
  switch (route.kind) {
    case "Cycle": return { name: `${name} ${route.cycleId} cycle`, segments: { project: id, cycle: route.cycleId } };
    case "ManageProject": return { name: `Manage ${name}`, segments: { project: slug } };
    case "SecurityProgram": return { name: `${name} security bounty`, segments: { project: slug } };
    default: return { name: bountyOnly(project) ? `${name} security bounty` : name, segments: { project: slug } };
  }
}

function projectOf(route: Route, boot: RegistryBoot): RegistryProject | undefined {
  const listed = findProject(boot, route.projectId);
  return route.kind === "Cycle" ? listed ?? findHistoricalProject(boot, route.projectId) : listed;
}

const filled = (pattern: string, segments: Readonly<Record<string, string>>) =>
  pattern.replace(/:(\w+)/gu, (_, key: string) => encodeURIComponent(segments[key] ?? ""));

/** The head of `route`, or undefined while a project route waits for the registry that names its project. */
export function documentHead(route: Route, boot: RegistryBoot | undefined): DocumentHead | undefined {
  const record = route.kind === "Profile" ? { name: route.login, segments: { login: route.login } }
    : !recordKind(route.kind) ? undefined : boot === undefined ? null : projectRecord(route, projectOf(route, boot));
  if (record === null) return undefined;
  const head = routeHead(route, record !== undefined, record?.name ?? "");
  return {
    title: head.titleName === homeTitle ? homeTitle : `${head.titleName} · Slop`,
    canonical: head.indexed ? `${SITE_ORIGIN}${filled(head.canonical, record?.segments ?? {})}` : undefined,
  };
}

/** The domain the wordmark names: slop.tech where the page was served from it, slop.cash everywhere else. */
export const domainOf = (hostname: string) => (publicDomain(hostname.toLowerCase().replace(/\.$/u, "")) === "SlopTech" ? "slop.tech" : "slop.cash");
