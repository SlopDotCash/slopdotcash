import { expect, test } from "bun:test";
import { githubFlaggerStanding } from "./flagger-standing";

// Actual standing reader with local Response fixtures. These tests establish
// response handling and traversal, not GitHub truth, account age eligibility,
// maintainer authority, flag persistence or live provider availability.
const actor = { githubId: "100", githubLogin: "old-login" };
const origin = "https://github-standing.invalid";
const account = { id: 100, type: "User", login: "current-login", created_at: "2020-01-01T00:00:00Z" };
const merged = (mergedAt: unknown = "2026-10-01T00:00:00Z", id: unknown = 100) => ({
  user: { id }, pull_request: { merged_at: mergedAt },
});
function fixture(options: {
  repositories?: string[];
  user?: unknown;
  page?: (url: URL) => Response | Promise<Response>;
  registryError?: Error;
} = {}) {
  const requests: URL[] = [];
  let registryReads = 0;
  const read = githubFlaggerStanding({
    apiOrigin: origin,
    registryRepositories: async () => {
      registryReads += 1;
      if (options.registryError) throw options.registryError;
      return options.repositories ?? ["org/one"];
    },
    fetch: async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(origin);
      requests.push(url);
      if (url.pathname === "/user/100") return Response.json(options.user ?? account);
      return options.page ? options.page(url) : Response.json([]);
    },
  });
  return { read, requests, registryReads: () => registryReads };
}

test("standing resolves the immutable actor before using the current login for repository reads", async () => {
  const f = fixture({ page: () => Response.json([merged()]) });
  expect(await f.read(actor)).toEqual({ accountCreatedAt: "2020-01-01T00:00:00.000Z", hasAcceptedContribution: true });
  expect(f.requests.map((url) => url.pathname)).toEqual(["/user/100", "/repos/org/one/issues"]);
  expect(f.requests[1].searchParams.get("creator")).toBe("current-login");
  expect(f.requests[1].searchParams.get("state")).toBe("closed");
  expect(f.requests[1].searchParams.get("per_page")).toBe("100");
  expect(f.requests[1].searchParams.get("page")).toBe("1");
});

test.each([
  { ...account, id: 101 },
  { ...account, type: "Organization" },
  { ...account, login: "not a login" },
  { ...account, created_at: "not-a-date" },
])("invalid account facts refuse before reading the registry", async (user) => {
  const f = fixture({ user });
  await expect(f.read(actor)).rejects.toThrow("incomplete account facts");
  expect(f.registryReads()).toBe(0);
  expect(f.requests).toHaveLength(1);
});

test("an empty registry returns a known negative with the normalized account date", async () => {
  const f = fixture({ repositories: [] });
  expect(await f.read(actor)).toEqual({ accountCreatedAt: "2020-01-01T00:00:00.000Z", hasAcceptedContribution: false });
  expect(f.requests).toHaveLength(1);
});

test("repository traversal deduplicates exact names and preserves first occurrence order", async () => {
  const f = fixture({ repositories: ["org/one", "org/one", "org/two"], page: (url) =>
    Response.json(url.pathname.includes("/two/") ? [merged()] : []) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
  expect(f.requests.slice(1).map((url) => url.pathname)).toEqual(["/repos/org/one/issues", "/repos/org/two/issues"]);
});

test("a witness stops before later repository validation", async () => {
  const f = fixture({ repositories: ["org/one", "invalid"], page: () => Response.json([merged()]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
  expect(f.requests).toHaveLength(2);
});

test("an invalid visited repository refuses rather than returning a partial negative", async () => {
  const f = fixture({ repositories: ["org/one", "invalid", "org/two"] });
  await expect(f.read(actor)).rejects.toThrow("registered repository name is invalid");
  expect(f.requests.slice(1).map((url) => url.pathname)).toEqual(["/repos/org/one/issues"]);
});

test("a missing repository is skipped without reading its body", async () => {
  const f = fixture({ repositories: ["org/one", "org/two"], page: (url) =>
    url.pathname.includes("/one/") ? new Response("not JSON", { status: 404 }) : Response.json([merged()]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
  expect(f.requests).toHaveLength(3);
});

test.each(["", "not-a-date", null, 123])("invalid merged timestamp %s does not grant accepted-contribution standing", async (value) => {
  const f = fixture({ page: () => Response.json([merged(value)]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(false);
});

test("another actor's merged pull request does not satisfy the immutable author check", async () => {
  const f = fixture({ page: () => Response.json([merged(undefined, 101)]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(false);
});

test("a valid later witness remains usable after an invalid timestamp", async () => {
  const f = fixture({ page: () => Response.json([merged(""), merged()]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
});

test("a full page continues sequentially and a short page ends the repository", async () => {
  const f = fixture({ page: (url) => Response.json(url.searchParams.get("page") === "1"
    ? Array.from({ length: 100 }, () => ({})) : [merged()]) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
  expect(f.requests.slice(1).map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
});

test("ten full witness-free pages refuse instead of reporting no accepted work", async () => {
  const f = fixture({ repositories: ["org/one", "org/two"], page: () => Response.json(Array.from({ length: 100 }, () => ({}))) });
  await expect(f.read(actor)).rejects.toThrow("too many closed items");
  expect(f.requests.slice(1)).toHaveLength(10);
  expect(f.requests.slice(1).every((url) => url.pathname === "/repos/org/one/issues")).toBe(true);
});

test("a witness on the tenth page qualifies before the exhaustion refusal", async () => {
  const f = fixture({ page: (url) => Response.json(url.searchParams.get("page") === "10"
    ? Array.from({ length: 100 }, (_, index) => index === 99 ? merged() : {})
    : Array.from({ length: 100 }, () => ({}))) });
  expect((await f.read(actor)).hasAcceptedContribution).toBe(true);
  expect(f.requests).toHaveLength(11);
});

test.each([
  () => new Response("unavailable", { status: 503 }),
  () => Response.json({ items: [] }),
  () => new Response("not JSON"),
  () => Response.json([null]),
])("unavailable or malformed repository reads refuse the standing result", async (page) => {
  const f = fixture({ page });
  await expect(f.read(actor)).rejects.toThrow();
});

test("registry failure does not become an empty-registry success", async () => {
  const f = fixture({ registryError: new Error("registry read failed") });
  await expect(f.read(actor)).rejects.toThrow("registry read failed");
  expect(f.requests).toHaveLength(1);
});
