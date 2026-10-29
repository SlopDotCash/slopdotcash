import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";
import { readLeaderboardSnapshotBytes } from "./generate-points";

test("a missing leaderboard input fails with the preparation step, not a bare ENOENT", async () => {
  const root = mkdtempSync(join(tmpdir(), "generate-points-missing-"));
  const previous = process.cwd();
  process.chdir(root);
  try {
    const error = await readLeaderboardSnapshotBytes(
      "public/data/leaderboard.json",
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "public/data/leaderboard.json is missing",
    );
    expect((error as Error).message).toContain("leaderboard:generate");
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a present leaderboard input is returned unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "generate-points-present-"));
  mkdirSync(join(root, "public", "data"), { recursive: true });
  const contents = '{"schemaVersion":"1"}';
  writeFileSync(join(root, "public", "data", "leaderboard.json"), contents);
  const previous = process.cwd();
  process.chdir(root);
  try {
    await expect(
      readLeaderboardSnapshotBytes("public/data/leaderboard.json"),
    ).resolves.toBe(contents);
    // The fixture file on disk is untouched by the read.
    expect(
      readFileSync(join(root, "public", "data", "leaderboard.json"), "utf8"),
    ).toBe(contents);
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown evaluator-award project hints at projects:sync without asserting it is the cause", () => {
  const root = mkdtempSync(join(tmpdir(), "evaluator-unknown-"));
  const fixture = JSON.parse(
    readFileSync(
      "tests/fixtures/history/evaluations/eliza/award-neutize-pr-25803.json",
      "utf8",
    ),
  ) as Record<string, unknown>;
  mkdirSync(join(root, "evaluations", "not-a-real-project-xyz"), {
    recursive: true,
  });
  writeFileSync(
    join(
      root,
      "evaluations",
      "not-a-real-project-xyz",
      "award-unknown-project-test.json",
    ),
    JSON.stringify({ ...fixture, projectId: "not-a-real-project-xyz" }),
  );
  const previous = process.cwd();
  process.chdir(root);
  try {
    expect(() => loadEvaluatorAwardEvents()).toThrow(
      "Unknown evaluator-award project: not-a-real-project-xyz",
    );
    expect(() => loadEvaluatorAwardEvents()).toThrow("projects:sync");
    expect(() => loadEvaluatorAwardEvents()).toThrow("one possible cause");
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing non-leaderboard input is not masked as a leaderboard error", async () => {
  const error = await readLeaderboardSnapshotBytes(
    "cycles/does-not-exist.json",
  ).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toContain(
    "public/data/leaderboard.json is missing",
  );
});
