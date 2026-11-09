import { afterEach, expect, test } from "bun:test";
import { listOwnedRepositories, lookupGitHubRepository } from "../src/lib/project-proposal";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const sha = "a".repeat(40);
function facts(overrides: Record<string, unknown> = {}) {
  return {
    repository: "example/project", description: null, numericId: "123", nodeId: "R_example",
    defaultBranch: "main", branches: ["main", "constructor", "__proto__"],
    owner: { login: "example", actorId: "456", nodeId: "U_example", kind: "individual" },
    license: { state: "unknown", reason: "No license" }, ...overrides,
  };
}
function reply(value: unknown, status = 200) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json(value, { status });
  }) as typeof fetch;
  return requests;
}
const lookup = () => lookupGitHubRepository("example/project", new AbortController().signal);

test("an omitted optional commit map stays omitted", async () => {
  const requests = reply({ repository: facts() });
  const result = await lookup();
  expect(result.branchCommits).toBeUndefined();
  expect(requests[0].url).toBe("/api/v1/project-github/repositories/example/project");
  expect(requests[0].init).toMatchObject({ cache: "no-store", credentials: "same-origin" });
});

test("a partial commit map has no inherited branch values", async () => {
  reply({ repository: facts({ branchCommits: { main: sha } }) });
  const result = await lookup();
  expect(result.branchCommits?.main).toBe(sha);
  expect(result.branchCommits?.constructor).toBeUndefined();
  expect(result.branchCommits?.__proto__).toBeUndefined();
});

test.each(["constructor", "__proto__"])("an own %s commit survives normalization", async (branch) => {
  reply({ repository: facts({ branchCommits: Object.fromEntries([[branch, sha]]) }) });
  const result = await lookup();
  expect(Object.hasOwn(result.branchCommits!, branch)).toBe(true);
  expect(result.branchCommits?.[branch]).toBe(sha);
});

test.each([null, [], 7, { other: sha }, { main: "A".repeat(40) }, { main: 7 }])(
  "invalid optional commit map is refused: %j", async (branchCommits) => {
    reply({ repository: facts({ branchCommits }) });
    await expect(lookup()).rejects.toThrow("branch commits are unavailable");
  },
);

test.each([{ branches: null }, { branches: ["other"] }])("invalid branch list is refused: %j", async (change) => {
  reply({ repository: facts(change) });
  await expect(lookup()).rejects.toThrow("branch list is unavailable");
});

test("invalid path fails before fetch", async () => {
  const requests = reply({ repository: facts() });
  await expect(lookupGitHubRepository("not a repository", new AbortController().signal)).rejects.toThrow("owner/name");
  expect(requests).toHaveLength(0);
});

test.each([
  [401, { message: "private detail" }, "Sign in with GitHub"],
  [500, { message: "Public error detail" }, "Public error detail"],
  [500, { message: 7 }, "GitHub lookup failed"],
] as const)("HTTP %s uses the expected error message", async (status, value, message) => {
  reply(value, status);
  await expect(lookup()).rejects.toThrow(message);
});

test("unreadable JSON is a generic lookup failure", async () => {
  globalThis.fetch = (async () => new Response("{", { status: 401 })) as typeof fetch;
  await expect(lookup()).rejects.toThrow("GitHub lookup failed.");
});

test("missing repository is refused", async () => {
  reply({});
  await expect(lookup()).rejects.toThrow("GitHub lookup failed.");
});

test("owned repository lists retain their separate array contract", async () => {
  reply({ repositories: [] });
  expect(await listOwnedRepositories(new AbortController().signal)).toEqual([]);
  reply({ repositories: null });
  await expect(listOwnedRepositories(new AbortController().signal)).rejects.toThrow("GitHub lookup failed.");
});

