// spec/frontend/projectDrafts.md, "A project setup draft belongs to one live document slot that a duplicated tab cannot take"
import type { LockManagerLike } from "vibelang-runtime/experimental/Locks";

/** @throws {never} */
export function lockManager(): LockManagerLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const manager: LockManager | undefined = navigator.locks;
  return manager;
}
