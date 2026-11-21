import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Programs of this workspace that the pinned image builds, with the manifest and receipt
 * names of each. The escrow keeps its original names. */
const PROGRAMS = {
  "slop-escrow": { manifest: "manifest.json", receipt: "test-program.json" },
  "slop-submission-deposits": {
    manifest: "slop-submission-deposits.manifest.json",
    receipt: "slop-submission-deposits.test-program.json",
  },
};

/** The caller supplies the trusted same-run build artifact. Its manifest is
 * consistency evidence, not authentication for arbitrary downloaded programs. */
export async function prepareTestProgram(
  artifactDirectory,
  {
    repositoryRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../..",
    ),
    expectedImage = process.env.SLOP_SOLANA_BUILD_IMAGE,
    runId = process.env.GITHUB_RUN_ID,
    runAttempt = process.env.SLOP_SOLANA_ARTIFACT_ATTEMPT ??
      process.env.GITHUB_RUN_ATTEMPT,
    program = "slop-escrow",
  } = {},
) {
  if (!Object.hasOwn(PROGRAMS, program))
    throw new Error("Unknown Solana test program");
  const names = PROGRAMS[program];
  const file = `${program.replaceAll("-", "_")}.so`;
  const root = await realpath(repositoryRoot);
  const programRoot = join(root, "contracts/solana");
  const directory = await realpath(artifactDirectory);
  const manifest = JSON.parse(
    await readFile(join(directory, names.manifest), "utf8"),
  );
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const sourceCommit = git("rev-parse", "HEAD");
  const sourceTree = git("rev-parse", "HEAD:contracts/solana");
  git("diff", "--quiet", "HEAD", "--", "contracts/solana");
  if (
    !/^solanafoundation\/anchor@sha256:[a-f0-9]{64}$/u.test(
      expectedImage ?? "",
    ) ||
    manifest.schemaVersion !== 1 ||
    manifest.sourceCommit !== sourceCommit ||
    manifest.solanaSourceTree !== sourceTree ||
    manifest.buildImage !== expectedImage ||
    manifest.platform !== "linux/amd64" ||
    manifest.platformTools !== "v1.52" ||
    manifest.command !==
      `cargo build-sbf --manifest-path programs/${program}/Cargo.toml --tools-version v1.52 -- --locked` ||
    manifest.file !== file ||
    !/^[a-f0-9]{64}$/u.test(manifest.sha256 ?? "") ||
    !Number.isSafeInteger(manifest.sizeBytes) ||
    manifest.sizeBytes < 4 ||
    !/^\d+$/u.test(manifest.workflowRun ?? "") ||
    !/^\d+$/u.test(manifest.workflowAttempt ?? "") ||
    (runId !== undefined && manifest.workflowRun !== runId) ||
    (runAttempt !== undefined && manifest.workflowAttempt !== runAttempt)
  )
    throw new Error(
      "Solana test artifact does not match the checked source and build run",
    );
  const source = join(directory, manifest.file);
  if (!(await lstat(source)).isFile())
    throw new Error("Solana test program is not a regular file");
  const bytes = await readFile(source);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (
    bytes.length !== manifest.sizeBytes ||
    sha256 !== manifest.sha256 ||
    !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  )
    throw new Error("Solana test artifact bytes fail verification");
  const output = join(programRoot, "target/deploy");
  const evidence = join(programRoot, ".local");
  await mkdir(output, { recursive: true });
  await mkdir(evidence, { recursive: true });
  const programDirectory = await realpath(programRoot);
  for (const path of [output, evidence]) {
    // Compare through `path.relative`: a `${programDirectory}/` prefix uses the
    // POSIX separator and matches nothing on Windows, where realpath uses `\`.
    const rest = relative(programDirectory, await realpath(path));
    if (rest === "" || rest.startsWith("..") || isAbsolute(rest))
      throw new Error("Solana test output escapes the program workspace");
  }
  const temporary = join(output, `.${program}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o644 });
    await rename(temporary, join(output, file));
  } finally {
    await unlink(temporary).catch(() => {});
  }
  const receipt = {
    sourceCommit,
    sourceTree,
    sha256,
    sizeBytes: bytes.length,
    workflowRun: manifest.workflowRun,
    workflowAttempt: manifest.workflowAttempt,
  };
  await writeFile(
    join(evidence, names.receipt),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (!process.argv[2])
    throw new Error(
      "Usage: node prepare-test-program.mjs /trusted/artifact-directory [program]",
    );
  console.log(
    JSON.stringify(
      await prepareTestProgram(
        process.argv[2],
        process.argv[3] ? { program: process.argv[3] } : {},
      ),
    ),
  );
}
