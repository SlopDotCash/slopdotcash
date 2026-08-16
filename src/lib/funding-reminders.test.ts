import { describe, expect, it } from "vitest";
import { settlementReminder } from "./funding-reminders";

const close = "2026-08-01T00:00:00.000Z";

describe("funding cycle reminders", () => {
  it("publishes the UTC warning and seven-day settler reminder", () => {
    expect(settlementReminder(close, "2026-07-20T00:00:00.000Z")?.kind).toBe(
      "cycle-close",
    );
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
});
