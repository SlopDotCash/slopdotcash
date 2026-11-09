import { expect, test } from "bun:test";
import {
  allocationFundingMinor,
  assertAllocationFundingBasis,
  deriveAllocationFundingBasis,
} from "../src/lib/allocation-funding";
import { findProject } from "../src/lib/projects.mjs";

function project(fundingState: "pledged" | "committed" = "pledged") {
  const base = findProject("asi");
  if (!base || base.reward.kind !== "monthly-pool") throw new Error("Missing monthly-pool fixture");
  // Exercise the helper's isolation from historical fields; this assembled
  // input is not evidence that the registry would admit a funded manifest.
  return {
    ...base,
    reward: {
      ...base.reward,
      fundingState,
      committedMinor: "90071992547409931234",
      monthlyCapMinor: "90071992547409931235",
      cycleCaps: [{ cycleId: "2026-11", monthlyCapMinor: "0" }],
    },
  };
}
const basis = {
  cycleId: "2026-11",
  instrumentId: null,
  fundingState: "committed",
  committedMinor: "0",
  monthlyCapMinor: "90071992547409931235",
};

test.each(["pledged", "committed"] as const)("current %s basis never treats a manifest commitment as funds", (state) => {
  const input = project(state);
  const result = deriveAllocationFundingBasis(input, "2026-11");
  expect(result).toEqual({
    ...basis, fundingState: state, monthlyCapMinor: "0",
  });
  expect(allocationFundingMinor(result)).toBe(0n);
  expect(input.reward.committedMinor).toBe("90071992547409931234");
});

test("the exact month override does not replace the default cap for another month", () => {
  const input = project();
  expect(deriveAllocationFundingBasis(input, "2026-12").monthlyCapMinor).toBe(input.reward.monthlyCapMinor);
  expect(() => deriveAllocationFundingBasis(input, "2026-13")).toThrow();
});

test.each([
  { ...basis, committedMinor: "1" },
  { ...basis, instrumentId: "legacy-instrument" },
  { ...basis, cycleId: "2026-1" },
  { ...basis, fundingState: "scheduled" },
  { ...basis, monthlyCapMinor: "01" },
  { ...basis, extra: true },
].map((value) => ({ value })))("current basis refuses inadmissible fields: %j", ({ value }) => {
  expect(() => assertAllocationFundingBasis(value)).toThrow();
});

test("legacy amount arithmetic uses exact integers and remains separate from current basis admission", () => {
  const legacy = {
    ...basis,
    committedMinor: "90071992547409931234",
    monthlyCapMinor: "90071992547409931233",
  };
  expect(allocationFundingMinor(legacy)).toBe(90071992547409931233n);
  expect(() => assertAllocationFundingBasis(legacy)).toThrow();
  expect(allocationFundingMinor({ ...legacy, fundingState: "pledged" })).toBe(0n);
  expect(allocationFundingMinor({ ...legacy, committedMinor: "2" })).toBe(2n);
});

test.each(["01", "-1", "1.5", "1e3", "", "340282366920938463463374607431768211456"])(
  "legacy arithmetic also refuses noncanonical or out-of-range money: %s", (value) => {
    expect(() => allocationFundingMinor({ ...basis, committedMinor: value })).toThrow();
    expect(() => allocationFundingMinor({ ...basis, fundingState: "pledged", monthlyCapMinor: value })).toThrow();
  },
);

test("amount projection reads only its three fields while basis validation retains exact keys", () => {
  const supplied = { ...basis, cycleId: "not-a-cycle", instrumentId: "not-an-authority", extra: "ignored metadata" };
  expect(allocationFundingMinor(supplied)).toBe(0n);
  expect(() => assertAllocationFundingBasis(supplied)).toThrow();
});

test("returned basis values capture a cap without mutating the project or aliasing the input", () => {
  const input = project();
  const result = deriveAllocationFundingBasis(input, "2026-12");
  const originalCap = result.monthlyCapMinor;
  input.reward.monthlyCapMinor = "3";
  expect(result.monthlyCapMinor).toBe(originalCap);
  const copy = assertAllocationFundingBasis(result);
  expect(copy).not.toBe(result);
  copy.monthlyCapMinor = "4";
  expect(result.monthlyCapMinor).toBe(originalCap);
});
