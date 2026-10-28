import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareTestProgram } from "./scripts/prepare-test-program.mjs";

const image = `solanafoundation/anchor@sha256:${"a".repeat(64)}`;
const program = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "slop-test-artifact-"));
  const repositoryRoot = join(directory, "repo");
  const artifact = join(directory, "artifact");
  await mkdir(join(repositoryRoot, "contracts/solana/programs"), {
    recursive: true,
  });
  await mkdir(artifact);
  await writeFile(
    join(repositoryRoot, ".gitignore"),
    "contracts/solana/target/\ncontracts/solana/.local/\n",
  );
  await writeFile(
    join(repositoryRoot, "contracts/solana/programs/source.rs"),
    "// committed fixture\n",
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  );
  const manifest = {
    schemaVersion: 1,
    sourceCommit: git("rev-parse", "HEAD"),
    solanaSourceTree: git("rev-parse", "HEAD:contracts/solana"),
    buildImage: image,
    platform: "linux/amd64",
    platformTools: "v1.52",
    command:
      "cargo build-sbf --manifest-path programs/slop-escrow/Cargo.toml --tools-version v1.52 -- --locked",
    toolchain: ["fixture"],
    file: "slop_escrow.so",
    sha256: digest(program),
    sizeBytes: program.length,
    workflowRun: "42",
    workflowAttempt: "1",
  };
  const save = () =>
    writeFile(join(artifact, "manifest.json"), JSON.stringify(manifest));
  await save();
  await writeFile(join(artifact, "slop_escrow.so"), program);
  const target = join(
    repositoryRoot,
    "contracts/solana/target/deploy/slop_escrow.so",
  );
  await mkdir(join(repositoryRoot, "contracts/solana/target/deploy"), {
    recursive: true,
  });
  await writeFile(target, "old native build");
  const options = {
    repositoryRoot,
    expectedImage: image,
    runId: "42",
    runAttempt: "1",
  };
  return {
    directory,
    repositoryRoot,
    artifact,
    target,
    manifest,
    save,
    options,
  };
}

test("the lifecycle program is the verified same-source artifact, with a safe receipt", async () => {
  const f = await fixture();
  try {
    const receipt = await prepareTestProgram(f.artifact, f.options);
    expect(await readFile(f.target)).toEqual(program);
    expect(receipt).toEqual({
      sourceCommit: f.manifest.sourceCommit,
      sourceTree: f.manifest.solanaSourceTree,
      sha256: digest(program),
      sizeBytes: program.length,
      workflowRun: "42",
      workflowAttempt: "1",
    });
    expect(
      JSON.parse(
        await readFile(
          join(f.repositoryRoot, "contracts/solana/.local/test-program.json"),
          "utf8",
        ),
      ),
    ).toEqual(receipt);
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a consumer rerun verifies the original producer attempt", async () => {
  const f = await fixture();
  try {
    const { runAttempt: _, ...options } = f.options;
    const script = `import { prepareTestProgram } from ${JSON.stringify(
      new URL("./scripts/prepare-test-program.mjs", import.meta.url).href,
    )}; console.log(JSON.stringify(await prepareTestProgram(${JSON.stringify(f.artifact)}, ${JSON.stringify(options)})));`;
    const env = {
      ...process.env,
      GITHUB_RUN_ATTEMPT: "2",
      SLOP_SOLANA_ARTIFACT_ATTEMPT: "1",
    };
    const receipt = JSON.parse(
      execFileSync(process.execPath, ["--eval", script], {
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    expect(receipt.workflowAttempt).toBe("1");
    expect(await readFile(f.target)).toEqual(program);
    await writeFile(f.target, "unchanged after wrong producer attempt");
    expect(() =>
      execFileSync(process.execPath, ["--eval", script], {
        env: { ...env, SLOP_SOLANA_ARTIFACT_ATTEMPT: "3" },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).toThrow();
    expect(await readFile(f.target, "utf8")).toBe(
      "unchanged after wrong producer attempt",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

for (const field of [
  "sourceCommit",
  "solanaSourceTree",
  "buildImage",
  "workflowRun",
  "workflowAttempt",
  "sha256",
  "file",
  "platformTools",
  "sizeBytes",
] as const) {
  test(`artifact ${field} mismatch refuses before replacing the lifecycle program`, async () => {
    const f = await fixture();
    try {
      if (field === "sizeBytes") f.manifest.sizeBytes++;
      else f.manifest[field] = field === "file" ? "../slop_escrow.so" : "wrong";
      await f.save();
      await expect(prepareTestProgram(f.artifact, f.options)).rejects.toThrow();
      expect(await readFile(f.target, "utf8")).toBe("old native build");
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  });
}

test("changed bytes, even with a self-consistent non-ELF hash, cannot be used", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.artifact, "slop_escrow.so"), "not a program");
    f.manifest.sha256 = digest(Buffer.from("not a program"));
    f.manifest.sizeBytes = 13;
    await f.save();
    await expect(prepareTestProgram(f.artifact, f.options)).rejects.toThrow(
      "bytes fail verification",
    );
    expect(await readFile(f.target, "utf8")).toBe("old native build");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("tracked source edits cannot borrow an earlier artifact's source identity", async () => {
  const f = await fixture();
  try {
    await writeFile(
      join(f.repositoryRoot, "contracts/solana/programs/source.rs"),
      "// changed source\n",
    );
    await expect(prepareTestProgram(f.artifact, f.options)).rejects.toThrow();
    expect(await readFile(f.target, "utf8")).toBe("old native build");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("a linked output directory outside the program workspace is refused", async () => {
  const f = await fixture();
  try {
    const deploy = join(f.repositoryRoot, "contracts/solana/target/deploy");
    const outside = join(f.directory, "outside");
    await mkdir(outside);
    await rm(deploy, { recursive: true });
    // A junction needs no Windows symlink privilege; POSIX ignores the type.
    await symlink(outside, deploy, "junction");
    await expect(prepareTestProgram(f.artifact, f.options)).rejects.toThrow(
      "escapes the program workspace",
    );
    await expect(readFile(join(outside, "slop_escrow.so"))).rejects.toThrow();
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")(
  "an artifact symlink cannot substitute program bytes",
  async () => {
    const f = await fixture();
    try {
      await rm(join(f.artifact, "slop_escrow.so"));
      const other = join(f.directory, "other.so");
      await writeFile(other, program);
      await symlink(other, join(f.artifact, "slop_escrow.so"));
      await expect(prepareTestProgram(f.artifact, f.options)).rejects.toThrow(
        "regular file",
      );
      expect(await readFile(f.target, "utf8")).toBe("old native build");
    } finally {
      await rm(f.directory, { recursive: true, force: true });
    }
  },
);
