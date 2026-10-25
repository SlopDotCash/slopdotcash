import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  assertAllocationChange,
  buildExecutionSnapshot,
  currentAllocations,
  monthlyCutoff,
  PRD_MONTHLY_SCHEDULE,
  parseMonthlySchedule,
} from "./monthly-allocation";

const rows = [
  {
    githubUserId: "20",
    login: "b",
    grossBase: "600",
    sourceDigest: "b".repeat(64),
  },
  {
    githubUserId: "10",
    login: "a",
    grossBase: "399",
    sourceDigest: "a".repeat(64),
  },
];

describe("monthly schedule", () => {
  test("an unset schedule keeps the automatic process off; a malformed one fails loudly", () => {
    expect(parseMonthlySchedule(undefined)).toBeNull();
    expect(parseMonthlySchedule("")).toBeNull();
    for (const value of [
      "{}",
      '{"firstPeriod":"2026-13","cutoffSecondsAfterPeriodEnd":60}',
      '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":0}',
      '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":1.5}',
      '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":60,"extra":1}',
      "not json",
    ])
      expect(() => parseMonthlySchedule(value)).toThrow(
        "MONTHLY_PAYMENT_SCHEDULE",
      );
  });

  test("the cutoff counts from 00:00 UTC on the next 1st and never precedes the first period", () => {
    const schedule = parseMonthlySchedule(
      '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":7200}',
    );
    if (!schedule) throw new Error("schedule expected");
    expect(monthlyCutoff(schedule, "2026-10")).toBeNull();
    expect(monthlyCutoff(schedule, "2026-12")?.toISOString()).toBe(
      "2027-01-01T02:00:00.000Z",
    );
  });

  test("public pages describe the same schedule that production and staging configure", () => {
    for (const file of ["wrangler.toml", "wrangler.staging.toml"]) {
      const { vars } = Bun.TOML.parse(readFileSync(file, "utf8")) as {
        vars: Record<string, string>;
      };
      expect(parseMonthlySchedule(vars.MONTHLY_PAYMENT_SCHEDULE)).toEqual({
        ...PRD_MONTHLY_SCHEDULE,
      });
    }
    expect(monthlyCutoff(PRD_MONTHLY_SCHEDULE, "2026-10")).toBeNull();
    expect(monthlyCutoff(PRD_MONTHLY_SCHEDULE, "2026-11")?.toISOString()).toBe(
      "2026-12-04T00:00:00.000Z",
    );
  });
});

describe("private allocation changes", () => {
  test("the newest change per recipient is current, in sequence order", () => {
    const current = currentAllocations(rows, [
      { sequence: 2, githubUserId: "20", grossBase: "100" },
      { sequence: 1, githubUserId: "20", grossBase: "700" },
    ]);
    expect(
      current.map((row) => [
        row.githubUserId,
        row.grossBase,
        row.proposedGrossBase,
      ]),
    ).toEqual([
      ["10", "399", "399"],
      ["20", "100", "600"],
    ]);
  });

  test("a change cannot raise the month above its cap, pay its own author or name a stranger", () => {
    const current = currentAllocations(rows, []);
    expect(() =>
      assertAllocationChange(current, "1000", {
        githubUserId: "20",
        grossBase: "601",
        actorId: "1",
      }),
    ).not.toThrow();
    expect(() =>
      assertAllocationChange(current, "1000", {
        githubUserId: "20",
        grossBase: "602",
        actorId: "1",
      }),
    ).toThrow("exceed its monthly amount");
    expect(() =>
      assertAllocationChange(current, "1000", {
        githubUserId: "20",
        grossBase: "1",
        actorId: "20",
      }),
    ).toThrow("your own allocation");
    expect(() =>
      assertAllocationChange(current, "1000", {
        githubUserId: "30",
        grossBase: "1",
        actorId: "1",
      }),
    ).toThrow("no allocation");
    for (const grossBase of ["-1", "1.5", "01", "18446744073709551616"])
      expect(() =>
        assertAllocationChange(current, "18446744073709551615", {
          githubUserId: "10",
          grossBase,
          actorId: "1",
        }),
      ).toThrow();
  });
});

describe("execution snapshot", () => {
  const base = {
    projectId: "eliza",
    period: "2026-11",
    manifestSha256: "c".repeat(64),
    sourceSnapshotSha256: "d".repeat(64),
    capBase: "1000",
  };
  const freeze = (allocations: ReturnType<typeof currentAllocations>) =>
    buildExecutionSnapshot({
      base,
      allocations,
      allocationSequence: 1,
      trigger: "automatic",
      manifestSha256: "e".repeat(64),
      network: "base-sepolia",
      vault: `0x${"1".repeat(40)}`,
      asset: `0x${"2".repeat(40)}`,
      frozenAt: "2026-12-02T00:00:00.000Z",
    });

  test("zero awards are left out and each fee is ceil(gross / 50)", () => {
    const { snapshot, sha256, text } = freeze(
      currentAllocations(rows, [
        { sequence: 1, githubUserId: "20", grossBase: "0" },
      ]),
    );
    expect(snapshot.awards).toEqual([
      {
        githubUserId: "10",
        login: "a",
        grossBase: "399",
        feeBase: "8",
        netBase: "391",
        sourceDigest: "a".repeat(64),
      },
    ]);
    expect(snapshot.totalGrossBase).toBe("399");
    // The same allocations always freeze to the same bytes.
    expect(
      freeze(
        currentAllocations(rows, [
          { sequence: 1, githubUserId: "20", grossBase: "0" },
        ]),
      ).sha256,
    ).toBe(sha256);
    expect(JSON.parse(text)).toEqual(snapshot);
  });

  test("allocations above the cap never freeze", () => {
    expect(() =>
      freeze(
        currentAllocations(rows, [
          { sequence: 1, githubUserId: "10", grossBase: "401" },
        ]),
      ),
    ).toThrow("exceed its monthly amount");
  });
});
