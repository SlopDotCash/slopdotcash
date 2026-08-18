import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPublishableLeaderboardSnapshot } from "../src/lib/leaderboard";
import { snapshotFixture } from "../tests/fixtures";
import { preparePrLedger } from "./prepare-pr-ledger";

describe("pull-request ledger compatibility", () => {
  it("passes an already-current deployed ledger through validation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-pr-ledger-"));
    try {
      const inputPath = join(directory, "input.json");
      const outputPath = join(directory, "output.json");
      await writeFile(inputPath, JSON.stringify(snapshotFixture()));
      await preparePrLedger(inputPath, outputPath);
      const output = JSON.parse(await readFile(outputPath, "utf8"));
      expect(output.schemaVersion).toBe("5");
      assertPublishableLeaderboardSnapshot(output);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("conservatively adapts deployed schema 6 to the validated schema 5 contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-pr-ledger-"));
    try {
      const inputPath = join(directory, "input.json");
      const outputPath = join(directory, "output.json");
      const input = structuredClone(snapshotFixture()) as unknown as Record<
        string,
        unknown
      >;
      input.schemaVersion = "6";
      await writeFile(inputPath, JSON.stringify(input));

      await preparePrLedger(inputPath, outputPath);
      const output = JSON.parse(await readFile(outputPath, "utf8"));
      expect(output.schemaVersion).toBe("5");
      expect(output.ruleVersion).toBe("slop-score-v1");
      expect(
        output.ledger.every(
          (event: { category: string }) =>
            event.category === "merged-pull-request" ||
            event.category === "evaluated-contribution",
        ),
      ).toBe(true);
      assertPublishableLeaderboardSnapshot(output);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects an unexpected deployed schema before writing output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "slop-pr-ledger-"));
    try {
      const inputPath = join(directory, "input.json");
      const outputPath = join(directory, "output.json");
      const input = structuredClone(snapshotFixture()) as unknown as Record<
        string,
        unknown
      >;
      input.schemaVersion = "7";
      await writeFile(inputPath, JSON.stringify(input));
      await expect(preparePrLedger(inputPath, outputPath)).rejects.toThrow(
        /must use schema 5 or 6/u,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
