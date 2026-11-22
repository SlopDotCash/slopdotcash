// spec/operations/release.md, "Every required check binds the same source and built artifact"
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const repoRoot = resolve(import.meta.dirname, "../../../..");
export const migrationsDir = join(repoRoot, "migrations");
export const frozenManifest = join(repoRoot, "frozen.json");

/** The number of migration files migrate() applies. */
export function migrationCount(): number {
  return readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).length;
}
