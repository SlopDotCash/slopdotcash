// spec/frontend/projectDrafts.md, "The legacy setup draft is imported once and the store falls back to memory when storage or locks are unavailable"

export type StorageArea = "session" | "local";

/** @throws {never} */
export function webStorage(area: StorageArea): Storage | undefined {
  try {
    if (area === "session") return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
