// spec/operations/release.md, "Workers publish before the static site, each only when its own release variable is enabled"
import { pathToFileURL } from "node:url";

/** @throws {Error} */
export async function declaredWrites(file: string): Promise<unknown> {
  const loaded: unknown = await import(pathToFileURL(file).href);
  return typeof loaded === "object" && loaded !== null && "writes" in loaded ? loaded.writes : undefined;
}
