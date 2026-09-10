import { describe, expect, it } from "vitest";
import {
  assertAdmissionReceipt,
  assertReservationRunProvenance,
  verifyHistoricalPaymentAdmission,
} from "./payment-admission";

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
    { head_sha: expected.head },
    { conclusion: "failure" },
    { updated_at: "2026-09-10T10:01:00Z" },
    { repository: { full_name: "attacker/fork" } },
  ])("rejects wrong run provenance %j", (change) => {
    expect(() =>
      assertReservationRunProvenance({ ...run, ...change }, expected),
    ).toThrow(/provenance/);
  });
});
