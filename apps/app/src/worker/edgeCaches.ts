// spec/frontend/requests.md, "Story: Read current data without losing the last good result"
import type { CacheStorage } from "@repo/platform/bindings";

declare const caches: CacheStorage;

/** @throws {never} */
export function workerCaches(): CacheStorage {
  return caches;
}
