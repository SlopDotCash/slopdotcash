import { describe, expect, test } from "bun:test";
import {
  buildCommitMonthlyCalldata,
  type MonthlyAllocationEntry,
} from "./adapter";

const attestation = `0x${"11".repeat(65)}`;
const entry = (index: number): MonthlyAllocationEntry => ({
  githubUserId: String(index + 1),
  grossMicro: "1000000",
  sourceDigest: `0x${(index + 1).toString(16).padStart(64, "0")}`,
});

describe("legacy whole-array monthly gas bound", () => {
  test("accepts the measured maximum historical batch", () => {
    expect(
      buildCommitMonthlyCalldata(
        "2026-11",
        Array.from({ length: 3 }, (_, index) => entry(index)),
        attestation,
      ),
    ).toStartWith("0x");
  });

  test("directs an oversized batch to bounded V2 settlement", () => {
    expect(() =>
      buildCommitMonthlyCalldata(
        "2026-11",
        Array.from({ length: 4 }, (_, index) => entry(index)),
        attestation,
      ),
    ).toThrow(
      "Legacy monthly allocation has 4 awards; the 500,000 gas budget supports at most 3. Use bounded V2 reserve/leaf settlement.",
    );
  });
});
