/** Recover complete PR file metadata when GitHub cannot render a large diff.
 * Only immutable public Git objects are read; no source is checked out or run.
 */
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PullRequestFile } from "../src/lib/leaderboard";
import {
  type PublicMergeRepository,
  publicGitProcess,
  withPublicGitObjects,
} from "./value-merge-ingestion";

export interface PullRequestGitFilesInput {
  repository: PublicMergeRepository;
  head: string;
  merge: { sha: string; parents: { sha: string }[] };
}

export interface PullRequestGitFiles {
  files: PullRequestFile[];
  additions: number;
  deletions: number;
  changedFiles: number;
}

async function streamGit(
  directory: string,
  args: string[],
  read: (chunk: Buffer) => void,
  homeDirectory = directory,
): Promise<void> {
  const command = publicGitProcess(directory, args);
  const spool = await mkdtemp(join(tmpdir(), "slop-git-object-output-"));
  try {
    const output = await open(join(spool, "stdout"), "wx+", 0o600);
    try {
      // Capture stdout in a regular file so Node pipe closure cannot race a
      // short-lived Git process. Never interpret the output of a failed read.
      let exited: number;
      try {
        exited = await Bun.spawn([command.file, ...command.args], {
          env: {
            ...command.options.env,
            HOME: homeDirectory,
            XDG_CONFIG_HOME: homeDirectory,
          },
          timeout: command.options.timeout,
          stdin: "ignore",
          stdout: output.fd,
          // Git diagnostics may include repository content.
          stderr: "ignore",
        }).exited;
      } catch {
        throw new Error("Native Git object read failed");
      }
      if (exited !== 0) throw new Error("Native Git object read failed");

      const size = (await output.stat()).size;
      let offset = 0;
      while (offset < size) {
        const chunk = Buffer.allocUnsafe(Math.min(size - offset, 64 * 1024));
        // The child and this handle share the kernel file offset.
        const { bytesRead } = await output.read(chunk, 0, chunk.length, offset);
        if (bytesRead === 0) throw new Error("Native Git object read failed");
        offset += bytesRead;
        read(chunk.subarray(0, bytesRead));
      }
    } finally {
      await output.close();
    }
  } finally {
    await rm(spool, { recursive: true, force: true });
  }
}

async function textGit(
  directory: string,
  args: string[],
  homeDirectory = directory,
): Promise<string> {
  const chunks: Buffer[] = [];
  await streamGit(
    directory,
    args,
    (chunk) => chunks.push(chunk),
    homeDirectory,
  );
  return Buffer.concat(chunks).toString("utf8").trim();
}

function checkInput(input: PullRequestGitFilesInput, parentCount: 1 | 2 = 2) {
  if (
    input.merge.parents.length !== parentCount ||
    (parentCount === 2 && input.merge.parents[1].sha !== input.head) ||
    input.merge.parents[0].sha === input.head ||
    ![
      input.head,
      input.merge.sha,
      ...input.merge.parents.map(({ sha }) => sha),
    ].every((sha) => /^[a-f0-9]{40}$/u.test(sha))
  )
    throw new Error(
      parentCount === 2
        ? "File recovery requires an exact two-parent accepted merge"
        : "Reviewed squash requires an exact one-parent accepted commit",
    );
}

const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];

export async function changeDigest(
  directory: string,
  base: string,
  head: string,
  paths: readonly string[] = [],
) {
  const hash = createHash("sha256");
  await streamGit(
    directory,
    [
      "--literal-pathspecs",
      ...DIFF,
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "-z",
      base,
      head,
      "--",
      ...paths,
    ],
    (chunk) => {
      hash.update(chunk);
    },
  );
  return hash.digest("hex");
}

async function readGitFiles(
  directory: string,
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  if (
    (await textGit(directory, ["cat-file", "-t", input.merge.sha])) !== "commit"
  )
    throw new Error("Accepted merge object is not a native commit");
  const parents = await textGit(directory, [
    "show",
    "-s",
    "--format=%P",
    input.merge.sha,
    "--",
  ]);
  if (parents !== input.merge.parents.map(({ sha }) => sha).join(" "))
    throw new Error("Git merge parents differ from the accepted source");
  const base = input.merge.parents[0].sha;
  const mergeBases = (
    await textGit(directory, ["merge-base", "--all", base, input.head])
  ).split("\n");
  if (mergeBases.length !== 1 || !/^[a-f0-9]{40}$/u.test(mergeBases[0]))
    throw new Error("A unique submitted merge base is required");
  if (
    (await changeDigest(directory, base, input.merge.sha)) !==
    (await changeDigest(directory, mergeBases[0], input.head))
  )
    throw new Error(
      "Accepted Git file changes differ from the submitted source",
    );

  const files: PullRequestFile[] = [];
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let pending = Buffer.alloc(0);
  let rename: {
    additions: number;
    deletions: number;
    oldPathRead: boolean;
  } | null = null;
  const number = (value: string) => {
    if (
      !/^(0|[1-9][0-9]*)$/u.test(value) ||
      !Number.isSafeInteger(Number(value))
    )
      throw new Error("Invalid native Git line count");
    return Number(value);
  };
  const add = (pathBytes: Buffer, added: number, removed: number) => {
    const path = new TextDecoder("utf-8", { fatal: true }).decode(pathBytes);
    if (!path || paths.has(path))
      throw new Error("Invalid native Git file inventory");
    paths.add(path);
    additions += added;
    deletions += removed;
    if (!Number.isSafeInteger(additions) || !Number.isSafeInteger(deletions))
      throw new Error("Native Git line totals exceed safe integers");
    files.push({ path, additions: added, deletions: removed });
  };
  const token = (value: Buffer) => {
    if (rename) {
      if (!value.length) throw new Error("Invalid native Git rename path");
      if (!rename.oldPathRead) rename.oldPathRead = true;
      else {
        add(value, rename.additions, rename.deletions);
        rename = null;
      }
      return;
    }
    const first = value.indexOf(9);
    const second = value.indexOf(9, first + 1);
    if (first < 1 || second < 0)
      throw new Error("Invalid native Git file statistics");
    const added = value.subarray(0, first).toString("ascii");
    const removed = value.subarray(first + 1, second).toString("ascii");
    if ((added === "-") !== (removed === "-"))
      throw new Error("Invalid native Git binary statistics");
    const counts = {
      additions: added === "-" ? 0 : number(added),
      deletions: removed === "-" ? 0 : number(removed),
    };
    const path = value.subarray(second + 1);
    if (!path.length) rename = { ...counts, oldPathRead: false };
    else add(path, counts.additions, counts.deletions);
  };
  await streamGit(
    directory,
    [
      `--attr-source=${input.head}`,
      ...DIFF,
      "--numstat",
      "-z",
      "--find-renames",
      "-l0",
      base,
      input.merge.sha,
      "--",
    ],
    (chunk) => {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let start = 0;
      let end = bytes.indexOf(0, start);
      while (end !== -1) {
        token(bytes.subarray(start, end));
        start = end + 1;
        end = bytes.indexOf(0, start);
      }
      pending = Buffer.from(bytes.subarray(start));
    },
  );
  if (pending.length || rename)
    throw new Error("Incomplete native Git file statistics");
  return { files, additions, deletions, changedFiles: files.length };
}

/** A new bare reader excludes the source checkout's config, index and attributes. */
async function readLocalGitFiles(
  repository: string,
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  const directory = await mkdtemp(join(tmpdir(), "slop-pr-git-files-"));
  try {
    const objects = await textGit(
      repository,
      ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
      directory,
    );
    await streamGit(directory, ["init", "--bare", "--template="], () => {});
    await writeFile(join(directory, "objects/info/alternates"), `${objects}\n`);
    return await readGitFiles(directory, input);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Read an exact two-parent accepted merge from independently acquired objects. */
export async function readPullRequestGitFiles(
  repository: string,
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  checkInput(input);
  return readLocalGitFiles(repository, input);
}

/** Only the reviewed duplicate verifier may supply a GitHub-bound squash. */
export async function readReviewedSquashGitFiles(
  repository: string,
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  checkInput(input, 1);
  return readLocalGitFiles(repository, input);
}

export async function recoverPullRequestGitFiles(
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  checkInput(input);
  return withPublicGitObjects(
    input.repository,
    [input.head, input.merge.sha, ...input.merge.parents.map(({ sha }) => sha)],
    (directory) => readPullRequestGitFiles(directory, input),
  );
}
