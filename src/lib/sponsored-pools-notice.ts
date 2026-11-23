// Time-boxed home page notice for the sponsored pools round (operator
// decision, 23 November 2026). It stops rendering on its own at
// SPONSORED_POOLS_NOTICE_ENDS, so removing it needs no release.

export const SPONSORED_POOLS_NOTICE_ENDS = Date.parse("2026-12-08T00:00:00Z");
export const SPONSORED_POOLS_NOTICE_KEY = "slop:notice:sponsored-pools-2026";
export const SPONSORED_POOLS_URL = "https://record.slop.cash/sponsored-pools";

export function sponsoredPoolsNoticeActive(now: number): boolean {
  return Number.isFinite(now) && now < SPONSORED_POOLS_NOTICE_ENDS;
}

type NoticeStore = Pick<Storage, "getItem" | "setItem">;

export function noticeDismissed(store: NoticeStore | undefined): boolean {
  try {
    return store?.getItem(SPONSORED_POOLS_NOTICE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissNotice(store: NoticeStore | undefined): void {
  try {
    store?.setItem(SPONSORED_POOLS_NOTICE_KEY, "dismissed");
  } catch {
    // Storage can be blocked; the notice then closes for this visit only.
  }
}
