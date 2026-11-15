/** The fixed merge sandbox reads only server-selected immutable regular files. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  VALUE_FILE_EXPANSION_LIMIT,
  type ValueFileRecovery,
  type ValueFileRequest,
  validValueFileRequest,
} from "../workers/slopbot/value-file-recovery";

export function recoverValueFiles(
  repository: string,
  requests: readonly ValueFileRequest[],
): ValueFileRecovery {
  const git = (args: string[], maxBuffer = 8 * 1024 * 1024) =>
    execFileSync("git", ["--git-dir", repository, ...args], {
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        GIT_OPTIONAL_LOCKS: "0",
        LC_ALL: "C",
      },
      maxBuffer,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  const entries: ValueFileRecovery["entries"] = [];
  const blobs = new Map<string, ValueFileRecovery["blobs"][number] | null>();
  const trees = new Map<
    string,
    { sha: string; files: Map<string, { mode: string; sha: string }> }
  >();
  let expanded = 0;
  for (const request of requests) {
    if (!validValueFileRequest(request))
      throw new Error("Invalid recovery selection");
    let tree = trees.get(request.ref);
    if (!tree) {
      const sha = git(["rev-parse", `${request.ref}^{tree}`])
        .toString("utf8")
        .trim();
      if (!/^[a-f0-9]{40}$/u.test(sha))
        throw new Error("Invalid recovery tree");
      const bytes = git(["ls-tree", "-r", "-z", "--full-tree", request.ref]);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const rows = text.split("\0");
      if (rows.pop() !== "") throw new Error("Incomplete recovery tree");
      const files = new Map<string, { mode: string; sha: string }>();
      for (const row of rows) {
        const match =
          /^([0-7]{6}) (?:blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/u.exec(row);
        if (!match || files.has(match[3]))
          throw new Error("Invalid recovery tree entry");
        files.set(match[3], { mode: match[1], sha: match[2] });
      }
      tree = { sha, files };
      trees.set(request.ref, tree);
    }
    const file = tree.files.get(request.path);
    let blob =
      file && ["100644", "100755"].includes(file.mode)
        ? blobs.get(file.sha)
        : null;
    if (
      file &&
      ["100644", "100755"].includes(file.mode) &&
      blob === undefined
    ) {
      const size = Number(
        git(["cat-file", "-s", file.sha]).toString("utf8").trim(),
      );
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > VALUE_FILE_EXPANSION_LIMIT - expanded
      )
        throw new Error("Recovery expansion exceeds limit");
      const bytes = git(
        ["cat-file", "blob", file.sha],
        VALUE_FILE_EXPANSION_LIMIT,
      );
      if (
        bytes.length !== size ||
        createHash("sha1")
          .update(`blob ${size}\0`)
          .update(bytes)
          .digest("hex") !== file.sha
      )
        throw new Error("Recovery blob changed");
      expanded += bytes.length;
      try {
        const text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        blob = text.includes("\0")
          ? null
          : {
              sha: file.sha,
              sha256: createHash("sha256").update(bytes).digest("hex"),
              size,
              gzipBase64: gzipSync(bytes).toString("base64"),
            };
      } catch {
        blob = null;
      }
      blobs.set(file.sha, blob);
    }
    // Absent, nonregular and binary paths remain unavailable to text recovery.
    entries.push({
      ...request,
      treeSha: tree.sha,
      mode: blob && file ? (file.mode as "100644" | "100755") : null,
      blobSha: blob?.sha ?? null,
    });
  }
  return {
    inputSha256: createHash("sha256")
      .update(JSON.stringify(requests))
      .digest("hex"),
    entries,
    blobs: [...blobs.values()].filter(
      (blob): blob is NonNullable<typeof blob> => blob !== null,
    ),
  };
}
