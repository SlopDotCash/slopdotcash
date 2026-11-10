import { expect, test } from "bun:test";
import { onRequest } from "../functions/api/v1/[[path]]";
import { githubIdSet } from "../src/lib/github-ids";

test("githubIdSet rejects a malformed entry and names the variable, never its value", () => {
  expect(() =>
    githubIdSet("42,abc,43", "PROJECT_MODERATOR_GITHUB_IDS"),
  ).toThrow("PROJECT_MODERATOR_GITHUB_IDS contains a malformed GitHub ID");
  expect(() =>
    githubIdSet("42,abc,43", "PROJECT_MODERATOR_GITHUB_IDS"),
  ).not.toThrow("abc");
});

test("githubIdSet trims entries, skips empties, and rejects leading zeros", () => {
  expect(githubIdSet("42, 43 ,", "PROJECT_MODERATOR_GITHUB_IDS")).toEqual(
    new Set(["42", "43"]),
  );
  expect(githubIdSet(undefined, "PROJECT_MODERATOR_GITHUB_IDS")).toEqual(
    new Set(),
  );
  expect(githubIdSet("   ", "PROJECT_MODERATOR_GITHUB_IDS")).toEqual(new Set());
  expect(() => githubIdSet("0", "PROJECT_MODERATOR_GITHUB_IDS")).toThrow(
    "malformed GitHub ID",
  );
  expect(() => githubIdSet("042", "PROJECT_MODERATOR_GITHUB_IDS")).toThrow(
    "malformed GitHub ID",
  );
});

const pagesContext = (env: Record<string, string | undefined>) =>
  ({
    request: new Request("https://slop.cash/api/v1/points/disputes"),
    env,
    waitUntil: () => {},
  }) as never;

test("the Pages entry point fails loudly on a malformed moderator list", async () => {
  await expect(
    onRequest(pagesContext({ PROJECT_MODERATOR_GITHUB_IDS: "42,abc,43" })),
  ).rejects.toThrow(
    "PROJECT_MODERATOR_GITHUB_IDS contains a malformed GitHub ID",
  );
});

test("a malformed admin list does not break the points routes that never use it", async () => {
  // The admin set is parsed only where a route enforces it (value import,
  // admin-gated project routes, fee conversions, notifications). A typo in
  // it must not take down the points subsystem, so this request reaches
  // normal handling (401 for an unsigned request) instead of throwing.
  const response = await onRequest(pagesContext({ ADMIN_GITHUB_IDS: "abc" }));
  expect(response.status).toBe(401);
});

test("a malformed operator list does not break the points routes that never use it", async () => {
  // The operator set gates trace routes only; points routes never read it.
  const response = await onRequest(
    pagesContext({ OPERATOR_GITHUB_IDS: "abc" }),
  );
  expect(response.status).toBe(401);
});

test("a well-formed moderator list reaches request handling instead of failing at parse time", async () => {
  const response = await onRequest(
    pagesContext({ PROJECT_MODERATOR_GITHUB_IDS: "42,43" }),
  );
  expect(response.status).toBe(401);
});
