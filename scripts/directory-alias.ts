import { rmdirSync, rmSync } from "node:fs";

/** Remove the fixture link, including a broken junction, without its target. */
export function removeDirectoryAlias(path: string) {
  if (process.platform !== "win32") {
    rmSync(path, { force: true });
    return;
  }
  try {
    rmdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
