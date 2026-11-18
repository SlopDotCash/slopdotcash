import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  HISTORICAL_PROJECTS,
  type ProjectDefinition,
} from "../src/lib/projects.mjs";
import { assertCorrectionRegistry } from "./points-correction-registry";

const through = "2026-11-14T03:32:50.000Z";
const before = "2026-11-13T00:00:00.000Z";
const after = "2026-11-15T02:27:51.679Z";
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function revision(
  manifest: ProjectDefinition,
  revision: number,
  createdAt: string,
) {
  // Property order is the public revision API order, not the generated file.
  return {
    projectId: manifest.id,
    revision,
    manifest,
    manifestSha256: hash(manifest),
    reason: "Test registry revision",
    createdAt,
  };
}

function registryFixture() {
  const projects = structuredClone(
    HISTORICAL_PROJECTS.filter((project) =>
      ["eliza", "feed", "slopdotcash"].includes(project.id),
    ),
  ).sort((left, right) => left.id.localeCompare(right.id));
  const archive = {
    projects,
    revisions: projects.map((project) => revision(project, 1, through)),
    withheld: [] as string[],
  };
  const current = structuredClone(archive);
  const feed = {
    ...current.projects[1],
    description: `${current.projects[1].description} Later unrelated update.`,
  };
  current.projects[1] = feed;
  current.revisions.splice(2, 0, revision(feed, 2, after));
  return { archive, current, digest: hash(archive) };
}

test("an exact full registry digest still authorizes a legacy receipt without projects", () => {
  const { archive, digest } = registryFixture();
  expect(() =>
    assertCorrectionRegistry(digest, through, undefined, archive),
  ).not.toThrow();
});

test("an exact digest cannot authorize a malformed supplied scope", () => {
  const { archive, digest } = registryFixture();
  for (const projects of [[], ["eliza", "eliza"], ["eliza", " "]]) {
    expect(() =>
      assertCorrectionRegistry(digest, through, projects, archive),
    ).toThrow("requires distinct selected projects");
  }
});

test("an unrelated later revision reconstructs the exact full archived digest", () => {
  const { archive, current, digest } = registryFixture();
  const saved = JSON.stringify(current);
  expect(hash(current)).not.toBe(digest);
  expect(() =>
    assertCorrectionRegistry(
      digest,
      through,
      ["slopdotcash", "eliza"],
      current,
    ),
  ).not.toThrow();
  expect(JSON.stringify(current)).toBe(saved);
  expect(hash(archive)).toBe(digest);
});

test("an unrelated retroactive or rewritten archive cannot match the full digest", () => {
  const { archive, current, digest } = registryFixture();
  current.revisions[2].createdAt = through;
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("cannot be reproduced exactly");
  current.revisions[2].createdAt = after;
  current.revisions[1].reason = "A rewritten reason in an unselected row";
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("cannot be reproduced exactly");
  expect(() =>
    assertCorrectionRegistry(
      hash({ ...archive, withheld: ["feed"] }),
      through,
      ["eliza"],
      current,
    ),
  ).toThrow("cannot be reproduced exactly");
});

test("a selected later revision is rejected even when the current manifest is byte-identical", () => {
  const { current, digest } = registryFixture();
  const selected = current.projects[0];
  current.revisions.splice(1, 0, revision(selected, 2, after));
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("Selected correction registry scope changed");
});

test("unrelated pending restrictions may differ only by the canonical projection", () => {
  const { current, digest } = registryFixture();
  current.withheld = ["feed"];
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("manifests do not match");
  current.projects[1] = {
    ...current.projects[1],
    status: "paused",
    listingTier: "retired",
  };
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).not.toThrow();
  current.withheld.push("feed");
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("withheld scope is malformed");
});

test("pending restrictions and a changed manifest on a selected project fail closed", () => {
  const { current, digest } = registryFixture();
  const selected = current.projects[0];
  current.withheld = ["eliza"];
  current.projects[0] = {
    ...selected,
    status: "paused",
    listingTier: "retired",
  };
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("Selected correction registry scope changed");
  current.withheld = [];
  current.projects[0] = {
    ...selected,
    description: `${selected.description} Later selected update.`,
  };
  current.revisions.splice(1, 0, revision(current.projects[0], 2, after));
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("Selected correction registry scope changed");
});

test("historical replay requires valid ordered manifest history and a known distinct scope", () => {
  const { current, digest } = registryFixture();
  for (const projects of [undefined, [], ["eliza", "eliza"], ["unknown"]]) {
    expect(() =>
      assertCorrectionRegistry(digest, through, projects, current),
    ).toThrow();
  }
  expect(() =>
    assertCorrectionRegistry(
      digest,
      "2026-11-14T03:32:50Z",
      ["eliza"],
      current,
    ),
  ).toThrow("canonical UTC timestamp");
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], {
      ...current,
      revisions: [...current.revisions.slice(1), current.revisions[0]],
    }),
  ).toThrow("revision order changed");
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], {
      ...current,
      revisions: current.revisions.map((row, index) =>
        index === 2 ? { ...row, manifestSha256: "0".repeat(64) } : row,
      ),
    }),
  ).toThrow("does not match its digest");
  current.revisions[2].createdAt = before;
  expect(() =>
    assertCorrectionRegistry(digest, through, ["eliza"], current),
  ).toThrow("revision order changed");
});
