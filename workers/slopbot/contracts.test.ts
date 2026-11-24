// #1930: the misread-literal guard is pure, so it is tested here without
// a worker or a database. Run with: bun test workers/slopbot/contracts.test.ts

import { expect, test } from "bun:test";
import { misreadLiteralClaim } from "./contracts";

const SHA =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

test("misreadLiteralClaim flags a 64-hex digest called invalid", () => {
  const found = misreadLiteralClaim(
    `The commit ${SHA} is invalid and cannot be verified.`,
  );
  expect(found).not.toBeNull();
  expect(found?.literal).toBe(SHA);
  expect(found?.kind).toBe("sha256");
  expect(found?.denial.toLowerCase()).toBe("invalid");
});

test("misreadLiteralClaim flags a 0x address called undefined", () => {
  const found = misreadLiteralClaim(
    "The payout address 0x742d35Cc6634C0532925a3b844Bc454e4438f44e is undefined.",
  );
  expect(found?.kind).toBe("hex-address");
  expect(found?.denial.toLowerCase()).toBe("undefined");
});

test("misreadLiteralClaim ignores a literal with no denial nearby", () => {
  expect(
    misreadLiteralClaim(`The commit ${SHA} was merged cleanly.`),
  ).toBeNull();
});

test("misreadLiteralClaim ignores a denial far from the literal", () => {
  const padding = "The patch touches many files. ".repeat(10);
  expect(
    misreadLiteralClaim(`The commit ${SHA} was merged. ${padding}The config is invalid.`),
  ).toBeNull();
});

test("misreadLiteralClaim ignores a short 0x value", () => {
  expect(misreadLiteralClaim("The value 0x123 is invalid.")).toBeNull();
});

test("misreadLiteralClaim matches uppercase hex and case-insensitive denials", () => {
  const upper = SHA.toUpperCase();
  const found = misreadLiteralClaim(`The digest ${upper} is INVALID.`);
  expect(found?.literal).toBe(upper);
  expect(found?.kind).toBe("sha256");
});
