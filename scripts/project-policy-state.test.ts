import { expect, test } from "bun:test";
import { assertProjectPolicyTransition } from "../src/lib/project-policy.mjs";
import { classifyRevisionChanges, executableManifestContent } from "../src/lib/project-revision-changes";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { collectTargetRepositories } from "../src/lib/repositories.mjs";
import { fixtureProject } from "../tests/fixture-overlay.mjs";

// Actual pure entrypoints. Fixtures are retained policy data, not evidence of
// current GitHub authority, project admission, a published revision or payment.
function activePolicy() { return fixtureProject("slopdotcash"); }
function nextTerms(previous = activePolicy(), revision = "2026-11-09.1", at = "2026-11-09T00:00:00.000Z") {
  const next = structuredClone(previous);
  next.terms.revision = revision;
  next.terms.effectiveAt = at;
  next.authority.proof.policyRevision = revision;
  next.terms.receiptPolicy.bindings.push({
    ...next.terms.receiptPolicy.bindings.at(-1), policyRevision: revision, activatedAt: at,
  });
  return next;
}
function pendingPolicy() {
  const project = activePolicy();
  project.status = "paused";
  project.authority = { ...project.authority, state: "unverified", reason: "missing-repository-proof", proof: null };
  project.terms.receiptPolicy = { state: "pending-authority-activation", activatedAt: null, bindings: [] };
  return project;
}

test("unchanged policy returns the supplied next object without rewriting prior history", () => {
  const before = activePolicy(), next = structuredClone(before), original = structuredClone(before);
  expect(assertProjectPolicyTransition(before, next)).toBe(next);
  expect(before).toEqual(original);
});

test("one binding-relevant revision appends one receipt while retaining prior bytes", () => {
  const before = activePolicy(), next = nextTerms(before), original = structuredClone(before);
  expect(assertProjectPolicyTransition(before, next)).toBe(next);
  expect(next.terms.receiptPolicy.bindings.slice(0, -1)).toEqual(before.terms.receiptPolicy.bindings);
  expect(before).toEqual(original);
});

test("material edits need a policy revision after activation", () => {
  const before = activePolicy(), next = structuredClone(before);
  next.steward.displayName += " updated";
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("material terms drift");
});

test("a changed binding revision cannot omit its matching appended receipt", () => {
  const before = activePolicy(), next = nextTerms(before);
  next.terms.receiptPolicy.bindings.pop();
  expect(() => assertProjectPolicyTransition(before, next)).toThrow();
});

test("one transition cannot append two otherwise valid receipt bindings", () => {
  const before = activePolicy();
  const next = nextTerms(nextTerms(before), "2026-11-10.1", "2026-11-10T00:00:00.000Z");
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("at most one binding");
});

test("historical receipt fields cannot change when the latest binding still matches", () => {
  const before = nextTerms(), next = structuredClone(before);
  next.terms.receiptPolicy.bindings[0].licenseSha256 = "a".repeat(64);
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("exact append-only prefix");
});

test("cutover is immutable even when the replacement envelope is internally consistent", () => {
  const before = activePolicy(), next = structuredClone(before);
  const at = "2026-11-09T00:00:00.000Z";
  next.terms.effectiveAt = at;
  next.terms.receiptPolicy.activatedAt = at;
  next.terms.receiptPolicy.bindings[0].activatedAt = at;
  next.authority.proof.verifiedAt = at;
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("cutover activation is immutable");
});

test("active receipt history cannot be reset to pending on a paused project", () => {
  const before = activePolicy(), next = structuredClone(before);
  next.status = "paused";
  next.terms.receiptPolicy = { state: "pending-authority-activation", activatedAt: null, bindings: [] };
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("cannot revert to pending");
});

test("first activation keeps the explicit same-revision material exception", () => {
  const before = pendingPolicy(), next = activePolicy();
  next.steward.displayName += " updated";
  expect(assertProjectPolicyTransition(before, next)).toBe(next);
});

test("first activation cannot start with more than one historical binding", () => {
  const before = pendingPolicy(), next = nextTerms();
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("exactly one first binding");
});

test("verified proof must name the current terms even for a paused project", () => {
  const before = activePolicy(), next = nextTerms(before);
  next.status = "paused";
  next.authority.proof.policyRevision = before.terms.revision;
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("proof does not bind");
});

test("repository rename appends an alias and retains the immutable repository id", () => {
  const before = activePolicy(), next = structuredClone(before);
  const alias = "SlopDotCash/slopdotcash-renamed";
  next.repositories[0].aliases = [...(next.repositories[0].aliases ?? []), alias];
  next.repositories[0].displayName = alias;
  next.repositories[0].githubUrl = `https://github.com/${alias}`;
  expect(assertProjectPolicyTransition(before, next)).toBe(next);
  expect(next.repositories[0].id).toBe(before.repositories[0].id);
});

test("repository metadata cannot silently change without an appended alias", () => {
  const before = activePolicy(), next = structuredClone(before);
  next.repositories[0].displayName += " renamed";
  expect(() => assertProjectPolicyTransition(before, next)).toThrow("metadata may change only");
});

test("integration branch and permanent repository actor identity stay fixed", () => {
  const before = activePolicy(), branch = structuredClone(before), identity = structuredClone(before);
  branch.repositories[0].integrationBranch = "other-branch";
  identity.authority.repositoryId = "123456789";
  expect(() => assertProjectPolicyTransition(before, branch)).toThrow("integration-branch drift");
  expect(() => assertProjectPolicyTransition(before, identity)).toThrow("integration-branch drift");
});

const asProject = (value: object) => value as ProjectDefinition;
// Classification does not validate a schema. Partial plain objects isolate
// its field table and canonical equality from the transition validator above.
test("classification groups sorted changed keys while keeping fixed executable fields restricted", () => {
  const changed = asProject({ name: "new", links: {}, contribution: {}, funding: {}, id: "new", repositories: [], skill: {}, reviewSkill: {}, arbitrary: true });
  expect(classifyRevisionChanges(asProject({}), changed)).toEqual({
    presentation: ["links", "name"], executable: ["contribution"], financial: ["funding"],
    restricted: ["arbitrary", "id", "repositories", "reviewSkill", "skill"],
  });
});

test("classification normalizes missing and null but preserves array order", () => {
  expect(classifyRevisionChanges(asProject({}), asProject({ links: null }))).toEqual({ presentation: [], executable: [], financial: [], restricted: [] });
  expect(classifyRevisionChanges(asProject({ contribution: [1, 2] }), asProject({ contribution: [2, 1] })).executable).toEqual(["contribution"]);
  expect(classifyRevisionChanges(asProject({ links: { a: 1, b: 2 } }), asProject({ links: { b: 2, a: 1 } })).presentation).toEqual([]);
});

test("deleted financial data remains a financial change", () => {
  expect(classifyRevisionChanges(asProject({ funding: { value: 1 } }), asProject({})).financial).toEqual(["funding"]);
});

test("executable content selects own fixed fields and retains nested references", () => {
  const contribution = { rules: "retain" };
  const manifest = Object.assign(Object.create({ id: "inherited" }), { contribution, skill: { id: "s" }, name: "ignored" });
  const content = executableManifestContent(manifest);
  expect(Object.keys(content)).toEqual(["skill", "contribution"]);
  expect(content.contribution).toBe(contribution);
  expect(Object.hasOwn(content, "id")).toBe(false);
});

function collectionProject(id: string, active: boolean, repositories: string[]) {
  return { id, status: active ? "active" : "paused", authority: { state: "unverified", repositoryNodeId: `node-${id}` },
    repositories: repositories.map((repository) => ({ id: repository, displayName: repository, githubUrl: `https://github.com/${repository}`, aliases: [], description: "A retained test repository.", integrationBranch: "main" })) };
}

test("collection ignores authority but filters pauses and promotes the next active primary", () => {
  const paused = collectionProject("first", false, ["owner/first"]);
  const active = collectionProject("second", true, ["owner/second", "owner/third"]);
  const rows = collectTargetRepositories([paused, active]);
  expect(rows.map((row) => [row.id, row.role, row.projectId])).toEqual([
    ["owner/second", "primary", "second"], ["owner/third", "member", "second"],
  ]);
  expect(collectTargetRepositories([paused])).toEqual([]);
});

test("caller order controls collection order and exactly one primary", () => {
  const a = collectionProject("a", true, ["owner/a"]), b = collectionProject("b", true, ["owner/b"]);
  expect(collectTargetRepositories([b, a]).map((row) => [row.id, row.role])).toEqual([["owner/b", "primary"], ["owner/a", "member"]]);
});

test("transferred current path carries the permanent node pin; case-only path does not", () => {
  const project = collectionProject("a", true, ["Owner/Repo"]);
  project.repositories[0].githubUrl = "https://github.com/owner/repo";
  expect(collectTargetRepositories([project])[0].expectedNodeId).toBeNull();
  project.repositories[0].githubUrl = "https://github.com/new-owner/new-name";
  expect(collectTargetRepositories([project])[0]).toMatchObject({ owner: "new-owner", name: "new-name", expectedNodeId: "node-a" });
});

test("collection freezes returned rows shallowly and aborts a later invalid URL", () => {
  const first = collectionProject("a", true, ["owner/a"]), second = collectionProject("b", true, ["owner/b"]);
  const row = collectTargetRepositories([first])[0];
  expect(Object.isFrozen(row)).toBe(true);
  expect(row.aliases).toBe(first.repositories[0].aliases);
  second.repositories[0].githubUrl = "not a URL";
  expect(() => collectTargetRepositories([first, second])).toThrow();
});
