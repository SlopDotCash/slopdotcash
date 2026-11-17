// spec/settlement/vaultSnapshots.md, "A failed refresh keeps the last totals marked stale"

/** Whether the page is in a hidden tab, where a due refresh waits for the reader to return. @throws {never} */
export function pageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}
