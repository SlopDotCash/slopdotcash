/** Fixed, offline bare-object operation. Never execute a repository file. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { verifyMergeObjectStore } from "../../scripts/value-merge-objects";
import { collectVerifiedMergeResolutions } from "../../scripts/value-merge-resolution";
import {
  MERGE_PROFILE,
  type ValueMergeInput,
} from "../slopbot/value-merge-profile";

const MAX_FILE = 8 * 1024 * 1024;

/** root is owned by the process caller, never supplied through Worker RPC. */
export async function runMergeJob(root: string) {
  const WORK = `${root}/work`;
  const INPUT = `${root}/merge-input.json`;
  const BUNDLE = `${root}/merge.bundle`;
  const RESULT = `${WORK}/merge-result.json`;
  if ((await stat(INPUT)).size > MAX_FILE) throw new Error("Merge input limit");
  const input = JSON.parse(await readFile(INPUT, "utf8")) as {
    profile: string;
    inputs: ValueMergeInput[];
    bundleBytes: number;
    bundleSha256: string;
  };
  if (
    input.profile !== MERGE_PROFILE ||
    !Array.isArray(input.inputs) ||
    input.inputs.length === 0 ||
    !Number.isSafeInteger(input.bundleBytes) ||
    input.bundleBytes <= 0 ||
    input.bundleBytes > 25 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/u.test(input.bundleSha256) ||
    (await stat(BUNDLE)).size !== input.bundleBytes
  )
    throw new Error("Invalid fixed merge input");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(BUNDLE)) hash.update(chunk);
  if (hash.digest("hex") !== input.bundleSha256)
    throw new Error("Merge bundle bytes changed");
  const repository = `${WORK}/objects.git`;
  const env = {
    PATH: process.env.PATH,
    HOME: WORK,
    TMPDIR: WORK,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    LC_ALL: "C",
  };
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      env,
      encoding: "utf8",
      maxBuffer: MAX_FILE,
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  git("init", "--bare", "--template=", repository);
  git("-C", repository, "bundle", "verify", BUNDLE);
  // unbundle does not follow URLs, refs or config supplied by the uploader.
  git("-C", repository, "bundle", "unbundle", BUNDLE);
  verifyMergeObjectStore(input.inputs, repository);
  const results = [];
  for (const source of input.inputs)
    results.push({
      inputSha256: createHash("sha256")
        .update(JSON.stringify(source))
        .digest("hex"),
      mergeResolutions: await collectVerifiedMergeResolutions(
        source,
        repository,
      ),
    });
  const bytes = JSON.stringify(results);
  if (Buffer.byteLength(bytes) > MAX_FILE)
    throw new Error("Complete merge result exceeds limit");
  await writeFile(RESULT, bytes, { flag: "wx", mode: 0o600 });
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  runMergeJob("/analysis").catch(() => {
    // Git stderr and source bytes never enter service logs or the response.
    process.stderr.write("Fixed merge reconstruction refused\n");
    process.exitCode = 1;
  });
