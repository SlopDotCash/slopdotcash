/** Proves month-close selection, idempotency, and partial-cycle refusal. */

import { describe, expect, it, vi } from "vitest";
import { PROJECTS } from "../src/lib/projects.mjs";
import {
  prepareMonthlyRewards,
  previousUtcCycleId,
} from "./prepare-monthly-rewards";

describe("monthly reward close", () => {
  const activeProjects = PROJECTS.map((project) => ({
    ...project,
    status: "active" as const,
  }));

  it("selects the previous UTC month across a year boundary", () => {
    expect(previousUtcCycleId(new Date("2027-01-01T00:11:00.000Z"))).toBe(
      "2026-12",
    );
  });

  it("prepares every active launched project once", async () => {
    const prepare = vi.fn().mockResolvedValue({});
    const validateCycles = vi.fn().mockResolvedValue({});
    const result = await prepareMonthlyRewards(
      {
        cycleId: "2026-07",
        generatedAt: "2026-08-01T00:11:00.000Z",
        snapshotPath: "/tmp/monthly-snapshot.json",
      },
      {
        inspectPath: vi.fn().mockResolvedValue("missing"),
        prepare,
        projects: activeProjects,
        validateCycles,
      },
    );

    expect(result.prepared).toEqual(["eliza", "delta-star"]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(validateCycles).toHaveBeenCalledOnce();
  });

  it("leaves complete existing cycles untouched and rejects partial state", async () => {
    const result = await prepareMonthlyRewards(
      {
        cycleId: "2026-07",
        generatedAt: "2026-08-01T00:11:00.000Z",
      },
      {
        inspectPath: vi.fn().mockResolvedValue("file"),
        prepare: vi.fn(),
        projects: activeProjects,
        validateCycles: vi.fn().mockResolvedValue({}),
      },
    );
    expect(result.skippedExisting).toEqual(["eliza", "delta-star"]);

    let call = 0;
    await expect(
      prepareMonthlyRewards(
        {
          cycleId: "2026-07",
          generatedAt: "2026-08-01T00:11:00.000Z",
        },
        {
          inspectPath: vi.fn().mockImplementation(async () => {
            call += 1;
            return call % 2 === 1 ? "file" : "missing";
          }),
          prepare: vi.fn(),
          projects: activeProjects,
          validateCycles: vi.fn(),
        },
      ),
    ).rejects.toThrow(/partial/u);
  });

  it("refuses a cycle that has not closed", async () => {
    await expect(
      prepareMonthlyRewards({
        cycleId: "2026-08",
        generatedAt: "2026-08-31T23:59:59.999Z",
      }),
    ).rejects.toThrow(/has not closed/u);
  });
});
