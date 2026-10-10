/** Public route metadata shared by the SPA head tags and the build sitemap. */
import { PROJECTS } from "./projects.mjs";

export const SITE_ORIGIN = "https://slop.cash";
export const HOME_TITLE = "Slop — make money shipping open source";

/** Indexable pages with fixed paths, in sitemap order. */
export const STATIC_PAGE_TITLES = new Map([
  ["/", HOME_TITLE],
  ["/how-it-works", "How it works"],
  ["/models", "Models"],
  ["/sponsors", "Sponsors"],
  ["/receipts", "Run receipts"],
  ["/cycles", "Cycle archive"],
  ["/points", "Slop Points"],
  ["/projects/new", "Add a project"],
]);

export function pageTitle(name: string): string {
  return name === HOME_TITLE ? name : `${name} — Slop`;
}

/** Every indexable path: fixed pages, each manifest project, each published cycle. */
export function sitemapPaths(
  cycles: readonly { projectId: string; cycleId: string }[],
): string[] {
  return [
    ...STATIC_PAGE_TITLES.keys(),
    ...PROJECTS.map((project) => `/projects/${project.slug}`),
    ...cycles.map((cycle) => `/cycles/${cycle.projectId}/${cycle.cycleId}`),
  ];
}
