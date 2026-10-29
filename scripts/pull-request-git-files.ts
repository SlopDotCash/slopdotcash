/** Recover complete PR file metadata when GitHub cannot render a large diff.
 * Only immutable public Git objects are read; no source is checked out or run.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  const child = spawn(command.file, command.args, {
    ...command.options,
    env: {
      ...command.options.env,
      HOME: homeDirectory,
      XDG_CONFIG_HOME: homeDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const completed = new Promise<void>((resolve, reject) => {
    child.once("error", () =>
      reject(new Error("Native Git object read failed")),
    );
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error("Native Git object read failed")),
    );
  });
  // Git diagnostics may include repository content. Drain without publishing it.
  child.stderr.resume();
  try {
    await Promise.all([
      completed,
      (async () => {
        for await (const chunk of child.stdout) read(Buffer.from(chunk));
      })(),
    ]);
  } catch (error) {
    child.kill("SIGKILL");
    await completed.catch(() => {});
    throw error;
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

function checkInput(input: PullRequestGitFilesInput) {
  if (
    input.merge.parents.length !== 2 ||
    input.merge.parents[1].sha !== input.head ||
    input.merge.parents[0].sha === input.head ||
    ![
      input.head,
      input.merge.sha,
      ...input.merge.parents.map(({ sha }) => sha),
    ].every((sha) => /^[a-f0-9]{40}$/u.test(sha))
  )
    throw new Error(
      "File recovery requires an exact two-parent accepted merge",
    );
}

const DIFF = ["diff", "--no-ext-diff", "--no-textconv", "--no-color"];

async function changeDigest(directory: string, base: string, head: string) {
  const hash = createHash("sha256");
  await streamGit(
    directory,
    [...DIFF, "--raw", "--no-abbrev", "--no-renames", "-z", base, head, "--"],
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
  checkInput(input);
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

/** Explicit local-object reader for fixtures and independently acquired objects.
 * A new bare reader excludes the source checkout's config, index and attributes.
 * The production entry below always acquires its own verified public objects.
 */
export async function readPullRequestGitFiles(
  repository: string,
  input: PullRequestGitFilesInput,
): Promise<PullRequestGitFiles> {
  checkInput(input);
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
