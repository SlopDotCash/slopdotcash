export interface RegistryDatabase {
  database_name: string;
  database_id: string;
}
export function parseRegistryDatabase(toml: string): RegistryDatabase;
export function readRegistryDatabase(
  file?: "wrangler.toml" | "wrangler.staging.toml",
): Promise<RegistryDatabase>;
export function parseMonthlySchedule(toml: string): string;
export function readMonthlySchedule(
  file?: "wrangler.toml" | "wrangler.staging.toml",
): Promise<string>;
