// Test and local-harness D1 stand-in: the shared bun:sqlite shim with every
// migration applied.
import type { Database } from "bun:sqlite";
import { MIGRATIONS, sqliteD1 as shared } from "../../tests/sqlite-d1";
import type { ReferralD1Database } from "./store";

export function sqliteD1(
  filename = ":memory:",
  migrate = true,
): { db: ReferralD1Database; sqlite: Database } {
  const { db, sqlite } = shared(migrate ? MIGRATIONS : [], filename);
  // Shared statements also implement all().
  return { db: db as unknown as ReferralD1Database, sqlite };
}
