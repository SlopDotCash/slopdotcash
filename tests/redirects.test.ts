/**
 * Verifies the checked-in Cloudflare Pages redirect contract against every
 * client-side route the SPA recognizes, using Pages placeholder/splat matching
 * semantics, so a route added to the app without a rewrite fails local CI
 * instead of returning a live 404 on direct navigation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECTS } from "../src/lib/projects.mjs";

interface RedirectRule {
  source: string;
  destination: string;
  status: number;
}

function parseRedirects(contents: string): RedirectRule[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const fields = line.split(/\s+/u);
      if (fields.length !== 3) {
        throw new Error(`unsupported redirect rule shape: ${line}`);
      }
      const status = Number.parseInt(fields[2], 10);
      if (!Number.isInteger(status)) {
        throw new Error(`unsupported redirect status: ${line}`);
      }
      return { source: fields[0], destination: fields[1], status };
    });
}

function matches(source: string, pathname: string): boolean {
  if (source.endsWith("/*")) {
    const prefix = source.slice(0, -1);
    return pathname.startsWith(prefix) && pathname.length > prefix.length;
  }
  const sourceSegments = source.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (sourceSegments.length !== pathSegments.length) return false;
  return sourceSegments.every(
    (segment, index) =>
      segment.startsWith(":") || segment === pathSegments[index],
  );
}

function resolve(rules: RedirectRule[], pathname: string): RedirectRule | null {
  return rules.find((rule) => matches(rule.source, pathname)) ?? null;
}

const rules = parseRedirects(
  readFileSync(join(__dirname, "..", "public", "_redirects"), "utf8"),
);

describe("Cloudflare Pages redirect contract", () => {
  const fundingRuleSources = [
    "/projects/:project/funding/",
    "/projects/:project/funding",
  ];
  const spaDeepLinks = [
    "/projects/new",
    ...PROJECTS.map((project) => `/projects/${project.id}`),
    ...PROJECTS.map((project) => `/projects/${project.id}/manage`),
    ...PROJECTS.map((project) => `/projects/${project.id}/funding`),
    ...PROJECTS.map((project) => `/projects/${project.id}/funding/`),
    "/contributors/octocat",
    "/cycles/eliza/2026-07",
    "/deck",
    "/deck/2",
  ];

  it.each(spaDeepLinks)("rewrites %s to the app shell", (pathname) => {
    const rule = resolve(rules, pathname);
    expect(rule, `${pathname} has no Pages rewrite`).not.toBeNull();
    expect(rule).toMatchObject({ destination: "/", status: 200 });
  });

  it("redirects the legacy skill path permanently", () => {
    expect(resolve(rules, "/skill.md")).toEqual({
      source: "/skill.md",
      destination: "/projects/eliza/skill.md",
      status: 301,
    });
  });

  it("declares both funding URL forms before broader project rules", () => {
    expect(
      rules
        .filter((rule) => fundingRuleSources.includes(rule.source))
        .map((rule) => rule.source),
    ).toEqual(fundingRuleSources);

    const orderedProjectSources = [
      "/projects/new",
      ...fundingRuleSources,
      "/projects/:project/manage",
      "/projects/:project",
    ];
    const indices = orderedProjectSources.map((source) =>
      rules.findIndex((rule) => rule.source === source),
    );
    expect(indices.every((index) => index >= 0)).toBe(true);
    expect(indices).toEqual([...indices].sort((left, right) => left - right));
  });

  it("never rewrites generated artifact paths to the app shell", () => {
    for (const pathname of [
      "/SKILL.md",
      "/llms.txt",
      "/robots.txt",
      "/site.webmanifest",
      "/slop-mark.svg",
      "/og-open-source.png",
      "/og-shipping-slop.png",
      "/brand/elizaos-mark.svg",
      "/downloads/eliza.skill",
      "/protocol/identity-v1.json",
      "/.well-known/slop/projects.json",
      "/data/leaderboard.json",
      "/data/funding.json",
      "/data/cycles/index.json",
      "/projects/eliza/skill.md",
      "/projects/eliza/skill.sha256",
    ]) {
      expect(
        resolve(rules, pathname),
        `${pathname} must be served as a static artifact`,
      ).toBeNull();
    }
  });
});
