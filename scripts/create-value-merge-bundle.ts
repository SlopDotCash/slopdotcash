/** Build only the immutable objects needed by the fixed merge verifier. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ValueMergeInput } from "../workers/slopbot/value-merge-profile";
import {
  requiredMergeObjects,
  verifyMergeObjectStore,
} from "./value-merge-objects";

const MAX_BUNDLE = 25 * 1024 * 1024;
const MAX_INPUT = 8 * 1024 * 1024;

export async function createValueMergeBundle(
  inputs: readonly ValueMergeInput[],
  repository: string,
  output: string,
) {
  if (!isAbsolute(repository) || !isAbsolute(output))
    throw new Error("Merge repository and output paths must be absolute");
  const parent = await realpath(dirname(output));
  const workspace = await realpath(
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  );
  if (parent === workspace || parent.startsWith(`${workspace}/`))
    throw new Error("Raw merge evidence must stay outside the workspace");
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  const execute = (args: string[], input?: string) => {
    try {
      return execFileSync("git", args, {
        env,
        input,
        maxBuffer: MAX_BUNDLE,
        timeout: 30_000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      throw new Error("Merge bundle construction refused");
    }
  };
  const gitDir = execute(["-C", repository, "rev-parse", "--absolute-git-dir"])
    .toString("utf8")
    .trim();
  const required = requiredMergeObjects(inputs, gitDir);
  const objects = [
    ...new Set([...required.commits, ...required.trees, ...required.blobs]),
  ].sort();
  const pack = execute(
    [
      "--git-dir",
      gitDir,
      "pack-objects",
      "--stdout",
      "--window=50",
      "--depth=50",
    ],
    `${objects.join("\n")}\n`,
  );
  const heads = [...new Set(inputs.map((input) => input.pull.head.sha))].sort();
  const header = Buffer.from(
    `# v2 git bundle\n${heads.map((sha, i) => `${sha} refs/heads/slop-merge-${i}\n`).join("")}\n`,
  );
  const bytes = Buffer.concat([header, pack]);
  if (!pack.length || bytes.length > MAX_BUNDLE)
    throw new Error("Merge bundle exceeds the existing limit");
  const temporary = await mkdtemp(join(tmpdir(), "slop-merge-bundle-"));
  try {
    const bundle = join(temporary, "merge.bundle");
    const check = join(temporary, "objects.git");
    await writeFile(bundle, bytes, { mode: 0o600, flag: "wx" });
    execute(["init", "--bare", "--template=", check]);
    execute(["--git-dir", check, "bundle", "verify", bundle]);
    execute(["--git-dir", check, "bundle", "unbundle", bundle]);
    const verified = verifyMergeObjectStore(inputs, check);
    if (JSON.stringify(verified) !== JSON.stringify(required))
      throw new Error("Constructed merge object closure changed");
    const destination = join(parent, output.slice(output.lastIndexOf("/") + 1));
    await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
    return {
      path: destination,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      commits: required.commits.length,
      trees: required.trees.length,
      blobs: required.blobs.length,
      expandedBytes: required.expandedBytes,
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repository, input, output, ...extra] = process.argv.slice(2);
  if (!repository || !input || !output || extra.length || !isAbsolute(input))
    throw new Error(
      "Usage: bun scripts/create-value-merge-bundle.ts /absolute/repository /absolute/inputs.json /absolute/output.bundle",
    );
  if ((await stat(input)).size > MAX_INPUT)
    throw new Error("Merge input exceeds limit");
  const inputs = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(inputs) || !inputs.length)
    throw new Error("Merge inputs must be a nonempty array");
  console.log(
    JSON.stringify(await createValueMergeBundle(inputs, repository, output)),
  );
}
