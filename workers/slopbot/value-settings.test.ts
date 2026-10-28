import { describe, expect, test } from "bun:test";
import {
  historicalSubscriptionSource,
  VALUE_API_START_AT,
  valueSettings,
} from "./value-settings";

describe("subscription intake window", () => {
  test("accepts work merged or closed before the API start", () => {
    expect(
      historicalSubscriptionSource({
        merged_at: "2026-10-31T23:59:59Z",
        closed_at: "2026-10-31T23:59:59Z",
      }),
    ).toBe(true);
    expect(
      historicalSubscriptionSource({
        merged_at: null,
        closed_at: "2026-09-02T00:00:00Z",
      }),
    ).toBe(true);
  });

  test("refuses work the paid API route owns", () => {
    expect(
      historicalSubscriptionSource({
        merged_at: VALUE_API_START_AT,
        closed_at: VALUE_API_START_AT,
      }),
    ).toBe(false);
    expect(
      historicalSubscriptionSource({
        merged_at: null,
        closed_at: "2026-11-02T00:00:00Z",
      }),
    ).toBe(false);
  });

  test("refuses open or undated work", () => {
    expect(
      historicalSubscriptionSource({ merged_at: null, closed_at: null }),
    ).toBe(false);
    expect(
      historicalSubscriptionSource({
        merged_at: "not a date",
        closed_at: null,
      }),
    ).toBe(false);
  });

  test("the API route never starts before the subscription window ends", () => {
    const settings = valueSettings({
      SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
    });
    expect(settings?.start).toBe(Date.parse(VALUE_API_START_AT));
    expect(
      valueSettings({
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
        SLOPBOT_VALUE_START_AT: "2026-10-31T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
