/**
 * Copies the current working tree, without tests/fixtures, into a scratch directory
 * and restores the frozen pre-registry projects and history there. Scripts
 * that read fixed repository paths, such as the cycle index sync, run inside it.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyWorkingTree } from "../scripts/copy-working-tree.mjs";
import { copyFixtureHistory } from "./fixture-overlay.mjs";

const repositoryRoot = resolve(import.meta.dir, "..");

export function fixtureCheckout(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    copyWorkingTree(repositoryRoot, root, ["tests/fixtures"]);
    copyFileSync(
      join(repositoryRoot, "tests/fixtures/project-registry.mjs"),
      join(root, "src/lib/project-registry.generated.mjs"),
    );
    copyFixtureHistory(root);
    symlinkSync(
      join(repositoryRoot, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    mkdirSync(join(root, ".bun-tmp"), { recursive: true });
    return root;
  } catch (error) {
    // A failed setup never returns its path to the caller for cleanup.
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
