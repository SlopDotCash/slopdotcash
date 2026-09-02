/** Proves month-close selection, idempotency, and partial-cycle refusal. */

import { describe, expect, it, vi } from "vitest";
import { PROJECTS } from "../src/lib/projects.mjs";
import {
  prepareMonthlyRewards,
  previousUtcCycleId,
} from "./prepare-monthly-rewards";
import { PriorCycleNotReadyError } from "./prior-cycle-accrual";

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

  it("keeps active honor-system projects out of reward cycles", async () => {
    const heir = PROJECTS.find((project) => project.id === "heir-elements-sdk");
    if (!heir) throw new Error("Heir Elements SDK fixture is missing");
    const openHeir = { ...heir, status: "active" as const };
    const prepare = vi.fn();
    const result = await prepareMonthlyRewards(
      {
        cycleId: "2026-09",
        generatedAt: "2026-10-01T00:11:00.000Z",
      },
      {
        inspectPath: vi.fn().mockResolvedValue("missing"),
        prepare,
        projects: [openHeir],
        validateCycles: vi.fn(),
      },
    );

    expect(result.prepared).toEqual([]);
    expect(result.skippedPrelaunch).toEqual(["heir-elements-sdk"]);
    expect(prepare).not.toHaveBeenCalled();
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

  it.each([
    ["under-review" as const, "is still under review"],
    ["unresolved-proposals" as const, "has unresolved proposals"],
  ])(
    "records an %s prior-cycle refusal and prepares unaffected projects",
    async (reason, message) => {
      const prepare = vi.fn().mockImplementation(async (arguments_) => {
        if (arguments_.projectId === "eliza") {
          throw new PriorCycleNotReadyError({
            cycleId: "2026-07",
            message: `Prior cycle eliza/2026-07 ${message}`,
            projectId: "eliza",
            reason,
          });
        }
      });
      const validateCycles = vi.fn().mockResolvedValue({});

      const result = await prepareMonthlyRewards(
        {
          cycleId: "2026-08",
          generatedAt: "2026-09-05T00:11:00.000Z",
        },
        {
          inspectPath: vi.fn().mockResolvedValue("missing"),
          prepare,
          projects: activeProjects,
          validateCycles,
        },
      );

      expect(result.prepared).toEqual(["asi", "delta-star"]);
      expect(result.refused).toEqual([
        {
          projectId: "eliza",
          priorCycleId: "2026-07",
          reason,
          message: `Prior cycle eliza/2026-07 ${message}`,
        },
      ]);
      expect(prepare).toHaveBeenCalledTimes(3);
      expect(validateCycles).toHaveBeenCalledOnce();
    },
  );

  it("keeps unrelated project preparation failures fatal", async () => {
    await expect(
      prepareMonthlyRewards(
        {
          cycleId: "2026-08",
          generatedAt: "2026-09-05T00:11:00.000Z",
        },
        {
          inspectPath: vi.fn().mockResolvedValue("missing"),
          prepare: vi.fn().mockRejectedValue(new Error("snapshot invalid")),
          projects: activeProjects,
          validateCycles: vi.fn(),
        },
      ),
    ).rejects.toThrow("snapshot invalid");
  });
});
