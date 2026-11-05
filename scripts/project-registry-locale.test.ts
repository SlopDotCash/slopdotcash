/**
 * The project registry order decides the home Featured/Community browse
 * order. Every pool key can tie (the current registry has six community
 * projects tied on committed, cap, and root), so the final tie-break is the
 * project id order. A host locale whose collation reorders ids (Danish
 * treats "aa" as "å", sorting it after "z") must not change the published
 * order: the id tie-break is pinned to English collation like the review
 * and standings orders in leaderboard.ts. The same pin applies to the
 * registry generator, which sorts the snapshot it writes.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { buildRegistry } from "../src/lib/projects.mjs";
import { RAW_PROJECT_DEFINITIONS as FIXTURE } from "../tests/fixtures/project-registry.mjs";
import { renderProjectRegistry } from "./sync-project-registry.mjs";

const base = FIXTURE.find((p) => p.id === "thenetwork");

function cloneProject(id: string) {
  const p = JSON.parse(JSON.stringify(base));
  p.id = id;
  p.slug = id;
  p.name = `Project ${id}`;
  p.skill.id = `contribute-to-${id}`;
  p.skill.sourcePath = `skills/contribute-to-${id}`;
  p.skill.publicPath = `/projects/${id}/skill.md`;
  p.reviewSkill.id = `review-${id}-contributions`;
  p.reviewSkill.sourcePath = `skills/review-${id}-contributions`;
  p.repositories = [
    {
      ...p.repositories[0],
      id: `owner-${id}/${id}`,
      displayName: `owner-${id}/${id}`,
      githubUrl: `https://github.com/owner-${id}/${id}`,
    },
  ];
  delete p.repositories[0].aliases;
  if (p.funding?.recordsPath) p.funding.recordsPath = `funding/${id}`;
  return p;
}

// Both projects tie on every earlier sort key: pledged pool, zero committed,
// zero monthly cap, neither publishes at the root. Only the id order decides.
const defs = [cloneProject("abacus"), cloneProject("aardvark")];

function registryOrder(): string[] {
  return buildRegistry(defs).listed.map((p) => p.id);
}

/**
 * Runs a check with the host default collation simulated as Danish: only
 * localeCompare calls without an explicit locale resolve to it.
 */
function withDanishHostDefault<T>(run: () => T): T {
  const original = String.prototype.localeCompare;
  const compare = spyOn(String.prototype, "localeCompare").mockImplementation(
    function (
      this: string,
      other: string,
      locales?: Intl.LocalesArgument,
      options?: Intl.CollatorOptions,
    ) {
      return original.call(this, other, locales ?? "da", options);
    },
  );
  try {
    return run();
  } finally {
    compare.mockRestore();
  }
}

describe("project registry order under a host locale", () => {
  test("tied projects keep the English id order on an English host", () => {
    expect(registryOrder()).toEqual(["aardvark", "abacus"]);
  });

  test("tied projects keep the English id order when the host locale is Danish", () => {
    expect(withDanishHostDefault(registryOrder)).toEqual([
      "aardvark",
      "abacus",
    ]);
  });

  test("the registry generator keeps the English id order when the host locale is Danish", async () => {
    // The generator refuses active projects without generated-skill
    // content; paused clones still exercise its id sort.
    const paused = defs.map((d) => ({ ...d, status: "paused" }));
    const rendered = await withDanishHostDefault(() =>
      renderProjectRegistry(paused),
    );
    expect(rendered.indexOf('"id":"aardvark"')).toBeGreaterThan(-1);
    expect(rendered.indexOf('"id":"aardvark"')).toBeLessThan(
      rendered.indexOf('"id":"abacus"'),
    );
  });
});
