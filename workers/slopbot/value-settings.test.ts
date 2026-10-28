import { describe, expect, test } from "bun:test";
import {
  historicalSubscriptionSource,
  subscriptionCutoff,
  VALUE_API_START_AT,
  valueSettings,
} from "./value-settings";

const start = Date.parse(VALUE_API_START_AT);
const closed = (merged_at: string | null, closed_at: string | null) => ({
  state: "closed",
  merged_at,
  closed_at,
});

describe("subscription intake window", () => {
  test("accepts work merged or closed before the API start", () => {
    expect(
      historicalSubscriptionSource(
        closed("2026-10-31T23:59:59Z", "2026-10-31T23:59:59Z"),
        start,
      ),
    ).toBe(true);
    expect(
      historicalSubscriptionSource(closed(null, "2026-09-02T00:00:00Z"), start),
    ).toBe(true);
  });

  test("refuses work the paid API route owns", () => {
    expect(
      historicalSubscriptionSource(
        closed(VALUE_API_START_AT, VALUE_API_START_AT),
        start,
      ),
    ).toBe(false);
    expect(
      historicalSubscriptionSource(closed(null, "2026-11-02T00:00:00Z"), start),
    ).toBe(false);
  });

  test("refuses open, reopened or undated work", () => {
    expect(historicalSubscriptionSource(closed(null, null), start)).toBe(false);
    expect(
      historicalSubscriptionSource(closed("not a date", null), start),
    ).toBe(false);
    expect(
      historicalSubscriptionSource(
        { state: "open", merged_at: null, closed_at: "2026-10-01T00:00:00Z" },
        start,
      ),
    ).toBe(false);
  });

  test("the cutoff follows the consumer's configured start", () => {
    expect(subscriptionCutoff({})).toBe(start);
    expect(
      subscriptionCutoff({
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
      }),
    ).toBe(start);
    const delayed = {
      SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
      SLOPBOT_VALUE_START_AT: "2026-12-01T00:00:00.000Z",
    };
    const cutoff = subscriptionCutoff(delayed);
    expect(cutoff).toBe(valueSettings(delayed)?.start as number);
    expect(
      historicalSubscriptionSource(
        closed("2026-11-15T00:00:00Z", null),
        cutoff,
      ),
    ).toBe(true);
    expect(
      historicalSubscriptionSource(
        closed("2026-12-01T00:00:00Z", null),
        cutoff,
      ),
    ).toBe(false);
  });

  test("the API route never starts before the subscription window ends", () => {
    const settings = valueSettings({
      SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
    });
    expect(settings?.start).toBe(start);
    expect(
      valueSettings({
        SLOPBOT_VALUE_MONTHLY_BUDGET_MICRO_USD: "alerts-only",
        SLOPBOT_VALUE_START_AT: "2026-10-31T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
