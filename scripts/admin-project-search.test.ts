import { describe, expect, test } from "bun:test";
import type { AdminProject } from "../src/lib/project-contracts";
import { adminProjectSearchText } from "../src/lib/project-contracts";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { RAW_PROJECT_DEFINITIONS } from "../tests/fixtures/project-registry.mjs";

// The admin project list's "Find a project or repository" search, exercised
// against the frozen registry fixture. Two fixture projects had their
// repositories transferred: the manifest keeps the registered path in `id`
// and the current path as the last alias. The search must answer to every
// path in that identity set, like the registry, enforcement and the
// published skills do — not only to the registered path.
function adminProject(definition: ProjectDefinition) {
  return {
    id: definition.id,
    manifest: definition,
  } as AdminProject;
}

function matches(project: AdminProject, query: string): boolean {
  return adminProjectSearchText(project)
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

const projects = RAW_PROJECT_DEFINITIONS.map(adminProject);
const byId = new Map(projects.map((project) => [project.id, project]));
const asi = byId.get("asi");
const deltaStar = byId.get("delta-star");
if (!asi || !deltaStar) throw new Error("fixture projects missing");

describe("admin project search", () => {
  test("finds a transferred project by its current repository path", () => {
    expect(asi.manifest.repositories[0]?.aliases?.at(-1)).toBe(
      "SlopDotCash/asi",
    );
    expect(matches(asi, "SlopDotCash/asi")).toBe(true);
    expect(matches(asi, "slopdotcash/asi")).toBe(true);
    expect(matches(asi, "slopdotcash")).toBe(true);
    expect(deltaStar.manifest.repositories[0]?.aliases?.at(-1)).toBe(
      "SlopDotCash/proximityprize",
    );
    expect(matches(deltaStar, "SlopDotCash/proximityprize")).toBe(true);
  });

  test("still finds projects by registered path, id and name", () => {
    expect(matches(asi, "elizaOS/asi")).toBe(true);
    expect(matches(asi, "ASI")).toBe(true);
    expect(matches(asi, "asi")).toBe(true);
    expect(matches(deltaStar, "elizaOS/proximityprize")).toBe(true);
    expect(matches(deltaStar, "Delta Star")).toBe(true);
  });

  test("every fixture project is findable by every repository path it answers to", () => {
    for (const project of projects) {
      for (const repository of project.manifest.repositories) {
        for (const path of [repository.id, ...(repository.aliases ?? [])]) {
          expect(matches(project, path)).toBe(true);
        }
      }
    }
  });

  test("does not match unrelated queries or another project's path", () => {
    expect(matches(asi, "elizaOS/eliza")).toBe(false);
    expect(matches(asi, "SlopDotCash/proximityprize")).toBe(false);
    expect(matches(deltaStar, "SlopDotCash/asi")).toBe(false);
    expect(matches(asi, "no such project")).toBe(false);
  });
});
