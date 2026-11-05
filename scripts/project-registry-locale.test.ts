/**
 * The project registry order decides the home Featured/Community browse
 * order. Every pool key can tie (the current registry has six community
 * projects tied on committed, cap, and root), so the final tie-break is the
 * project id order. A host locale whose collation reorders ids (Danish
 * treats "aa" as "å", sorting it after "z") must not change the published
 * order: the id tie-break is pinned to English collation like the review
 * and standings orders in leaderboard.ts.
 */
import { describe, expect, mock, spyOn, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { RAW_PROJECT_DEFINITIONS as FIXTURE } from "../tests/fixtures/project-registry.mjs";

const base = FIXTURE.find((p) => p.id === "thenetwork");

function cloneProject(id) {
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

mock.module(
  fileURLToPath(
    new URL("../src/lib/project-registry.generated.mjs", import.meta.url),
  ),
  () => ({ RAW_PROJECT_DEFINITIONS: defs }),
);

async function registryOrder(tag) {
  const { PROJECTS } = await import(
    `../src/lib/projects.mjs?registry-order=${tag}`
  );
  return PROJECTS.map((p) => p.id);
}

describe("project registry order under a host locale", () => {
  test("tied projects keep the English id order on an English host", async () => {
    expect(await registryOrder("en-host")).toEqual(["aardvark", "abacus"]);
  });

  test("tied projects keep the English id order when the host locale is Danish", async () => {
    const original = String.prototype.localeCompare;
    const compare = spyOn(String.prototype, "localeCompare").mockImplementation(
      function (
        this: string,
        other: string,
        locales?: Intl.LocalesArgument,
        options?: Intl.CollatorOptions,
      ) {
        // Simulate a host whose default collation is Danish: only calls
        // without an explicit locale resolve to it.
        return original.call(this, other, locales ?? "da", options);
      },
    );
    try {
      expect(await registryOrder("da-host")).toEqual(["aardvark", "abacus"]);
    } finally {
      compare.mockRestore();
    }
  });
});
