import { afterEach, describe, expect, it, vi } from "vitest";
import { PAYMENT_RESERVATION_CHECK } from "../src/lib/payment-reservations";
import {
  assertAdmissionReceipt,
  assertReservationRunProvenance,
  verifyHistoricalPaymentAdmission,
  verifyReservationAdmissionRuns,
} from "./payment-admission";
import * as receipts from "./payment-admission-receipt";
import * as history from "./payment-reservation-history";

afterEach(() => vi.restoreAllMocks());

const expected = {
  base: "a".repeat(40),
  head: "b".repeat(40),
  number: 1,
  mergedAt: "2026-09-10T10:00:00.000Z",
};
const run = {
  path: ".github/workflows/payment-reservations.yml",
  event: "pull_request_target",
  head_sha: expected.base,
  status: "completed",
  conclusion: "success",
  run_started_at: "2026-09-10T09:00:00Z",
  updated_at: "2026-09-10T09:01:00Z",
  repository: { full_name: "SlopDotCash/slopdotcash" },
};
describe("historical payment admission", () => {
  it("requires an explicitly reviewed bootstrap, not current protection alone", async () => {
    await expect(
      verifyHistoricalPaymentAdmission("/unused", "a".repeat(40), null),
    ).rejects.toThrow(/bootstrap/);
  });
  it("accepts the exact base workflow with a separately bound receipt", () => {
    expect(() => assertReservationRunProvenance(run, expected)).not.toThrow();
    const receipt = {
      base: expected.base,
      head: expected.head,
      number: 1,
      runId: 7,
      attempt: 2,
    };
    expect(() => assertAdmissionReceipt(receipt, receipt)).not.toThrow();
    expect(() =>
      assertAdmissionReceipt({ ...receipt, head: "c".repeat(40) }, receipt),
    ).toThrow(/exact PR/);
    expect(() =>
      assertAdmissionReceipt({ ...receipt, attempt: 1 }, receipt),
    ).toThrow(/exact PR/);
  });
  it.each([
    { path: ".github/workflows/forged.yml" },
    { event: "pull_request" },
    { head_sha: "c".repeat(40) },
    { run_started_at: "invalid" },
    { run_started_at: "2026-09-10T09:02:00Z" },
    { conclusion: "failure" },
    { updated_at: "2026-09-10T10:01:00Z" },
    { repository: { full_name: "attacker/fork" } },
  ])("rejects wrong run provenance %j", (change) => {
    expect(() =>
      assertReservationRunProvenance({ ...run, ...change }, expected),
    ).toThrow(/provenance/);
  });
});

describe("canonical admission run discovery", () => {
  function inventory(mode: "head" | "base", mismatchFirst = false) {
    const matching = {
      ...run,
      id: 7,
      run_attempt: 1,
      head_sha: mode === "head" ? expected.head : expected.base,
    };
    return vi.spyOn(history, "reservationGithub").mockImplementation((path) => {
      if (path.includes("/jobs?"))
        return {
          total_count: 1,
          jobs: [
            {
              name: PAYMENT_RESERVATION_CHECK,
              conclusion: "success",
              completed_at: "2026-09-10T09:01:00Z",
            },
          ],
        };
      const selected = path.includes(`head_sha=${matching.head_sha}&`);
      const runs = selected ? [matching] : [];
      if (mismatchFirst && path.includes(`head_sha=${expected.base}&`))
        runs.unshift({ ...matching, id: 6, head_sha: expected.base });
      return { total_count: runs.length, workflow_runs: runs };
    });
  }
  it.each(["head", "base"] as const)(
    "accepts %s-indexed REST metadata only with an exact receipt",
    (mode) => {
      const lookup = inventory(mode);
      const receipt = vi
        .spyOn(receipts, "verifyReceipt")
        .mockImplementation(() => {});
      expect(() => verifyReservationAdmissionRuns(expected)).not.toThrow();
      expect(lookup).toHaveBeenCalledWith(
        expect.stringContaining(`head_sha=${expected.head}&`),
      );
      expect(lookup).toHaveBeenCalledWith(
        expect.stringContaining(`head_sha=${expected.base}&`),
      );
      expect(receipt).toHaveBeenCalledWith(7, {
        base: expected.base,
        head: expected.head,
        number: expected.number,
        runId: 7,
        attempt: 1,
      });
    },
  );
  it("continues past an unrelated receipt on the same base", () => {
    inventory("head", true);
    const receipt = vi
      .spyOn(receipts, "verifyReceipt")
      .mockImplementation((id) => {
        if (id === 6)
          throw new TypeError(
            "Workflow admission receipt differs from exact PR inputs",
          );
      });
    expect(() => verifyReservationAdmissionRuns(expected)).not.toThrow();
    expect(receipt.mock.calls.map(([id]) => id)).toEqual([6, 7]);
  });
  it("rejects successful runs when every receipt is missing or mismatched", () => {
    inventory("head", true);
    vi.spyOn(receipts, "verifyReceipt").mockImplementation(() => {
      throw new Error("unavailable");
    });
    expect(() => verifyReservationAdmissionRuns(expected)).toThrow(
      /No exact successful/,
    );
  });
  it("rejects an incomplete run inventory even when it contains a successful run", () => {
    vi.spyOn(history, "reservationGithub").mockReturnValue({
      total_count: 101,
      workflow_runs: [run],
    });
    const receipt = vi.spyOn(receipts, "verifyReceipt");
    expect(() => verifyReservationAdmissionRuns(expected)).toThrow(
      /Incomplete/,
    );
    expect(receipt).not.toHaveBeenCalled();
  });
});
