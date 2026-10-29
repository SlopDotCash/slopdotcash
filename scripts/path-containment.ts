import * as hostPath from "node:path";

type PathApi = Pick<typeof hostPath, "isAbsolute" | "relative" | "sep">;

/**
 * True when `path` is `root` or a path below it. The test uses
 * `path.relative`, so it holds with either separator: a `${root}/` prefix test
 * matches nothing on Windows, where the same paths use `\`.
 */
export function isInsideDirectory(
  root: string,
  path: string,
  paths: PathApi = hostPath,
): boolean {
  const rest = paths.relative(root, path);
  return (
    rest === "" ||
    (rest !== ".." &&
      !rest.startsWith(`..${paths.sep}`) &&
      !paths.isAbsolute(rest))
  );
}
