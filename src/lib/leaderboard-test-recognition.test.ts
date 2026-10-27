import { expect, test } from "bun:test";
import {
  isNearMaterialTestChange,
  isRecognizedTestFile,
  materialTestStats,
} from "./leaderboard";

// Fixture, snapshot, and testdata dirs hold test data, not tests, so files
// under them are excluded from test recognition. The old exclusion matched
// only nested paths ("/fixtures/"), so a root file was recognized while the
// same file nested was not. The fix anchors the exclusion with (^|/),
// like the inclusions, so root and nested agree.
test("repo-root fixture dirs are excluded, like nested ones", () => {
  expect(isRecognizedTestFile("fixtures/foo.test.ts")).toBe(false);
  expect(isRecognizedTestFile("__snapshots__/foo.test.ts")).toBe(false);
  expect(isRecognizedTestFile("testdata/foo.spec.ts")).toBe(false);
});

test("nested fixture dirs stay excluded", () => {
  expect(isRecognizedTestFile("src/fixtures/foo.test.ts")).toBe(false);
  expect(isRecognizedTestFile("src/__snapshots__/foo.test.ts")).toBe(false);
  expect(isRecognizedTestFile("src/testdata/foo.spec.ts")).toBe(false);
});

test("ordinary test paths are unchanged", () => {
  expect(isRecognizedTestFile("foo.test.ts")).toBe(true);
  expect(isRecognizedTestFile("src/foo.test.ts")).toBe(true);
  expect(isRecognizedTestFile("src/index.ts")).toBe(false);
});

test("near-material-test guidance agrees between root and nested", () => {
  const root = [{ path: "fixtures/foo.test.ts", additions: 5, deletions: 5 }];
  const nested = [
    { path: "src/fixtures/foo.test.ts", additions: 5, deletions: 5 },
  ];
  // Pre-fix, the root input read { additions: 5, churn: 10 } and near true
  // while the nested input read { additions: 0, churn: 0 } and near false.
  // Post-fix, both read the same.
  expect(materialTestStats(root as never)).toEqual({
    additions: 0,
    churn: 0,
  });
  expect(materialTestStats(nested as never)).toEqual({
    additions: 0,
    churn: 0,
  });
  expect(isNearMaterialTestChange(root as never)).toBe(false);
  expect(isNearMaterialTestChange(nested as never)).toBe(false);
});
