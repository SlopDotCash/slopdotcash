import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Compare exact source bytes without starting a Git process for every file. */
export function skillSourceMatchesCommit(root, revision, sourcePath, paths) {
  const records = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", revision, "--", sourcePath],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((record) => {
      const tab = record.indexOf("\t");
      const [, type, oid] = record.slice(0, tab).split(" ");
      if (tab < 0 || type !== "blob" || !/^[a-f0-9]{40}$/u.test(oid))
        throw new TypeError("Invalid committed skill tree");
      return {
        path: relative(sourcePath, record.slice(tab + 1)).replaceAll("\\", "/"),
        oid,
      };
    })
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (
    records.length !== paths.length ||
    records.some((record, index) => record.path !== paths[index])
  )
    return false;
  if (!records.length) return false;
  // Object IDs avoid the line-oriented batch protocol interpreting source paths.
  const output = execFileSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: `${records.map((record) => record.oid).join("\n")}\n`,
    maxBuffer: records.length * (16 * 1024 * 1024 + 128),
  });
  let offset = 0;
  for (const record of records) {
    const end = output.indexOf(10, offset);
    const header = output.toString("ascii", offset, end);
    const match = /^([a-f0-9]{40}) blob (\d+)$/u.exec(header);
    if (!match || match[1] !== record.oid)
      throw new TypeError("Invalid committed skill blob header");
    const size = Number(match[2]);
    const start = end + 1;
    const next = start + size;
    if (
      !Number.isSafeInteger(size) ||
      size > 16 * 1024 * 1024 ||
      output[next] !== 10
    )
      throw new TypeError("Invalid committed skill blob size");
    if (
      !readFileSync(join(root, sourcePath, record.path)).equals(
        output.subarray(start, next),
      )
    )
      return false;
    offset = next + 1;
  }
  if (offset !== output.length)
    throw new TypeError("Unexpected committed skill blob output");
  return true;
}
