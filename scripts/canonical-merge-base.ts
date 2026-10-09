/** Preserve accepted develop history across the reviewed main branch bootstrap. */
import { spawnSync } from "node:child_process";

// Both main and development were created at this reviewed develop revision.
// Later develop merges have no canonical authority until promoted into main.
const MAIN_BOOTSTRAP = "2b1ec5089d03d2b6413ce5475cbccaab63005daf";
export function hasCanonicalMergeBase(
  root: string,
  merge: string,
  base: string | undefined,
): boolean {
  if (base === "main") return true;
  if (base !== "develop") return false;
  const result = spawnSync(
    "git",
    [
      "--no-replace-objects",
      "merge-base",
      "--is-ancestor",
      merge,
      MAIN_BOOTSTRAP,
    ],
    { cwd: root, stdio: "ignore" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1)
    throw new Error("Cannot verify the pre-migration canonical merge history");
  return result.status === 0;
}
