import { describe, expect, it } from "vitest";
import {
  cycleSettlementReminder,
  settlementReminder,
} from "./funding-reminders";

const close = "2026-08-01T00:00:00.000Z";

describe("funding cycle reminders", () => {
  it("publishes the UTC warning and seven-day settler reminder", () => {
    expect(settlementReminder(close, "2026-07-20T00:00:00.000Z")).toBeNull();
    expect(settlementReminder(close, "2026-07-25T00:00:00.000Z")?.kind).toBe(
      "settler-seven-day",
    );
  });

  it("moves from cycle close to ready-to-sign and overdue deterministically", () => {
    expect(settlementReminder(close, "2026-08-01T12:00:00.000Z")?.kind).toBe(
      "cycle-close",
    );
    expect(settlementReminder(close, "2026-08-02T00:00:00.000Z")?.kind).toBe(
      "ready-to-sign",
    );
    expect(settlementReminder(close, "2026-08-04T00:00:00.001Z")?.kind).toBe(
      "overdue",
    );
    expect(
      settlementReminder(
        close,
        "2026-08-04T00:00:00.001Z",
        "2026-08-03T00:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("never emits settlement instructions for non-settlement lifecycles", () => {
    const reminder = (
      kind: "external-prize-share" | "monthly-pool",
      state: "closed-no-awards" | "external-provisional" | "paid",
    ) =>
      cycleSettlementReminder({
        closesAt: close,
        kind,
        now: "2026-08-05T00:00:00.000Z",
        paymentMode: "enabled",
        fundingState: "committed",
        settledAt: null,
        state,
      });
    expect(reminder("monthly-pool", "closed-no-awards")).toBeNull();
    expect(reminder("external-prize-share", "external-provisional")).toBeNull();
    expect(reminder("monthly-pool", "paid")).toBeNull();
    expect(
      cycleSettlementReminder({
        closesAt: close,
        kind: "monthly-pool",
        now: "2026-08-05T00:00:00.000Z",
        paymentMode: "enabled",
        fundingState: "committed",
        settledAt: null,
        state: "payment-ready",
      })?.kind,
    ).toBe("overdue");
  });

  it("replaces settler deadlines with the unfunded state while payments are disabled", () => {
    const unfunded = (now: string) =>
      cycleSettlementReminder({
        closesAt: close,
        kind: "monthly-pool",
        now,
        paymentMode: "disabled",
        fundingState: "pledged",
        settledAt: null,
        state: "review",
      });
    expect(unfunded("2026-07-20T00:00:00.000Z")).toBeNull();
    expect(unfunded("2026-07-25T00:00:00.000Z")?.kind).toBe("unfunded");
    expect(unfunded("2026-08-05T00:00:00.000Z")?.kind).toBe("unfunded");
    expect(unfunded("2026-08-05T00:00:00.000Z")?.message).toMatch(
      /remain projected/u,
    );
    expect(
      cycleSettlementReminder({
        closesAt: close,
        kind: "monthly-pool",
        now: "2026-08-05T00:00:00.000Z",
        paymentMode: "disabled",
        fundingState: "pledged",
        settledAt: "2026-08-03T00:00:00.000Z",
        state: "review",
      }),
    ).toBeNull();
  });

  it("rejects malformed settlement timestamps instead of hiding reminders", () => {
    expect(() =>
      settlementReminder(close, "2026-08-02T00:00:00.000Z", "not-a-date"),
    ).toThrow(/timestamps are invalid/u);
  });

  it("keeps committed disabled funds constrained without calling them unfunded or payable", () => {
    for (const now of [
      "2026-07-25T00:00:00.000Z",
      "2026-08-05T00:00:00.000Z",
    ]) {
      const reminder = cycleSettlementReminder({
        closesAt: close,
        kind: "monthly-pool",
        now,
        paymentMode: "disabled",
        fundingState: "committed",
        settledAt: null,
        state: "review",
      });
      expect(reminder?.kind).toBe("accessibility-unknown");
      expect(reminder?.message).toMatch(/funds remain constrained/u);
      expect(reminder?.message).toMatch(
        /accessibility and payability are not proven/u,
      );
      expect(reminder?.message).not.toMatch(
        /unfunded|no funding is committed|ready.to.sign|overdue|begin once/u,
      );
    }
  });
});
