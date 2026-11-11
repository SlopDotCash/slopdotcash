/** Keep the legacy-cache quotient bound to its reviewed noninterference argument. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "formal/models/api/api_project_lookup_routes.qnt",
  "utf8",
);

function checkReviewedBoundary(model: string) {
  const start = model.indexOf("module api_project_lookup_routes {");
  const end = model.indexOf("  action start(", start);
  if (start < 0 || end < start)
    throw new Error("Missing project-lookup safety boundary");
  // Bind schema, domains, every current helper/transition, projection and
  // invariant. A future indirect read also needs renewed review.
  const digest = createHash("sha256")
    .update(model.slice(start, end))
    .digest("hex");
  if (
    digest !==
    "a83cce3a3839e3b5a78284a8d5f3f6bf61fac2cc29d02411f2e0b960299bf8d9"
  )
    throw new Error("Project-lookup observation quotient needs review");
}

test("lookup legacy-cache erasure retains its complete reviewed transition and invariant boundary", () => {
  checkReviewedBoundary(source);
});

test("a future read cannot silently reuse the legacy-cache quotient", () => {
  const changed = source.replace(
    "request.attempt <= 2,",
    "request.attempt <= 2, s.legacyCache.get(1).version >= 0,",
  );
  expect(changed).not.toBe(source);
  expect(() => checkReviewedBoundary(changed)).toThrow(
    "observation quotient needs review",
  );
});

test("new terminal payload reads require a new continuation review", () => {
  for (const field of [
    "method",
    "transport",
    "expected",
    "loginValid",
    "repository",
    "cacheEnabled",
    "login",
    "selectedExpected",
    "delivered",
    "key",
    "payload",
    "waitUntil",
  ]) {
    const changed = source.replace(
      'all { request.phase == "response",',
      `all { request.phase == "response", request.${field} == idle.${field},`,
    );
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "observation quotient needs review",
    );
  }
});

test("exact diagnostic or refusal-input reads require a new observation proof", () => {
  for (const observation of [
    "s.dataVersion == 1",
    "s.cache.get(1).version == 1",
    "request.payload == 1",
    "s.loginVersion.get(1) == 1",
    "request.login == 1",
    'request.phase != "dispatch" or request.expected == 0',
  ]) {
    const changed = source.replace(
      "request.attempt <= 2,",
      `request.attempt <= 2, ${observation},`,
    );
    expect(changed).not.toBe(source);
    expect(() => checkReviewedBoundary(changed)).toThrow(
      "observation quotient needs review",
    );
  }
});
