/**
 * Login must return to the named site path and must not follow a next value
 * that URL parsing turns into another origin (PRD section 3).
 */
import { expect, test } from "bun:test";
import { loginReturnPath } from "../src/lib/login-return";

const origin = "https://slop.cash";

function returned(next: string): string | null {
  return loginReturnPath(`?next=${encodeURIComponent(next)}`, origin);
}

test("login keeps an in-site return path", () => {
  expect(returned("/projects/new?step=2#draft")).toBe(
    "/projects/new?step=2#draft",
  );
  expect(returned("earnings")).toBe("/earnings");
  expect(returned("/contributors/return-member")).toBe(
    "/contributors/return-member",
  );
});

test("login refuses a next value that resolves to another origin", () => {
  for (const next of [
    "//evil.example/steal",
    "/.//evil.example/steal",
    "/foo/..//evil.example/steal",
    "/%2e%2e//evil.example/steal",
    "/login/..//evil.example/steal",
    "/foo/bar/../../..//evil.example/steal",
    "https://evil.example/steal",
    "/\\evil.example/steal",
  ])
    expect(returned(next)).toBeNull();
});
