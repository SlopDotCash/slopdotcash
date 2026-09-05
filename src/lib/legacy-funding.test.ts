import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { assertCycleIndex } from "./cycle-index";
import { assertRewardAllocationManifest } from "./rewards";

vi.mock("./projects.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("./projects.mjs")>();
  return {
    ...original,
    findProject(id: Parameters<typeof original.findProject>[0]) {
      const project = original.findProject(id);
      return (
        project && {
          ...project,
          reward: { ...project.reward, monthlyCapMinor: "20000000000" },
        }
      );
    },
  };
});

describe("immutable historical funding basis", () => {
  it("keeps unchanged July proposal and public index valid after a project cap change", async () => {
    const path = "cycles/eliza/2026-07/proposal.json";
    const bytes = await readFile(path);
    const proposal = JSON.parse(bytes.toString("utf8"));
    expect(proposal.capMinor).toBe("10000000000");
    expect(proposal.fundingBasis).toBeUndefined();
    expect(() => assertRewardAllocationManifest(proposal)).not.toThrow();
    const index = JSON.parse(
      await readFile("public/data/cycles/index.json", "utf8"),
    );
    expect(() => assertCycleIndex(index)).not.toThrow();
    expect(await readFile(path)).toEqual(bytes);
  });
});
