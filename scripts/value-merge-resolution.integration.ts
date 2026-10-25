/** Native Linux feasibility proof for the public Network 97/117 merge.
 * This is not the deployed sandbox intake and does not publish an assessment.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { ValueEvidence } from "../workers/slopbot/value-evidence";
import { collectMergeResolutions } from "./value-merge-resolution";

const fixturePath = fileURLToPath(
  new URL("../tests/fixtures/value-merge-network-97-117.json", import.meta.url),
);
const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
const containerProgress: Record<string, unknown> = {};
const cleanEnvironment = (directory: string): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: directory,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
});
function command(command: string, args: string[], directory: string) {
  try {
    return execFileSync(command, args, {
      env: cleanEnvironment(directory),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    // Git/provider stderr is not part of the public proof.
    throw new Error(`${command} command failed`);
  }
}

async function inContainer() {
  containerProgress.phase = "native-identity";
  assert.equal(process.platform, "linux", "Native Linux is required");
  assert.equal(process.getuid?.(), 65534, "Unprivileged UID is required");
  assert.equal(process.getgid?.(), 65534, "Unprivileged GID is required");
  const started = performance.now();
  const fixtureBytes = readFileSync("/input/fixture.json");
  const fixture = JSON.parse(fixtureBytes.toString());
  containerProgress.phase = "complete-bundle";
  const bundle = readFileSync("/input/source.bundle");
  const expectedBundleHash = readFileSync(
    "/input/bundle.sha256",
    "utf8",
  ).trim();
  assert.equal(sha256(bundle), expectedBundleHash, "Bundle bytes changed");
  const repository = "/tmp/objects.git";
  const git = (...args: string[]) => command("git", args, "/tmp");
  git("init", "--bare", "--template=", repository);
  git("-C", repository, "bundle", "verify", "/input/source.bundle");
  git(
    "-C",
    repository,
    "fetch",
    "--no-tags",
    "--no-recurse-submodules",
    "/input/source.bundle",
    ...fixture.sources.map(
      (source: { number: number }) =>
        `refs/heads/pr-${source.number}:refs/heads/pr-${source.number}`,
    ),
  );
  git("-C", repository, "fsck", "--full", "--strict", "--no-reflogs");
  const results: Record<string, unknown>[] = [];
  containerProgress.gitVersion = git("--version");
  assert.equal(containerProgress.gitVersion, "git version 2.50.1");
  containerProgress.nodeVersion = process.version;
  containerProgress.platform = process.platform;
  containerProgress.arch = process.arch;
  containerProgress.results = results;
  containerProgress.phase = "canonical-reconstruction";
  for (const source of fixture.sources) {
    assert.equal(
      git("-C", repository, "rev-parse", `refs/heads/pr-${source.number}`),
      source.evidence.pull.head.sha,
      "Pinned source head differs",
    );
    // The fixture deliberately contains only the fields this canonical helper
    // reads. It is not a complete ValueEvidence or an import-ready assessment.
    const evidence = source.evidence as ValueEvidence;
    const resolved = await collectMergeResolutions(evidence, repository);
    const resolutions = resolved.mergeResolutions ?? [];
    const comparable = resolutions.map(
      ({ patch, gitVersion: _version, ...rest }) => ({
        ...rest,
        patchBytes: Buffer.byteLength(patch),
      }),
    );
    const bytes = JSON.stringify(resolutions);
    results.push({
      number: source.number,
      resolutions: resolutions.length,
      resolutionBytes: Buffer.byteLength(bytes),
      resolutionSha256: sha256(bytes),
      observed: comparable,
      matchedTreesParentsPathsAndPatch: isDeepStrictEqual(
        comparable,
        source.expected,
      ),
    });
    assert.deepEqual(
      comparable,
      source.expected,
      "Canonical merge differs from retained observation",
    );
  }
  const mergeSource = fixture.sources.find(
    (source: { expected: unknown[] }) => source.expected.length,
  );
  assert(mergeSource, "The fixture must exercise a nonempty merge");
  containerProgress.phase = "refusal-controls";
  const wrongParents = structuredClone(mergeSource.evidence) as ValueEvidence;
  const merge = wrongParents.commits.find(
    (commit) => commit.parents.length === 2,
  );
  assert(merge);
  merge.parents.reverse();
  await assert.rejects(
    collectMergeResolutions(wrongParents, repository),
    /Local merge parents differ/,
  );
  git("init", "--bare", "--template=", "/tmp/incomplete.git");
  await assert.rejects(
    collectMergeResolutions(mergeSource.evidence, "/tmp/incomplete.git"),
    /Complete local Git evidence unavailable/,
  );
  const memoryPeak = "/sys/fs/cgroup/memory.peak";
  let cgroupPeakBytes: number | null = null;
  try {
    cgroupPeakBytes = Number(readFileSync(memoryPeak, "utf8"));
  } catch {
    /* Older cgroups lack this measurement. */
  }
  console.log(
    JSON.stringify({
      status: "passed",
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      gitVersion: git("--version"),
      uid: process.getuid?.(),
      fixtureSha256: sha256(fixtureBytes),
      bundleBytes: bundle.length,
      bundleSha256: sha256(bundle),
      elapsedMs: performance.now() - started,
      parentMaxRssKiB: process.resourceUsage().maxRSS,
      cgroupPeakBytes,
      gitDirectoryBytes: Number(
        command("du", ["-sb", repository], "/tmp").split(/\s/)[0],
      ),
      wrongOrderedParentsRefused: true,
      missingObjectsRefused: true,
      results,
    }),
  );
}

async function onHost(image: string, output: string, sandboxImage: string) {
  assert.match(
    image,
    /^sha256:[0-9a-f]{64}$/,
    "Use the locally built test derivative image ID",
  );
  assert.match(sandboxImage, /^sha256:[0-9a-f]{64}$/);
  const directory = mkdtempSync(join(tmpdir(), "slop-merge-proof-"));
  let container: string | undefined;
  let phase = "prepare";
  let result: Record<string, unknown> = { status: "failed" };
  let failure: unknown;
  try {
    const fixtureBytes = readFileSync(fixturePath);
    const fixture = JSON.parse(fixtureBytes.toString());
    const source = join(directory, "source.git");
    command("git", ["init", "--bare", "--template=", source], directory);
    // Public pinned objects only. No checkout, credentials, hooks or submodules.
    phase = "fetch-public-pinned-objects";
    command(
      "git",
      [
        "-C",
        source,
        "fetch",
        "--no-tags",
        "--no-recurse-submodules",
        fixture.repository,
        ...fixture.sources.map(
          (record: { number: number; evidence: ValueEvidence }) =>
            `${record.evidence.pull.head.sha}:refs/heads/pr-${record.number}`,
        ),
      ],
      directory,
    );
    const bundle = join(directory, "source.bundle");
    command(
      "git",
      ["-C", source, "bundle", "create", bundle, "--all"],
      directory,
    );
    command("git", ["-C", source, "bundle", "verify", bundle], directory);
    writeFileSync(
      join(directory, "bundle.sha256"),
      sha256(readFileSync(bundle)),
    );
    writeFileSync(join(directory, "fixture.json"), fixtureBytes);
    phase = "bundle-canonical-helper";
    const built = await Bun.build({
      entrypoints: [fileURLToPath(import.meta.url)],
      target: "node",
      outdir: directory,
      naming: "entry.mjs",
    });
    assert(built.success, "Canonical helper bundle failed");
    // Only public Git objects and this test's executable are exposed read-only.
    chmodSync(directory, 0o755);
    phase = "native-container";
    container = command(
      "docker",
      [
        "create",
        "--network",
        "none",
        "--read-only",
        "--user",
        "65534:65534",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--cpus",
        "1",
        "--memory",
        "512m",
        "--memory-swap",
        "512m",
        "--pids-limit",
        "32",
        "--ulimit",
        "core=0",
        "--ulimit",
        "cpu=20",
        "--ulimit",
        "fsize=134217728",
        "--ulimit",
        "nofile=64",
        "--tmpfs",
        "/tmp:rw,nosuid,nodev,size=256m,uid=65534,gid=65534,mode=700",
        "--mount",
        `type=bind,source=${directory},target=/input,readonly`,
        "--entrypoint",
        "/usr/bin/env",
        image,
        "-i",
        "PATH=/opt/slop-merge-git/bin:/usr/local/bin:/usr/bin:/bin",
        "HOME=/tmp",
        "TMPDIR=/tmp",
        "timeout",
        "--signal=KILL",
        "30",
        "node",
        "--max-old-space-size=128",
        "/input/entry.mjs",
        "container",
      ],
      directory,
    );
    assert.match(
      container,
      /^[0-9a-f]{64}$/,
      "Container identity is unavailable",
    );
    const execution = spawnSync("docker", ["start", "--attach", container], {
      env: cleanEnvironment(directory),
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    result = {
      ...JSON.parse(execution.stdout ?? "{}"),
      image,
      sandboxImage,
      gitSourceSha256:
        "7e3e6c36decbd8f1eedd14d42db6674be03671c2204864befa2a41756c5c8fc4",
      sourceRevision: command("git", ["rev-parse", "HEAD"], directory),
    };
    assert.equal(execution.status, 0, "Native container failed");
    assert.equal(result.status, "passed", "Native reconstruction did not pass");
  } catch (error) {
    failure = error;
    result = { ...result, status: "failed", hostPhase: phase };
  } finally {
    if (container && /^[0-9a-f]{64}$/.test(container)) {
      try {
        command("docker", ["rm", "--force", container], directory);
        const absent = spawnSync("docker", ["inspect", container], {
          env: cleanEnvironment(directory),
          stdio: "pipe",
          encoding: "utf8",
          timeout: 10_000,
        });
        assert.equal(absent.status, 1, "Owned container still exists");
        assert(
          absent.stderr.includes(`No such object: ${container}`),
          "Container absence is unverified",
        );
        result.containerRemoved = true;
      } catch (error) {
        failure ??= error;
        result.status = "failed";
        result.containerRemoved = false;
      }
    }
    rmSync(directory, { recursive: true, force: true });
    result.hostTemporaryDirectoryRemoved = true;
    writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  }
  assert(
    !failure,
    `Native merge proof failed during ${phase}; inspect the bounded result`,
  );
}

if (process.argv[2] === "container") {
  try {
    await inContainer();
  } catch (error) {
    const known = new Set([
      "Automatic merge reconstruction failed",
      "Automatic merge tree missing",
      "Complete local Git evidence unavailable",
      "Local merge parents differ from GitHub evidence",
    ]);
    const reason =
      error instanceof Error && known.has(error.message)
        ? error.message
        : "Native proof assertion or runtime failed";
    console.log(
      JSON.stringify({ ...containerProgress, status: "failed", reason }),
    );
    process.exitCode = 1;
  }
} else {
  assert(
    process.argv[2] && process.argv[3] && process.argv[4],
    "Pass test image ID, safe result path and unchanged sandbox image ID",
  );
  await onHost(process.argv[2], process.argv[3], process.argv[4]);
}
