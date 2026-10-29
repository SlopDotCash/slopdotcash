/** Reconstruct a journal's server-verified merge recipe from public Git objects.
 * No checkout, model call, source execution or publication occurs here.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { validRepositoryPath } from "../src/lib/project-contracts";
import {
  MERGE_GIT_VERSION,
  mergeInput,
  mergeRecipe,
  type ValueMergeRecipe,
  validMergeRecipe,
} from "../workers/slopbot/value-merge-profile";
import type { WorkUnitSource } from "../workers/slopbot/value-work-unit";
import { collectVerifiedMergeResolutions } from "./value-merge-resolution";

export interface PublicMergeRepository {
  id: number;
  node_id: string;
  private: boolean;
  full_name?: string;
}

const run = promisify(execFile);

/** The same isolated Git boundary is used for acquisition and object reads. */
export function publicGitProcess(directory: string, args: string[]) {
  return {
    file: "git",
    args: [
      "-c",
      "credential.helper=",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "http.followRedirects=false",
      "-c",
      "fetch.fsckObjects=true",
      "-c",
      "protocol.allow=never",
      "-c",
      "protocol.https.allow=always",
      "-C",
      directory,
      ...args,
    ],
    options: {
      env: {
        PATH: process.env.PATH,
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_ATTR_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        HOME: directory,
        XDG_CONFIG_HOME: directory,
      },
      timeout: 120_000,
    },
  };
}

export async function withPublicGitObjects<T>(
  repository: PublicMergeRepository,
  objects: string[],
  read: (directory: string) => Promise<T>,
): Promise<T> {
  const name = repository.full_name;
  if (
    repository.private !== false ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    typeof repository.node_id !== "string" ||
    !repository.node_id ||
    typeof name !== "string" ||
    !validRepositoryPath(name) ||
    name.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(
      "Merge reconstruction requires the verified public repository",
    );

  if (!objects.length || !objects.every((sha) => /^[a-f0-9]{40}$/u.test(sha)))
    throw new Error("Invalid immutable merge object identity");

  const directory = await mkdtemp(
    join(tmpdir(), "slop-value-merge-ingestion-"),
  );
  try {
    const git = (...args: string[]) => {
      const command = publicGitProcess(directory, args);
      return run(command.file, command.args, {
        ...command.options,
        // The complete PR 1069 graph exceeded two minutes while receiving
        // 162,288 objects. Allow its public fetch ten minutes within the
        // release preparation job's three-hour budget; other commands keep
        // their existing two-minute deadline.
        timeout: args[0] === "fetch" ? 600_000 : command.options.timeout,
        maxBuffer: 1024 * 1024,
      });
    };
    if ((await git("--version")).stdout.trim() !== MERGE_GIT_VERSION)
      throw new Error("Required merge reconstruction Git version unavailable");
    await git("init", "--bare", "--template=");
    // Full ancestry and blobs are required for canonical merge-tree results.
    // Never use a shallow or lazy-fetch repository, credentials or redirects.
    await git(
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--no-write-fetch-head",
      `https://github.com/${name}.git`,
      ...new Set(objects),
    );
    await git("fsck", "--full", "--strict", "--no-reflogs");
    return await read(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function hydrateValueMergeSource(
  source: WorkUnitSource,
  recipe: ValueMergeRecipe,
  repository: PublicMergeRepository,
): Promise<WorkUnitSource> {
  if (
    !validMergeRecipe(recipe) ||
    (await mergeRecipe(source.evidence)).inputSha256 !== recipe.inputSha256
  )
    throw new Error("Merge reconstruction inputs differ from the journal");
  if (
    repository.node_id !== source.evidence.repositoryNodeId ||
    repository.id !== source.evidence.repositoryDatabaseId
  )
    throw new Error(
      "Merge reconstruction requires the verified public repository",
    );
  const input = mergeInput(source.evidence);
  const objects = [
    input.pull.head.sha,
    ...input.commits.flatMap(({ sha, parents }) => [
      sha,
      ...parents.map((parent) => parent.sha),
    ]),
  ];
  return withPublicGitObjects(repository, objects, async (directory) => {
    const mergeResolutions = await collectVerifiedMergeResolutions(
      input,
      directory,
      recipe.profile,
    );
    return {
      ...source,
      evidence: { ...source.evidence, mergeResolutions },
      mergeRecipe: recipe,
    };
  });
}
