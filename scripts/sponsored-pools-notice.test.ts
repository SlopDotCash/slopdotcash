import { describe, expect, test } from "bun:test";
import {
  dismissNotice,
  noticeDismissed,
  SPONSORED_POOLS_NOTICE_KEY,
  sponsoredPoolsNoticeActive,
} from "../src/lib/sponsored-pools-notice";

describe("sponsored pools notice", () => {
  test("shows through 7 December 2026 UTC and stops on the 8th", () => {
    expect(sponsoredPoolsNoticeActive(Date.parse("2026-11-23T12:00:00Z"))).toBe(
      true,
    );
    expect(sponsoredPoolsNoticeActive(Date.parse("2026-12-07T23:59:59Z"))).toBe(
      true,
    );
    expect(sponsoredPoolsNoticeActive(Date.parse("2026-12-08T00:00:00Z"))).toBe(
      false,
    );
    expect(sponsoredPoolsNoticeActive(Number.NaN)).toBe(false);
  });

  test("dismissal is remembered and blocked storage never throws", () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(noticeDismissed(store)).toBe(false);
    dismissNotice(store);
    expect(values.get(SPONSORED_POOLS_NOTICE_KEY)).toBe("dismissed");
    expect(noticeDismissed(store)).toBe(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(noticeDismissed(blocked)).toBe(false);
    expect(() => dismissNotice(blocked)).not.toThrow();
    expect(noticeDismissed(undefined)).toBe(false);
  });
});
