/** Non-production trees excluded before following or rejecting directory links. */
export const excludedSourceDirectories = new Set([
  "node_modules",
  "__pycache__",
  "tests",
  "fixtures",
  "integration",
  "target",
  "out",
]);

export function isExcludedSourceDirectory(path) {
  return (
    excludedSourceDirectories.has(path.split("/").at(-1)) ||
    path === "contracts/solana/.local"
  );
}
