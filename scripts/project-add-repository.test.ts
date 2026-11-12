import { expect, test } from "bun:test";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import {
  appendedRepositories,
  findListedRepository,
  nextUtcMonthStart,
  repositoriesCountedFor,
  repositoryCountsFrom,
  repositoryIdentity,
} from "../src/lib/project-repositories.mjs";
import { classifyRevisionChanges } from "../src/lib/project-revision-changes";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";

type Project = ReturnType<typeof fixtureProject>;

function entry(name: string, extra: Record<string, unknown> = {}) {
  return {
    id: `acme/${name}`,
    displayName: `acme/${name}`,
    githubUrl: `https://github.com/acme/${name}`,
    description: `The ${name} repository of the project.`,
    integrationBranch: "main",
    githubId: String(100000000 + name.length * 1000 + name.charCodeAt(0)),
    nodeId: `R_kgDO${name}`,
    countsFrom: "2026-12-01T00:00:00.000Z",
    ...extra,
  };
}

function withRepositories(project: Project, extra: object[]): Project {
  const copy = structuredClone(project);
  copy.repositories = [...copy.repositories, ...extra] as never;
  return copy;
}

const base = () => fixtureProject("eliza");

test("schema accepts appended entries with all three identity fields", () => {
  expect(() =>
    assertProjectDefinition(withRepositories(base(), [entry("one")])),
  ).not.toThrow();
});

test("schema rejects identity fields on the primary repository", () => {
  const project = base();
  Object.assign(project.repositories[0], {
    githubId: "1",
    nodeId: "R_x",
    countsFrom: "2026-12-01T00:00:00.000Z",
  });
  expect(() => assertProjectDefinition(project)).toThrow();
});

test("schema rejects a duplicate githubId across appended entries", () => {
  expect(() =>
    assertProjectDefinition(
      withRepositories(base(), [
        entry("one"),
        entry("two", { githubId: entry("one").githubId }),
      ]),
    ),
  ).toThrow();
});

test("schema rejects a duplicate nodeId across appended entries", () => {
  expect(() =>
    assertProjectDefinition(
      withRepositories(base(), [
        entry("one"),
        entry("two", { nodeId: "R_kgDOone" }),
      ]),
    ),
  ).toThrow();
});

test("schema rejects an appended githubId equal to the authority repository", () => {
  const project = base();
  expect(() =>
    assertProjectDefinition(
      withRepositories(project, [
        entry("one", { githubId: project.authority.repositoryId }),
      ]),
    ),
  ).toThrow();
});

test("schema rejects an appended nodeId equal to the authority repository", () => {
  const project = base();
  expect(() =>
    assertProjectDefinition(
      withRepositories(project, [
        entry("one", { nodeId: project.authority.repositoryNodeId }),
      ]),
    ),
  ).toThrow();
});

test("schema rejects a partial set and bad values", () => {
  for (const key of ["githubId", "nodeId", "countsFrom"]) {
    const partial: Record<string, unknown> = entry("one");
    delete partial[key];
    expect(() =>
      assertProjectDefinition(withRepositories(base(), [partial])),
    ).toThrow();
  }
  for (const countsFrom of [
    "2026-12-02T00:00:00.000Z",
    "2026-12-01T00:00:00Z",
    "2026-13-01T00:00:00.000Z",
    "2026-02-30T00:00:00.000Z",
  ]) {
    expect(() =>
      assertProjectDefinition(
        withRepositories(base(), [entry("one", { countsFrom })]),
      ),
    ).toThrow();
  }
  for (const githubId of ["0", "012", "abc", ""]) {
    expect(() =>
      assertProjectDefinition(
        withRepositories(base(), [entry("one", { githubId })]),
      ),
    ).toThrow();
  }
});

test("policy allows appending one or two entries", () => {
  const previous = base();
  expect(() =>
    assertProjectPolicyTransition(
      previous,
      withRepositories(previous, [entry("one")]),
    ),
  ).not.toThrow();
  expect(() =>
    assertProjectPolicyTransition(
      previous,
      withRepositories(previous, [entry("one"), entry("two")]),
    ),
  ).not.toThrow();
});

test("policy refuses removal, reorder, mutation and malformed appends", () => {
  const previous = withRepositories(base(), [entry("one"), entry("two")]);
  const removed = structuredClone(previous);
  removed.repositories = removed.repositories.slice(0, 2);
  expect(() => assertProjectPolicyTransition(previous, removed)).toThrow();

  const reordered = structuredClone(previous);
  reordered.repositories = [
    reordered.repositories[0],
    reordered.repositories[2],
    reordered.repositories[1],
  ] as never;
  expect(() => assertProjectPolicyTransition(previous, reordered)).toThrow();

  for (const [key, value] of [
    ["countsFrom", "2027-01-01T00:00:00.000Z"],
    ["githubId", "987"],
    ["nodeId", "R_other"],
  ]) {
    const changed = structuredClone(previous);
    Object.assign(changed.repositories[1], { [key]: value });
    expect(() => assertProjectPolicyTransition(previous, changed)).toThrow();
  }

  const single = base();
  for (const bad of [
    { countsFrom: undefined },
    { githubId: undefined },
    { nodeId: undefined },
    { aliases: ["acme/old"] },
  ]) {
    const candidate = withRepositories(single, [entry("one", bad)]);
    expect(() => assertProjectPolicyTransition(single, candidate)).toThrow();
  }
});

test("classification: a pure append is executable and not restricted", () => {
  const previous = base();
  const next = withRepositories(previous, [entry("one")]);
  const changes = classifyRevisionChanges(previous, next);
  expect(changes.executable).toContain("repositories");
  expect(changes.restricted).not.toContain("repositories");

  const renamed = structuredClone(next);
  renamed.repositories[0].description = "A different description entirely.";
  expect(classifyRevisionChanges(next, renamed).restricted).toContain(
    "repositories",
  );
  const removed = structuredClone(next);
  removed.repositories = removed.repositories.slice(0, 1);
  expect(classifyRevisionChanges(next, removed).restricted).toContain(
    "repositories",
  );
});

test("helpers", () => {
  expect(nextUtcMonthStart(new Date("2026-11-12T18:00:00.000Z"))).toBe(
    "2026-12-01T00:00:00.000Z",
  );
  expect(nextUtcMonthStart(new Date("2026-12-31T23:59:59.999Z"))).toBe(
    "2027-01-01T00:00:00.000Z",
  );
  const previous = base();
  const next = withRepositories(previous, [entry("one")]);
  expect(appendedRepositories(previous, previous)).toEqual([]);
  expect(appendedRepositories(previous, next)).toEqual([entry("one")]);
  expect(appendedRepositories(next, previous)).toBeNull();

  expect(repositoryIdentity(next, previous.repositories[0].id)).toEqual({
    githubId: previous.authority.repositoryId,
    nodeId: previous.authority.repositoryNodeId,
  });
  expect(repositoryIdentity(next, "acme/one")).toEqual({
    githubId: entry("one").githubId,
    nodeId: "R_kgDOone",
  });
  expect(repositoryIdentity(next, "acme/missing")).toBeNull();
  expect(repositoryCountsFrom(next, previous.repositories[0].id)).toBeNull();
  const december = Date.parse("2026-12-01T00:00:00.000Z");
  expect(repositoryCountsFrom(next, "acme/one")).toBe(december);
  const transferred = structuredClone(next);
  Object.assign(transferred.repositories[1], { aliases: ["acme/older"] });
  expect(repositoryCountsFrom(transferred, "acme/older")).toBe(december);
  expect(repositoriesCountedFor(next, december - 1)).toHaveLength(1);
  expect(repositoriesCountedFor(next, december)).toHaveLength(2);
});

test("an exact repository id wins over another entry's alias", () => {
  const repositories = [
    { ...entry("one"), aliases: ["acme/two"] },
    entry("two"),
  ] as never[];
  expect(findListedRepository(repositories, "ACME/two")?.index).toBe(1);
  expect(findListedRepository(repositories, "acme/one")?.index).toBe(0);
  expect(findListedRepository(repositories, "acme/three")).toBeNull();
});
