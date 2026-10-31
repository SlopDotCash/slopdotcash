// allocateIntegerTotal must fail loudly on weights it cannot represent,
// instead of silently misallocating the pool (negative weight) or crashing
// inside BigInt (fractional weight). Sibling allocator
// allocateReviewBudgetMinor already throws TypeError for the same shape.
import { describe, expect, test } from "bun:test";
import { allocateIntegerTotal } from "../src/lib/project-view";

const actor = (id: string, weight: number) =>
  ({
    actor: { id, login: id, kind: "User", avatarUrl: "" },
    adjustedWeight: weight,
  }) as never;

describe("allocateIntegerTotal weight validation", () => {
  test("rejects a negative weight instead of paying a negative share", () => {
    expect(() =>
      allocateIntegerTotal(100n, [actor("1", -5), actor("2", 10)]),
    ).toThrow(TypeError);
  });

  test("rejects a fractional weight instead of a BigInt RangeError", () => {
    expect(() =>
      allocateIntegerTotal(100n, [actor("1", 1.5), actor("2", 10)]),
    ).toThrow(TypeError);
  });

  test("rejects a non-finite weight", () => {
    expect(() =>
      allocateIntegerTotal(100n, [actor("1", Number.NaN), actor("2", 10)]),
    ).toThrow(TypeError);
  });

  test("keeps exact largest-remainder output for valid weights", () => {
    const allocations = allocateIntegerTotal(1000000n, [
      actor("1", 0),
      actor("2", 5),
      actor("3", 0),
      actor("4", 5),
    ]);
    expect(allocations.get("1")).toBe(0n);
    expect(allocations.get("2")).toBe(500000n);
    expect(allocations.get("3")).toBe(0n);
    expect(allocations.get("4")).toBe(500000n);
  });

  test("keeps the all-zero-weight result unchanged", () => {
    const allocations = allocateIntegerTotal(100n, [
      actor("1", 0),
      actor("2", 0),
    ]);
    expect(allocations.get("1")).toBe(0n);
    expect(allocations.get("2")).toBe(0n);
  });
});
