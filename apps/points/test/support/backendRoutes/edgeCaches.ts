// spec/backend/listing.md, "A restricted project is closed on every public route and a paused one stays listed"
import type { CacheStorage } from "@repo/platform/bindings";

declare const caches: CacheStorage;

/** @throws {never} */
export function workerCaches(): CacheStorage {
  return caches;
}
