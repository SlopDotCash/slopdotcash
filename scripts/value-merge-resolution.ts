/** Read immutable objects only. Reconstruct in a new bare repository so local
 * hooks, merge drivers, filters and configuration cannot affect the result.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AutomaticValueMergeResolution,
  CombinedParentValueMergeResolution,
  ValueEvidence,
  ValueMergeResolution,
} from "../workers/slopbot/value-evidence-types";
import {
  LEGACY_MERGE_PROFILE,
  MERGE_GIT_VERSION,
  MERGE_PROFILE,
  type ValueMergeInput,
  type ValueMergeProfile,
} from "../workers/slopbot/value-merge-profile";
import { mergeResolutionLineCounts } from "../workers/slopbot/value-merge-resolution";

/** The fixed intake/Points profile verifies full object identities and ordinary
 * path inventories before using the same canonical merge collector below.
 */
export async function collectVerifiedMergeResolutions(
  input: ValueMergeInput,
  repository: string,
  profile: ValueMergeProfile = MERGE_PROFILE,
): Promise<ValueMergeResolution[]> {
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    LC_ALL: "C",
  };
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repository, ...args], {
      env,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  if (git("--version").trim() !== MERGE_GIT_VERSION)
    throw new Error("Required merge reconstruction Git version unavailable");
  if (!/^[a-f0-9]{40}$/u.test(input.pull.head.sha))
    throw new Error("Invalid immutable source head");
  git("cat-file", "-e", `${input.pull.head.sha}^{commit}`);
  for (const commit of input.commits) {
    if (
      ![commit.sha, ...commit.parents.map(({ sha }) => sha)].every((sha) =>
        /^[a-f0-9]{40}$/u.test(sha),
      ) ||
      git("show", "-s", "--format=%P", commit.sha).trim() !==
        commit.parents.map(({ sha }) => sha).join(" ")
    )
      throw new Error("Git objects differ from ordered source parents");
    if (commit.parents.length > 1) continue;
    const attributions = input.commitAttribution.filter(
      ({ sha }) => sha === commit.sha,
    );
    if (
      attributions.length !== 1 ||
      attributions[0].limitations.length ||
      !Array.isArray(attributions[0].changedPaths)
    )
      throw new Error("Complete ordinary source paths unavailable");
    const paths = git(
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "-r",
      "-z",
      "--no-renames",
      commit.sha,
      "--",
    )
      .split("\0")
      .filter(Boolean)
      .sort();
    if (
      JSON.stringify(paths) !==
      JSON.stringify([...attributions[0].changedPaths].sort())
    )
      throw new Error("Git paths differ from complete source inventory");
  }
  const resolved = await collectMergeResolutions(
    input as ValueEvidence,
    repository,
    profile,
  );
  return resolved.mergeResolutions ?? [];
}

export async function collectMergeResolutions(
  evidence: ValueEvidence,
  repository: string,
  profile: ValueMergeProfile = MERGE_PROFILE,
): Promise<ValueEvidence> {
  if (profile !== MERGE_PROFILE && profile !== LEGACY_MERGE_PROFILE)
    throw new Error("Unsupported merge reconstruction profile");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  const objects = execFileSync(
    "git",
    [
      "-C",
      repository,
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "objects",
    ],
    { env, encoding: "utf8" },
  ).trim();
  env.GIT_ALTERNATE_OBJECT_DIRECTORIES = objects;
  const directory = await mkdtemp(join(tmpdir(), "slop-value-merge-"));
  const resolutions: ValueMergeResolution[] = [];
  const gitVersion = execFileSync("git", ["--version"], {
    env,
    encoding: "utf8",
  }).trim();
  try {
    execFileSync("git", ["init", "--bare", "--template=", directory], {
      env,
      stdio: "ignore",
    });
    const git = (...args: string[]) =>
      spawnSync("git", ["--git-dir", directory, ...args], {
        env,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    const read = (...args: string[]) => {
      const result = git(...args);
      if (result.status !== 0)
        throw new Error("Complete local Git evidence unavailable");
      return result.stdout;
    };
    const acceptedPaths = new Set(evidence.files.map((file) => file.filename));
    const authoredPaths = new Set(
      evidence.commitAttribution.flatMap((entry) => entry.changedPaths ?? []),
    );
    const entryAt = (ref: string, path: string) =>
      read("ls-tree", "-z", ref, "--", `:(literal)${path}`)
        .split("\0")
        .find((entry) => entry.split("\t")[1] === path)
        ?.split("\t")[0];
    for (const commit of evidence.commits) {
      if (commit.parents.length < 2) continue;
      if (
        ![commit.sha, ...commit.parents.map((parent) => parent.sha)].every(
          (sha) => /^[a-f0-9]{40}$/u.test(sha),
        )
      )
        throw new Error("Invalid immutable merge identity");
      const parents = commit.parents.map((parent) => parent.sha);
      if (
        read("show", "-s", "--format=%P", commit.sha).trim() !==
        parents.join(" ")
      )
        throw new Error("Local merge parents differ from GitHub evidence");
      if (commit.parents.length > 2) {
        const parentTrees = parents.map((parent) =>
          read("rev-parse", `${parent}^{tree}`).trim(),
        );
        const resolvedTree = read("rev-parse", `${commit.sha}^{tree}`).trim();
        const combinedPaths = read(
          "diff-tree",
          "--no-commit-id",
          "-c",
          "--name-only",
          "-z",
          commit.sha,
          "--",
        )
          .split("\0")
          .filter(Boolean);
        const combined = read(
          "diff-tree",
          "--no-commit-id",
          "-c",
          "-p",
          "--combined-all-paths",
          "--full-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          commit.sha,
          "--",
        );
        const files: CombinedParentValueMergeResolution["files"] = [];
        const sections: string[] = [];
        const observed: string[] = [];
        for (const section of combined.split(/^diff --combined /mu).slice(1)) {
          const path = section.slice(0, section.indexOf("\n"));
          if (!combinedPaths.includes(path) || observed.includes(path))
            throw new Error("Incomplete combined merge paths");
          observed.push(path);
          const prefixes = section
            .split("\n")
            .map((line) => line.slice(0, parents.length));
          if (
            !prefixes.some(
              (prefix) =>
                prefix === "+".repeat(parents.length) ||
                prefix === "-".repeat(parents.length),
            )
          )
            continue;
          const entries = [...parents, commit.sha].map((ref) => {
            const value = entryAt(ref, path);
            const match = /^(100644|100755) blob ([a-f0-9]{40})$/u.exec(
              value ?? "",
            );
            if (!match)
              throw new Error(
                "Octopus resolution requires complete regular-file snapshots",
              );
            return { mode: match[1], blobSha: match[2] };
          });
          files.push({
            path,
            parents: entries.slice(0, -1),
            result: entries[entries.length - 1],
          });
          sections.push(`diff --combined ${section}`);
        }
        if (
          JSON.stringify([...observed].sort()) !==
          JSON.stringify([...combinedPaths].sort())
        )
          throw new Error(
            "Combined merge contains an unsupported path or binary delta",
          );
        const patch = sections.join("");
        const resolution: CombinedParentValueMergeResolution = {
          kind: "combined-parent-delta",
          commitSha: commit.sha,
          parents,
          parentTrees,
          gitVersion,
          resolvedTree,
          patch,
          patchSha256: createHash("sha256").update(patch).digest("hex"),
          paths: files.map((file) => file.path),
          files,
        };
        if (mergeResolutionLineCounts(resolution, commit) === null)
          throw new Error("Incomplete or ambiguous combined-parent resolution");
        resolutions.push(resolution);
        continue;
      }
      const merged = git(
        "merge-tree",
        "--write-tree",
        "--no-messages",
        parents[0],
        parents[1],
      );
      if (merged.status !== 0 && merged.status !== 1)
        throw new Error("Automatic merge reconstruction failed");
      const automaticTree = merged.stdout.split("\n")[0];
      if (!/^[a-f0-9]{40}$/u.test(automaticTree))
        throw new Error("Automatic merge tree missing");
      const resolvedTree = read("rev-parse", `${commit.sha}^{tree}`).trim();
      const patch = read(
        "diff",
        ...(profile === MERGE_PROFILE ? ["--full-index"] : []),
        "--no-ext-diff",
        "--no-textconv",
        "--binary",
        "--no-renames",
        automaticTree,
        resolvedTree,
        "--",
      );
      const paths = read(
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        automaticTree,
        resolvedTree,
        "--",
      )
        .split("\0")
        .filter(Boolean);
      const automaticRelocations: NonNullable<
        AutomaticValueMergeResolution["automaticRelocations"]
      > = [];
      for (const sourceParent of parents) {
        const rows = read(
          "diff",
          "--raw",
          "-z",
          "--no-abbrev",
          "--no-ext-diff",
          "--no-textconv",
          "--find-renames=100%",
          "--diff-filter=R",
          sourceParent,
          automaticTree,
          "--",
        ).split("\0");
        for (let index = 0; index < rows.length - 1; index += 3) {
          const [oldMode, newMode, oldBlob, newBlob, status] = rows[index]
            .slice(1)
            .split(" ");
          const sourcePath = rows[index + 1];
          const path = rows[index + 2];
          if (
            status !== "R100" ||
            oldMode !== newMode ||
            oldBlob !== newBlob ||
            !acceptedPaths.has(path) ||
            authoredPaths.has(path) ||
            !["100644", "100755"].includes(oldMode)
          )
            continue;
          const expected = `${oldMode} blob ${oldBlob}`;
          if (
            entryAt(sourceParent, sourcePath) !== expected ||
            entryAt(automaticTree, path) !== expected ||
            entryAt(resolvedTree, path) !== expected ||
            entryAt(evidence.pull.head.sha, path) !== expected
          )
            continue;
          const sourceCommitShas = evidence.commitAttribution
            .filter(
              (entry) =>
                /^[a-f0-9]{40}$/u.test(entry.sha) &&
                entry.limitations.length === 0 &&
                entry.changedPaths?.includes(sourcePath) &&
                git("merge-base", "--is-ancestor", entry.sha, sourceParent)
                  .status === 0,
            )
            .map((entry) => entry.sha)
            .sort();
          if (!sourceCommitShas.length) continue;
          automaticRelocations.push({
            sourceParent,
            sourcePath,
            path,
            blobSha: oldBlob,
            headSha: evidence.pull.head.sha,
            sourceCommitShas,
          });
        }
      }
      resolutions.push({
        commitSha: commit.sha,
        parents: [parents[0], parents[1]],
        gitVersion,
        automaticTree,
        resolvedTree,
        hadConflicts: merged.status === 1,
        patch,
        patchSha256: createHash("sha256").update(patch).digest("hex"),
        paths,
        ...(automaticRelocations.length ? { automaticRelocations } : {}),
      });
    }
    return { ...evidence, mergeResolutions: resolutions };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
